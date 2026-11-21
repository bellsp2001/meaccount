import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { JOURNAL_TYPES, type JournalType } from '@/config/journals'
import { JournalTypeBadge } from '@/components/ui/JournalTypeBadge'
import PanelBack from '@/components/doc/PanelBack'
import SearchSelect from '@/components/ui/SearchSelect'

// ── Types ──────────────────────────────────────────────────────
type Side = 'income' | 'expense'
type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

interface Account { id: string; code: string; name: string; account_type: AccountType }
interface TaxCode { id: string; code: string; name: string; rate: number; is_active: boolean }
interface Ref { id: string; code: string; name: string }
interface Book {
  id: string; code: string; name: string; side: Side; journal_type: JournalType
  account_id: string; counter_account_id: string | null; tax_code_id: string | null
  description: string | null; is_active: boolean
  account: Ref | null; counter_account: Ref | null; tax_code: (Ref & { rate: number }) | null
}

// Mirrors services/document_books.py so the pickers only offer accounts the API will accept.
const SIDE_META: Record<Side, {
  title: string; noun: string; en: string; defaultJournal: JournalType
  mainLabel: string; mainTypes: AccountType[]; counterHint: string; example: string
}> = {
  income: {
    title: 'สมุดบันทึกรายได้', noun: 'รายได้', en: 'Income document books', defaultJournal: 'sales',
    mainLabel: 'ประเภทรายได้ (บัญชีรายได้)', mainTypes: ['income'],
    counterHint: 'เช่น ลูกหนี้การค้า (ขายเชื่อ) หรือ เงินสด/ธนาคาร (ขายสด)', example: 'ใบแจ้งหนี้/ใบกำกับภาษี',
  },
  expense: {
    title: 'สมุดบันทึกค่าใช้จ่าย', noun: 'ค่าใช้จ่าย', en: 'Expense document books', defaultJournal: 'purchase',
    mainLabel: 'ประเภทค่าใช้จ่าย (บัญชีค่าใช้จ่าย/สินทรัพย์)', mainTypes: ['expense', 'asset'],
    counterHint: 'เช่น เจ้าหนี้การค้า (ซื้อเชื่อ) หรือ เงินสด/ธนาคาร (จ่ายสด)', example: 'บิลค่าใช้จ่าย/ใบกำกับภาษีซื้อ',
  },
}
const COUNTER_TYPES: AccountType[] = ['asset', 'liability']
const TYPE_LABEL: Record<AccountType, string> = { asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของผู้ถือหุ้น', income: 'รายได้', expense: 'ค่าใช้จ่าย' }

const formSchema = z.object({
  code:               z.string().trim().min(1, 'ระบุรหัสสมุด').max(20, 'ไม่เกิน 20 ตัวอักษร'),
  name:               z.string().trim().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  journal_type:       z.enum(['general', 'sales', 'purchase', 'receipt', 'payment']),
  account_id:         z.string().min(1, 'เลือกบัญชี'),
  counter_account_id: z.string(),
  tax_code_id:        z.string(),
  description:        z.string().optional(),
  is_active:          z.boolean(),
})
type BForm = z.infer<typeof formSchema>

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }
const hint: React.CSSProperties = { margin: '4px 0 0', fontSize: 11, color: 'var(--color-dim)' }
const err: React.CSSProperties = { margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }
const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, verticalAlign: 'top' }
const iconBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--color-bg-inset)', border: 'none', cursor: 'pointer', padding: 0 }

const apiError = (e: unknown) => {
  const d = (e as any)?.response?.data?.detail
  return typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join(', ') : 'บันทึกไม่สำเร็จ กรุณาลองใหม่'
}

function AccountOptions({ accounts, types }: { accounts: Account[]; types: AccountType[] }) {
  return (
    <>
      {types.map(t => {
        const list = accounts.filter(a => a.account_type === t)
        return list.length ? (
          <optgroup key={t} label={TYPE_LABEL[t]}>
            {list.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </optgroup>
        ) : null
      })}
    </>
  )
}

function AccountCell({ acc }: { acc: Ref | null }) {
  if (!acc) return <span style={{ color: 'var(--color-dim)' }}>—</span>
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: 'monospace', color: 'var(--color-dim)', marginRight: 6 }}>{acc.code}</span>{acc.name}
    </span>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function DocumentBooksPage({ side }: { side: Side }) {
  const meta = SIDE_META[side]
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Book | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Book | null>(null)

  const { data: books = [], isLoading } = useQuery<Book[]>({
    queryKey: ['document-books', side],
    queryFn: async () => (await api.get('/api/v1/document-books/', { params: { side } })).data,
  })
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/api/v1/accounts/')).data,
  })
  const { data: taxCodes = [] } = useQuery<TaxCode[]>({
    queryKey: ['tax-codes'],
    queryFn: async () => (await api.get('/api/v1/tax/codes')).data,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BForm>({ resolver: zodResolver(formSchema) })

  const openNew = () => {
    reset({ code: '', name: '', journal_type: meta.defaultJournal, account_id: '', counter_account_id: '', tax_code_id: '', description: '', is_active: true })
    saveM.reset(); setEditing('new')
  }
  const openEdit = (b: Book) => {
    reset({ code: b.code, name: b.name, journal_type: b.journal_type, account_id: b.account_id,
      counter_account_id: b.counter_account_id ?? '', tax_code_id: b.tax_code_id ?? '', description: b.description ?? '', is_active: b.is_active })
    saveM.reset(); setEditing(b)
  }

  const saveM = useMutation({
    mutationFn: (d: BForm): Promise<unknown> => {
      const common = {
        code: d.code, name: d.name, journal_type: d.journal_type, account_id: d.account_id,
        counter_account_id: d.counter_account_id || null, tax_code_id: d.tax_code_id || null,
        description: d.description || null,
      }
      if (editing === 'new') return api.post('/api/v1/document-books/', { ...common, side })
      return api.patch(`/api/v1/document-books/${(editing as Book).id}`, {
        ...common, description: d.description ?? '', is_active: d.is_active,
        clear_counter_account: !d.counter_account_id, clear_tax_code: !d.tax_code_id,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-books'] }); setEditing(null) },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/document-books/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-books'] }); setDeleting(null) },
  })

  // Inactive tax codes stay selectable only for the book already using one.
  const currentTaxId = editing && editing !== 'new' ? editing.tax_code_id : null
  const taxOptions = taxCodes.filter(t => t.is_active || t.id === currentTaxId)
  const isNew = editing === 'new'

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{meta.title}</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>{meta.en} — กำหนดว่าเอกสารแต่ละชนิดลงสมุดรายวันเล่มไหนและผูกกับบัญชีใด</p>
        </div>
        <button onClick={openNew}
          style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + สร้างสมุดบันทึก
        </button>
      </div>

      {/* List */}
      <div style={{ background: 'var(--color-card)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        ) : books.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}>
            <p style={{ fontSize: 32, margin: '0 0 12px' }}>📚</p>
            <p style={{ margin: 0, color: 'var(--color-text)', fontSize: 14, fontWeight: 700 }}>ยังไม่มีสมุดบันทึก{meta.noun}</p>
            <p style={{ margin: '6px 0 0', color: 'var(--color-dim)', fontSize: 12 }}>สร้างสมุดสำหรับเอกสารแต่ละชนิด เช่น "{meta.example}"</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>รหัส</th>
                  <th style={th}>ชื่อสมุด</th>
                  <th style={th}>สมุดรายวัน</th>
                  <th style={th}>ประเภท{meta.noun}</th>
                  <th style={th}>บัญชีคู่</th>
                  <th style={th}>ภาษี</th>
                  <th style={th}>สถานะ</th>
                  <th style={{ ...th, width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {books.map(b => (
                  <tr key={b.id} style={{ opacity: b.is_active ? 1 : 0.55 }}>
                    <td style={{ ...td, fontFamily: 'monospace', color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>{b.code}</td>
                    <td style={{ ...td, minWidth: 160 }}>
                      <span style={{ display: 'block', fontWeight: 700 }}>{b.name}</span>
                      {b.description && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{b.description}</span>}
                    </td>
                    <td style={td}><JournalTypeBadge type={b.journal_type} /></td>
                    <td style={td}><AccountCell acc={b.account} /></td>
                    <td style={td}><AccountCell acc={b.counter_account} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{b.tax_code ? b.tax_code.code : <span style={{ color: 'var(--color-dim)' }}>—</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.is_active ? '#43E97B' : '#FF6B6B' }} />
                        {b.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openEdit(b)} title="แก้ไข" aria-label={`แก้ไข ${b.code}`} style={{ ...iconBtn, color: 'var(--color-muted)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                        <button onClick={() => { deleteM.reset(); setDeleting(b) }} title="ลบ" aria-label={`ลบ ${b.code}`} style={{ ...iconBtn, color: '#FF6B6B' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      {editing && (
        <div className="doc-panel">
          <PanelBack onClick={() => setEditing(null)} label="กลับไปที่สมุดบันทึก" />
          <div className="doc-panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{isNew ? `สร้างสมุดบันทึก${meta.noun}` : `แก้ไขสมุดบันทึก${meta.noun}`}</h3>
              <button onClick={() => setEditing(null)} aria-label="ปิด" style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => saveM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 12 }}>
                <div>
                  <label style={lbl}>รหัส</label>
                  <input {...register('code')} placeholder={side === 'income' ? 'INV' : 'EXP'} style={{ ...inp, textTransform: 'uppercase' }} />
                  {errors.code && <p style={err}>{errors.code.message}</p>}
                </div>
                <div>
                  <label style={lbl}>ชื่อสมุด / เอกสาร</label>
                  <input {...register('name')} placeholder={meta.example} style={inp} />
                  {errors.name && <p style={err}>{errors.name.message}</p>}
                </div>
              </div>

              <div>
                <label style={lbl}>ลงบันทึกผ่านสมุดรายวัน</label>
                <SearchSelect {...register('journal_type')} style={{ ...inp, cursor: 'pointer' }}>
                  {JOURNAL_TYPES.map(t => <option key={t.key} value={t.key}>{t.full}</option>)}
                </SearchSelect>
              </div>

              <div>
                <label style={lbl}>{meta.mainLabel}</label>
                <SearchSelect {...register('account_id')} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- เลือกบัญชีจากผังบัญชี --</option>
                  <AccountOptions accounts={accounts} types={meta.mainTypes} />
                </SearchSelect>
                {errors.account_id && <p style={err}>{errors.account_id.message}</p>}
              </div>

              <div>
                <label style={lbl}>บัญชีคู่</label>
                <SearchSelect {...register('counter_account_id')} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- ไม่ระบุ --</option>
                  <AccountOptions accounts={accounts} types={COUNTER_TYPES} />
                </SearchSelect>
                <p style={hint}>{meta.counterHint}</p>
              </div>

              <div>
                <label style={lbl}>ภาษี</label>
                <SearchSelect {...register('tax_code_id')} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- ไม่มีภาษี --</option>
                  {taxOptions.map(t => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
                </SearchSelect>
                <p style={hint}>จัดการรายการภาษีได้ที่ การบัญชี › ประเภทภาษี</p>
              </div>

              <div>
                <label style={lbl}>หมายเหตุ</label>
                <textarea {...register('description')} rows={2} placeholder="ใช้กับเอกสารแบบใด (ไม่บังคับ)" style={{ ...inp, resize: 'vertical' }} />
              </div>

              {!isNew && (
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--color-bg-inset)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>เปิดใช้งาน</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted)' }}>ปิดเพื่อเลิกใช้สมุดนี้โดยไม่ต้องลบ</span>
                  </span>
                  <input type="checkbox" {...register('is_active')} style={{ width: 18, height: 18, accentColor: '#F2714E', cursor: 'pointer', flexShrink: 0 }} />
                </label>
              )}

              {saveM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{apiError(saveM.error)}</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditing(null)} style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={saveM.isPending} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer', opacity: saveM.isPending ? 0.7 : 1 }}>
                  {saveM.isPending ? 'กำลังบันทึก...' : isNew ? 'สร้างสมุดบันทึก' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleting && (
        <div style={overlay} onClick={() => setDeleting(null)}>
          <div role="alertdialog" aria-labelledby="del-title" style={{ ...modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h3 id="del-title" style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>ลบสมุดบันทึก?</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                ลบ <b>{deleting.code} — {deleting.name}</b> ออกถาวร ถ้าอาจกลับมาใช้อีก ให้ปิดใช้งานแทน
              </p>
              {deleteM.isError && <p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{apiError(deleteM.error)}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleting(null)} style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={() => deleteM.mutate(deleting.id)} disabled={deleteM.isPending}
                  style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: '#FF4D6D', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: deleteM.isPending ? 0.7 : 1 }}>
                  {deleteM.isPending ? 'กำลังลบ...' : 'ลบสมุด'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
