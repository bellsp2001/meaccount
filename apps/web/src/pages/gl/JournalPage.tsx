import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { JOURNAL_TYPES, JOURNAL_TYPE_META, isJournalType, type JournalType } from '@/config/journals'
import { JournalTypeBadge as TypeBadge } from '@/components/ui/JournalTypeBadge'
import DocCard from '@/components/doc/DocCard'
import { docBadge, docActionBtn, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote } from '@/components/doc/docStyles'
import SearchSelect from '@/components/ui/SearchSelect'

interface Account { id: string; code: string; name: string; account_type: string; normal_balance: string }
interface JEntry  { id: string; account_id: string; account_code?: string; account_name?: string; debit: number; credit: number; description?: string }
interface Journal { id: string; number: string; date: string; description: string; reference?: string; journal_type: JournalType; status: 'draft'|'posted'|'reversed'; entries: JEntry[]; total_debit?: number; total_credit?: number; ai_suggested?: boolean }

const TYPE_META = JOURNAL_TYPE_META
const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const entrySchema = z.object({
  account_id:  z.string().min(1, 'เลือกบัญชี'),
  debit:       z.number().min(0),
  credit:      z.number().min(0),
  description: z.string().optional(),
})
const journalSchema = z.object({
  journal_type: z.enum(['general','sales','purchase','receipt','payment']),
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
  draft:    { label: 'ฉบับร่าง', color: '#F5A623' },
  posted:   { label: 'Posted',   color: '#43E97B' },
  reversed: { label: 'Reversed', color: '#FF6B6B' },
}

const inp: React.CSSProperties = { background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--color-text)', outline: 'none', width: '100%', boxSizing: 'border-box' }

export default function JournalPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiAmt, setAiAmt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{explanation:string;confidence:number}|null>(null)
  // One card serves recording and viewing: `viewJournal` is the journal shown (null = new);
  // a recorded journal opens read-only in the same layout.
  const [viewJournal, setViewJournal] = useState<Journal|null>(null)

  // The selected book lives in the URL (?type=sales) so it survives reloads and can be linked to.
  const [params, setParams] = useSearchParams()
  const rawType = params.get('type')
  const activeType: JournalType | null = isJournalType(rawType) ? rawType : null
  const selectType = (t: JournalType | null) => setParams(t ? { type: t } : {}, { replace: true })

  const { data: journals = [], isLoading } = useQuery<Journal[]>({
    queryKey: ['journals', activeType ?? 'all'],
    queryFn: async () => (await api.get('/api/v1/journals/', { params: activeType ? { journal_type: activeType } : {} })).data,
  })
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/api/v1/accounts/')).data,
  })

  // Record as a draft, or record and confirm (post) in one go. If recording works but
  // posting fails, the journal stays a draft and opens with the reason.
  const [actionError, setActionError] = useState<string | null>(null)
  const createM = useMutation({
    mutationFn: async ({ d, confirm }: { d: JForm; confirm: boolean }) => {
      const { data: saved } = await api.post('/api/v1/journals/', d)
      if (!confirm) return { j: saved as Journal, error: null }
      try { return { j: (await api.post(`/api/v1/journals/${saved.id}/post`)).data as Journal, error: null } }
      catch (e) { return { j: saved as Journal, error: errText(e, 'ยืนยันรายการไม่สำเร็จ') } }
    },
    onSuccess: ({ j, error }) => { qc.invalidateQueries({ queryKey: ['journals'] }); openView(j); setActionError(error) },   // recorded: show it
  })
  const postM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/journals/${id}/post`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journals'] }); setActionError(null) },
    onError: (e) => setActionError(errText(e, 'ยืนยันรายการไม่สำเร็จ')),
  })

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<JForm>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      journal_type: 'general',
      date: localToday(),
      entries: [
        { account_id: '', debit: 0, credit: 0, description: '' },
        { account_id: '', debit: 0, credit: 0, description: '' },
      ],
    },
  })
  const blankEntry = { account_id: '', debit: 0, credit: 0, description: '' }
  const openCreate = () => {
    setViewJournal(null); setAiResult(null); createM.reset(); setActionError(null)
    reset({ journal_type: activeType ?? 'general', date: localToday(), description: '', reference: '', entries: [blankEntry, { ...blankEntry }] })
    setShowCreate(true)
  }
  const openView = (j: Journal) => {
    setViewJournal(j); createM.reset(); setActionError(null)
    reset({ journal_type: j.journal_type, date: j.date, description: j.description, reference: j.reference ?? '',
            entries: j.entries.map(e => ({ account_id: e.account_id, debit: Number(e.debit), credit: Number(e.credit), description: e.description ?? '' })) })
    setShowCreate(true)
  }
  const closeCard = () => { setShowCreate(false); setViewJournal(null) }
  const readOnly = !!viewJournal
  // Posting refetches the list; show the fresh copy.
  const current = viewJournal ? (journals.find(j => j.id === viewJournal.id) ?? viewJournal) : null
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
        setValue('journal_type', activeType ?? 'general')
        setAiMode(false)
        setViewJournal(null)
        setShowCreate(true)
      }
    } catch { setAiResult({ explanation: 'ไม่สามารถเชื่อมต่อ AI ได้', confidence: 0 }) }
    finally { setAiLoading(false) }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '92vh', overflowY: 'auto' }

  // The journal card replaces the list on the page.
  const panelOpen = showCreate
  const bookName = activeType ? TYPE_META[activeType].full : 'สมุดรายวัน'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!panelOpen && <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{activeType ? TYPE_META[activeType].full : 'สมุดรายวัน'}</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>{activeType ? TYPE_META[activeType].en : 'ทุกเล่ม'} — Double-Entry Bookkeeping</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setAiMode(true)}
            style={{ background: '#F2714E15', border: '1px solid #F2714E40', color: '#F2714E', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
            🤖 AI แนะนำการลงบัญชี
          </button>
          <button onClick={openCreate}
            style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
            + บันทึกรายการใหม่
          </button>
        </div>
      </div>

      {/* Book tabs — scrolls sideways on narrow screens instead of wrapping */}
      <div style={{ overflowX: 'auto', margin: '-4px -4px 0', padding: 4 }}>
        <div className="seg" role="tablist" aria-label="ประเภทสมุดรายวัน" style={{ whiteSpace: 'nowrap' }}>
          <button role="tab" aria-selected={!activeType} data-active={!activeType} onClick={() => selectType(null)}>ทั้งหมด</button>
          {JOURNAL_TYPES.map(t => (
            <button key={t.key} role="tab" aria-selected={activeType === t.key} data-active={activeType === t.key} onClick={() => selectType(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Journal list */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        ) : journals.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📒</p>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>{activeType ? `ยังไม่มีรายการใน${TYPE_META[activeType].full}` : 'ยังไม่มีรายการสมุดรายวัน'}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่','วันที่','ประเภท','คำอธิบาย','Dr','Cr','สถานะ','Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: ['Dr','Cr'].includes(h) ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journals.map(j => {
                const sm = STATUS_META[j.status]
                return (
                  <tr key={j.id} onClick={() => openView(j)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: 'monospace', fontSize: 12, color: 'var(--color-accent-light)' }}>{j.number}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{new Date(j.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}><TypeBadge type={j.journal_type} /></td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13 }}>
                      <span>{j.description}</span>
                      {j.ai_suggested && <span style={{ marginLeft: 8, fontSize: 9, background: '#F2714E15', color: '#F2714E', border: '1px solid #F2714E30', padding: '1px 6px', borderRadius: 8 }}>AI</span>}
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#43E97B' }}>{Number(j.total_debit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#F093FB' }}>{Number(j.total_credit || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color+'18', border: `1px solid ${sm.color}35`, padding: '2px 9px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
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

      </>}

      {/* ── AI MODAL ── */}
      {aiMode && (
        <div style={overlay} onClick={() => setAiMode(false)}>
          <div style={{ ...modal, maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🤖</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI แนะนำการลงบัญชี</h3>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>บอกรายการ AI จะเลือกบัญชีให้อัตโนมัติ</p>
                </div>
              </div>
              <button onClick={() => setAiMode(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>อธิบายรายการ</label>
                <input value={aiDesc} onChange={e => setAiDesc(e.target.value)} placeholder="เช่น: ซื้อกระดาษ A4 สำนักงาน, รับค่าบริการจากลูกค้า ABC..."
                  style={{ ...inp, padding: '11px 14px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>จำนวนเงิน (บาท)</label>
                <input type="number" value={aiAmt} onChange={e => setAiAmt(e.target.value)} placeholder="5000"
                  style={{ ...inp, padding: '11px 14px' }} />
              </div>
              {aiResult && (
                <div style={{ background: aiResult.confidence > 0.7 ? '#43E97B12' : '#F5A62312', border: `1px solid ${aiResult.confidence > 0.7 ? '#43E97B35' : '#F5A62335'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: aiResult.confidence > 0.7 ? '#43E97B' : '#F5A623' }}>
                    {aiResult.confidence > 0.7 ? '✓ AI แนะนำ' : '⚠ ความมั่นใจต่ำ'} ({Math.round(aiResult.confidence * 100)}%)
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{aiResult.explanation}</p>
                </div>
              )}
              <button onClick={handleAISuggest} disabled={aiLoading || !aiDesc || !aiAmt}
                style={{ background: aiLoading ? '#1A2A1A' : 'linear-gradient(135deg,#FF9E80,#F2714E)', color: aiLoading ? 'var(--color-dim)' : 'var(--color-bg)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 10, padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {aiLoading ? '⏳ AI กำลังคิด...' : '🤖 ขอคำแนะนำจาก AI'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── JOURNAL CARD — one layout for recording and viewing ── */}
      {showCreate && (
          <DocCard
            title={current ? <span style={{ fontFamily: 'monospace' }}>{current.number}</span> : 'บันทึกรายการสมุดรายวัน'}
            subtitle={current ? current.description : 'Double-Entry Bookkeeping'}
            onBack={closeCard} backLabel={`กลับไปที่${bookName}`}
            actions={current && <>
              <TypeBadge type={current.journal_type} />
              <span style={docBadge(STATUS_META[current.status].color)}>{STATUS_META[current.status].label}</span>
            </>}>
            <form onSubmit={handleSubmit(d => createM.mutate({ d, confirm: false }))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>สมุดรายวัน</label>
                <SearchSelect {...register('journal_type')} style={{ ...inp, padding: '10px 12px', cursor: 'pointer' }}>
                  {JOURNAL_TYPES.map(t => <option key={t.key} value={t.key}>{t.full}</option>)}
                </SearchSelect>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ ...inp, display: 'block', padding: 0, background: 'none', border: 'none', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>วันที่</label>
                  <input {...register('date')} type="date" style={inp} />
                  {errors.date && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.date.message}</p>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>เลขที่อ้างอิง</label>
                  <input {...register('reference')} placeholder="INV-001 (ไม่บังคับ)" style={inp} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>คำอธิบายรายการ</label>
                <input {...register('description')} placeholder="รับเงินค่าบริการจากลูกค้า" style={{ ...inp, padding: '10px 14px' }} />
                {errors.description && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.description.message}</p>}
              </div>

              {/* Entries table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>รายการบัญชี (Double-Entry)</label>
                  <button type="button" className="doc-edit-only" onClick={() => append({ account_id: '', debit: 0, credit: 0, description: '' })}
                    style={{ fontSize: 11, background: 'var(--color-border)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
                    + เพิ่มบรรทัด
                  </button>
                </div>
                <div style={{ background: 'var(--color-bg-inset)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['บัญชี','Debit (Dr)','Credit (Cr)','คำอธิบาย',''].map(h => (
                          <th key={h} style={{ padding: '8px 10px', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)', textAlign: ['Debit (Dr)','Credit (Cr)'].includes(h) ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, i) => (
                        <tr key={field.id}>
                          <td style={{ padding: '6px 8px', width: '35%' }}>
                            <SearchSelect {...register(`entries.${i}.account_id`)} style={{ ...inp, fontSize: 11 }}>
                              <option value="">-- เลือกบัญชี --</option>
                              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                            </SearchSelect>
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
                              <button type="button" className="doc-edit-only" onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer', fontSize: 14, padding: 2 }}>✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--color-bg-inset)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--color-muted)' }}>รวม</td>
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
              </fieldset>

              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล</p></div>}
              {current && actionError && <div role="alert" style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{actionError}</p></div>}
              <div style={docFooter}>
                {current ? <>
                  {current.status !== 'draft' && <span style={docLockedNote}>รายการนี้ยืนยันและลงบัญชีแล้ว</span>}
                  {current.status === 'draft' && <button type="button" disabled={postM.isPending} onClick={() => postM.mutate(current.id)}
                    style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), opacity: postM.isPending ? 0.7 : 1 }}>{postM.isPending ? 'กำลังยืนยัน...' : '✓ ยืนยัน · Post'}</button>}
                </> : <>
                  <button type="button" onClick={closeCard} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending || !balanced}
                    style={{ ...docActionBtn('#F2714E'), ...(balanced ? {} : { color: 'var(--color-dim)', borderColor: 'var(--color-border)', cursor: 'not-allowed' }), opacity: createM.isPending ? 0.7 : 1 }}>บันทึกร่าง</button>
                  <button type="button" disabled={createM.isPending || !balanced} onClick={handleSubmit(d => createM.mutate({ d, confirm: true }))}
                    style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), ...(balanced ? {} : { background: 'var(--color-bg-inset)', color: 'var(--color-dim)', cursor: 'not-allowed' }), opacity: createM.isPending ? 0.7 : 1 }}>
                    {createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึกและยืนยัน · Post'}
                  </button>
                </>}
              </div>
            </form>
          </DocCard>
      )}

    </div>
  )
}
