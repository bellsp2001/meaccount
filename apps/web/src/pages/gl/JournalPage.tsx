import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

interface Account { id: string; code: string; name: string; account_type: string; normal_balance: string }
interface JEntry  { id: string; account_id: string; account_code?: string; account_name?: string; debit: number; credit: number; description?: string }
interface Journal { id: string; number: string; date: string; description: string; status: 'draft'|'posted'|'reversed'; entries: JEntry[]; total_debit?: number; total_credit?: number; ai_suggested?: boolean }

const entrySchema = z.object({
  account_id:  z.string().min(1, 'เลือกบัญชี'),
  debit:       z.number().min(0),
  credit:      z.number().min(0),
  description: z.string().optional(),
})
const journalSchema = z.object({
  date:        z.string().min(1, 'ระบุวันที่'),
  description: z.string().min(1, 'ระบุคำอธิบาย'),
  reference:   z.string().optional(),
  entries:     z.array(entrySchema).min(2, 'ต้องมีอย่างน้อย 2 รายการ'),
}).refine(d => {
  const td = d.entries.reduce((s, e) => s + (e.debit || 0), 0)
  const tc = d.entries.reduce((s, e) => s + (e.credit || 0), 0)
  return Math.abs(td - tc) < 0.001
}, { message: 'Debit ≠ Credit — บัญชีไม่สมดุล', path: ['entries'] })

type JForm = z.infer<typeof journalSchema>

const STATUS_META: Record<string,{label:string;color:string}> = {
  draft:    { label: 'Draft',    color: '#F5A623' },
  posted:   { label: 'Posted',   color: '#43E97B' },
  reversed: { label: 'Reversed', color: '#FF6B6B' },
}

const inp: React.CSSProperties = { background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#DDE3EE', outline: 'none', width: '100%', boxSizing: 'border-box' }

export default function JournalPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiAmt, setAiAmt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{explanation:string;confidence:number}|null>(null)
  const [viewJournal, setViewJournal] = useState<Journal|null>(null)

  const { data: journals = [], isLoading } = useQuery<Journal[]>({
    queryKey: ['journals'],
    queryFn: async () => (await api.get('/api/v1/journals/')).data,
  })
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/api/v1/accounts/')).data,
  })

  const createM = useMutation({
    mutationFn: (d: JForm) => api.post('/api/v1/journals/', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journals'] }); setShowCreate(false); reset() },
  })
  const postM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/journals/${id}/post`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journals'] }),
  })

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<JForm>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      entries: [
        { account_id: '', debit: 0, credit: 0, description: '' },
        { account_id: '', debit: 0, credit: 0, description: '' },
      ],
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'entries' })
  const watchEntries = watch('entries')
  const totalDebit  = watchEntries.reduce((s, e) => s + (Number(e.debit)  || 0), 0)
  const totalCredit = watchEntries.reduce((s, e) => s + (Number(e.credit) || 0), 0)
  const balanced    = Math.abs(totalDebit - totalCredit) < 0.001

  async function handleAISuggest() {
    if (!aiDesc || !aiAmt) return
    setAiLoading(true)
    setAiResult(null)
    try {
      const { data } = await api.post('/api/v1/journals/ai/suggest', {
        description: aiDesc, amount: Number(aiAmt), date: new Date().toISOString().split('T')[0],
      })
      setAiResult({ explanation: data.explanation, confidence: data.confidence })
      // Fill form entries from AI suggestion
      const newEntries = data.suggested_entries.map((e: any, i: number) => ({
        account_id: e.account_id, debit: Number(e.debit), credit: Number(e.credit),
        description: e.description || (i === 0 ? aiDesc : ''),
      }))
      if (newEntries.length >= 2) {
        setValue('entries', newEntries)
        setValue('description', aiDesc)
        setAiMode(false)
        setShowCreate(true)
      }
    } catch { setAiResult({ explanation: 'ไม่สามารถเชื่อมต่อ AI ได้', confidence: 0 }) }
    finally { setAiLoading(false) }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '92vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>สมุดรายวัน</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>General Journal — Double-Entry Bookkeeping</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setAiMode(true)}
            style={{ background: '#00D4AA15', border: '1px solid #00D4AA40', color: '#00D4AA', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
            🤖 AI แนะนำการลงบัญชี
          </button>
          <button onClick={() => { setShowCreate(true); setAiResult(null) }}
            style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
            + บันทึกรายการใหม่
          </button>
        </div>
      </div>

      {/* Journal list */}
      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
        ) : journals.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📒</p>
            <p style={{ color: '#3A4A60', fontSize: 13 }}>ยังไม่มีรายการสมุดรายวัน</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่','วันที่','คำอธิบาย','Dr','Cr','สถานะ','Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: ['Dr','Cr'].includes(h) ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid #151C28' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journals.map(j => {
                const sm = STATUS_META[j.status]
                return (
                  <tr key={j.id} onClick={() => setViewJournal(j)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520', fontFamily: 'monospace', fontSize: 12, color: '#4FACFE' }}>{j.number}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#8A9BB0' }}>{new Date(j.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520', fontSize: 13 }}>
                      <span>{j.description}</span>
                      {j.ai_suggested && <span style={{ marginLeft: 8, fontSize: 9, background: '#00D4AA15', color: '#00D4AA', border: '1px solid #00D4AA30', padding: '1px 6px', borderRadius: 8 }}>AI</span>}
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#43E97B' }}>{Number(j.total_debit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#F093FB' }}>{Number(j.total_credit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color+'18', border: `1px solid ${sm.color}35`, padding: '2px 9px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #0F1520' }} onClick={e => e.stopPropagation()}>
                      {j.status === 'draft' && (
                        <button onClick={() => postM.mutate(j.id)} disabled={postM.isPending}
                          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: '1px solid #43E97B40', background: '#43E97B12', color: '#43E97B', cursor: 'pointer', fontWeight: 700 }}>
                          Post
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── AI MODAL ── */}
      {aiMode && (
        <div style={overlay} onClick={() => setAiMode(false)}>
          <div style={{ ...modal, maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🤖</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI แนะนำการลงบัญชี</h3>
                  <p style={{ margin: 0, fontSize: 11, color: '#4A5A70' }}>บอกรายการ AI จะเลือกบัญชีให้อัตโนมัติ</p>
                </div>
              </div>
              <button onClick={() => setAiMode(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>อธิบายรายการ</label>
                <input value={aiDesc} onChange={e => setAiDesc(e.target.value)} placeholder="เช่น: ซื้อกระดาษ A4 สำนักงาน, รับค่าบริการจากลูกค้า ABC..."
                  style={{ ...inp, padding: '11px 14px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>จำนวนเงิน (บาท)</label>
                <input type="number" value={aiAmt} onChange={e => setAiAmt(e.target.value)} placeholder="5000"
                  style={{ ...inp, padding: '11px 14px' }} />
              </div>
              {aiResult && (
                <div style={{ background: aiResult.confidence > 0.7 ? '#43E97B12' : '#F5A62312', border: `1px solid ${aiResult.confidence > 0.7 ? '#43E97B35' : '#F5A62335'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: aiResult.confidence > 0.7 ? '#43E97B' : '#F5A623' }}>
                    {aiResult.confidence > 0.7 ? '✓ AI แนะนำ' : '⚠ ความมั่นใจต่ำ'} ({Math.round(aiResult.confidence * 100)}%)
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: '#8A9BB0', lineHeight: 1.6 }}>{aiResult.explanation}</p>
                </div>
              )}
              <button onClick={handleAISuggest} disabled={aiLoading || !aiDesc || !aiAmt}
                style={{ background: aiLoading ? '#1A2A1A' : 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: aiLoading ? '#3A4A60' : '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 10, padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {aiLoading ? '⏳ AI กำลังคิด...' : '🤖 ขอคำแนะนำจาก AI'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE JOURNAL MODAL ── */}
      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>บันทึกรายการสมุดรายวัน</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ ...inp, display: 'block', padding: 0, background: 'none', border: 'none', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>วันที่</label>
                  <input {...register('date')} type="date" style={inp} />
                  {errors.date && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.date.message}</p>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>เลขที่อ้างอิง</label>
                  <input {...register('reference')} placeholder="INV-001 (ไม่บังคับ)" style={inp} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>คำอธิบายรายการ</label>
                <input {...register('description')} placeholder="รับเงินค่าบริการจากลูกค้า" style={{ ...inp, padding: '10px 14px' }} />
                {errors.description && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.description.message}</p>}
              </div>

              {/* Entries table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em' }}>รายการบัญชี (Double-Entry)</label>
                  <button type="button" onClick={() => append({ account_id: '', debit: 0, credit: 0, description: '' })}
                    style={{ fontSize: 11, background: '#151C28', border: '1px solid #1E2A3A', color: '#8A9BB0', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
                    + เพิ่มบรรทัด
                  </button>
                </div>
                <div style={{ background: '#070A0F', borderRadius: 10, overflow: 'hidden', border: '1px solid #151C28' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['บัญชี','Debit (Dr)','Credit (Cr)','คำอธิบาย',''].map(h => (
                          <th key={h} style={{ padding: '8px 10px', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28', textAlign: ['Debit (Dr)','Credit (Cr)'].includes(h) ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, i) => (
                        <tr key={field.id}>
                          <td style={{ padding: '6px 8px', width: '35%' }}>
                            <select {...register(`entries.${i}.account_id`)} style={{ ...inp, fontSize: 11 }}>
                              <option value="">-- เลือกบัญชี --</option>
                              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px', width: '18%' }}>
                            <input {...register(`entries.${i}.debit`, { valueAsNumber: true })} type="number" min="0" step="0.01" placeholder="0.00"
                              style={{ ...inp, textAlign: 'right', color: '#43E97B' }} />
                          </td>
                          <td style={{ padding: '6px 8px', width: '18%' }}>
                            <input {...register(`entries.${i}.credit`, { valueAsNumber: true })} type="number" min="0" step="0.01" placeholder="0.00"
                              style={{ ...inp, textAlign: 'right', color: '#F093FB' }} />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input {...register(`entries.${i}.description`)} placeholder="คำอธิบาย" style={{ ...inp, fontSize: 11 }} />
                          </td>
                          <td style={{ padding: '6px 8px', width: 32 }}>
                            {fields.length > 2 && (
                              <button type="button" onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer', fontSize: 14, padding: 2 }}>✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#0A0E16' }}>
                        <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#4A5A70' }}>รวม</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#43E97B' }}>{totalDebit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#F093FB' }}>{totalCredit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td colSpan={2} style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: balanced ? '#43E97B' : '#FF6B6B' }}>
                            {balanced ? '✓ สมดุล' : `✗ ต่าง ${Math.abs(totalDebit - totalCredit).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {errors.entries && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#FF6B6B' }}>{(errors.entries as any).message || 'กรุณาตรวจสอบรายการ'}</p>}
              </div>

              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid #1E2A3A', background: 'transparent', color: '#6A7A90', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending || !balanced}
                  style={{ background: balanced ? 'linear-gradient(135deg,#00D4AA,#4FACFE)' : '#1A2A1A', color: balanced ? '#07090E' : '#3A4A60', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 22px', cursor: balanced ? 'pointer' : 'not-allowed', opacity: createM.isPending ? 0.7 : 1 }}>
                  {createM.isPending ? 'กำลังบันทึก...' : 'บันทึก Journal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── VIEW JOURNAL DETAIL MODAL ── */}
      {viewJournal && (
        <div style={overlay} onClick={() => setViewJournal(null)}>
          <div style={{ ...modal, maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 800, fontFamily: 'monospace', color: '#4FACFE' }}>{viewJournal.number}</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#4A5A70' }}>{viewJournal.description}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_META[viewJournal.status].color, background: STATUS_META[viewJournal.status].color+'18', border: `1px solid ${STATUS_META[viewJournal.status].color}35`, padding: '3px 10px', borderRadius: 10 }}>
                  {STATUS_META[viewJournal.status].label}
                </span>
                <button onClick={() => setViewJournal(null)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>
            </div>
            <div style={{ padding: 24 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: '#070A0F', borderRadius: 10, overflow: 'hidden' }}>
                <thead>
                  <tr>
                    {['บัญชี','Debit','Credit','คำอธิบาย'].map(h => (
                      <th key={h} style={{ padding: '9px 14px', fontSize: 10, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28', textAlign: ['Debit','Credit'].includes(h) ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewJournal.entries.map((e, i) => (
                    <tr key={i}>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>
                        <span style={{ color: '#4FACFE', fontFamily: 'monospace', marginRight: 6 }}>{e.account_code}</span>
                        <span style={{ color: '#DDE3EE' }}>{e.account_name}</span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: Number(e.debit) > 0 ? '#43E97B' : '#2A3A50', fontWeight: Number(e.debit) > 0 ? 700 : 400 }}>{Number(e.debit) > 0 ? Number(e.debit).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: Number(e.credit) > 0 ? '#F093FB' : '#2A3A50', fontWeight: Number(e.credit) > 0 ? 700 : 400 }}>{Number(e.credit) > 0 ? Number(e.credit).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: '#6A7A90' }}>{e.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#0A0E16' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#4A5A70' }}>รวม</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#43E97B' }}>{Number(viewJournal.total_debit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#F093FB' }}>{Number(viewJournal.total_credit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {viewJournal.status === 'draft' && (
                <div style={{ marginTop: 20, textAlign: 'right' }}>
                  <button onClick={() => { postM.mutate(viewJournal.id); setViewJournal(null) }}
                    style={{ background: '#43E97B', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px 24px', cursor: 'pointer' }}>
                    ✓ Post Journal
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
