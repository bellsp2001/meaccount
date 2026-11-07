import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { DocumentBookSelect, useDocumentBooks } from '@/components/books/DocumentBookSelect'
import DocCard from '@/components/doc/DocCard'
import { docBadge, docActionBtn, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote } from '@/components/doc/docStyles'

interface Supplier     { id: string; code: string; name: string; payment_terms: number; wht_type?: string }
interface ExpCategory  { id: string; code: string; name: string }
interface BillItem     { id: string; description: string; quantity: number; unit?: string; unit_price: number; amount: number }
interface Bill {
  id: string; number: string; supplier_id?: string; supplier?: Supplier
  category_id?: string; date: string; due_date: string; ref_number?: string
  description: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number
  wht_rate: number; wht_amount: number; total: number; net_payable: number
  paid_amount: number; balance_due: number; note?: string; gl_posted: boolean
  ai_categorized: boolean; items: BillItem[]
  book_id?: string | null; book?: { code: string; name: string } | null
  category?: { code: string; name: string } | null
}

// Editable while a draft or rejected and not posted to GL (the API enforces the same rule).
const canEdit = (b: Bill) => ['draft', 'rejected'].includes(b.status) && !b.gl_posted
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:            { label: 'Draft',       color: '#F5A623' },
  pending_approval: { label: 'รออนุมัติ',   color: 'var(--color-accent-light)' },
  approved:         { label: 'อนุมัติแล้ว', color: '#43E97B' },
  partial:          { label: 'จ่ายบางส่วน', color: '#F093FB' },
  paid:             { label: 'จ่ายครบ',     color: '#F2714E' },
  rejected:         { label: 'ปฏิเสธ',      color: '#FF6B6B' },
  cancelled:        { label: 'ยกเลิก',      color: 'var(--color-dim)' },
}

const itemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().min(0.001),
  unit:        z.string().optional(),
  unit_price:  z.number().min(0),
})
const billSchema = z.object({
  supplier_id:  z.string().optional(),
  category_id:  z.string().optional(),
  date:         z.string().min(1),
  due_date:     z.string().optional(),
  ref_number:   z.string().optional(),
  description:  z.string().min(1, 'ระบุคำอธิบาย'),
  vat_rate:     z.number().min(0).max(100),
  wht_rate:     z.number().min(0).max(100),
  note:         z.string().optional(),
  book_id:      z.string().optional(),
  items:        z.array(itemSchema).min(1),
})
type BForm = z.infer<typeof billSchema>

const inp: React.CSSProperties = { background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--color-text)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto' }

export default function BillPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showOCR, setShowOCR] = useState(false)
  // One card serves create, view and edit: `openBill` is the bill shown (null = new),
  // `readOnly` switches the same form layout between viewing and editing.
  const [openBill, setOpenBill] = useState<Bill | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [showPay, setShowPay] = useState<Bill | null>(null)
  const [showApprove, setShowApprove] = useState<{ bill: Bill; action: 'approved'|'rejected' } | null>(null)
  const [aiDesc, setAiDesc] = useState('')
  const [aiAmt, setAiAmt] = useState('')
  const [aiResult, setAiResult] = useState<any>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [approveComment, setApproveComment] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [payRef, setPayRef] = useState('')

  const { data: bills = [], isLoading } = useQuery<Bill[]>({ queryKey: ['bills'], queryFn: async () => (await api.get('/api/v1/ap/bills')).data })
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ['suppliers'], queryFn: async () => (await api.get('/api/v1/ap/suppliers')).data })
  const { data: categories = [] } = useQuery<ExpCategory[]>({ queryKey: ['categories'], queryFn: async () => (await api.get('/api/v1/ap/categories')).data })

  // "— ไม่ระบุ —" selects submit "", which the API rejects as a UUID/date — send those as absent.
  const createM  = useMutation({
    mutationFn: (d: BForm) => {
      const body = {
        ...d, supplier_id: d.supplier_id || undefined, category_id: d.category_id || undefined,
        due_date: d.due_date || undefined, book_id: d.book_id || undefined,
      }
      return openBill ? api.put(`/api/v1/ap/bills/${openBill.id}`, body) : api.post('/api/v1/ap/bills', body)
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['bills'] }); openView(r.data) },   // saved: show the bill
  })
  const submitM  = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ap/bills/${id}/submit`), onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }) })
  const approveM = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: string; comment?: string }) =>
      api.post(`/api/v1/ap/bills/${id}/approve`, { action, comment }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bills'] }); setShowApprove(null) }
  })
  const postM    = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ap/bills/${id}/post-gl`), onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }) })
  const payM     = useMutation({
    mutationFn: ({ bid, amt, method, ref }: any) => api.post('/api/v1/ap/payments', { bill_id: bid, date: new Date().toISOString().split('T')[0], amount: Number(amt), method, reference: ref }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bills'] }); setShowPay(null) }
  })

  const blankForm = (): BForm => ({
    supplier_id: '', category_id: '', date: localToday(), due_date: '', ref_number: '', description: '',
    vat_rate: 7, wht_rate: 0, note: '', book_id: '', items: [{ description: '', quantity: 1, unit: '', unit_price: 0 }],
  })
  const billForm = (b: Bill): BForm => ({
    supplier_id: b.supplier_id ?? '', category_id: b.category_id ?? '', date: b.date, due_date: b.due_date,
    ref_number: b.ref_number ?? '', description: b.description, vat_rate: Number(b.vat_rate), wht_rate: Number(b.wht_rate),
    note: b.note ?? '', book_id: b.book_id ?? '',
    items: b.items.map(it => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit ?? '', unit_price: Number(it.unit_price) })),
  })
  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<BForm>({
    resolver: zodResolver(billSchema),
    defaultValues: blankForm(),
  })
  const openCard = (b: Bill | null, ro: boolean) => {
    setOpenBill(b); reset(b ? billForm(b) : blankForm()); setReadOnly(ro); createM.reset(); setShowCreate(true)
  }
  const openCreate = () => openCard(null, false)
  const openView = (b: Bill) => openCard(b, true)
  const openEdit = (b: Bill) => openCard(b, false)
  const closeForm = () => { setShowCreate(false); setOpenBill(null); setReadOnly(false) }
  // Cancelling an edit goes back to viewing the bill; cancelling a new one goes back to the list.
  const cancelForm = () => openBill ? openView(openBill) : closeForm()
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')
  // Not `|| 7`: a 0% bill must preview as 0, not fall back to 7.
  const vatInput   = watch('vat_rate')
  const watchVAT   = Number.isFinite(vatInput) ? vatInput : 0
  const watchWHT   = watch('wht_rate') || 0
  // Offer every common WHT rate plus whatever a book filled in, so the select never shows a stale value.
  const whtRates   = Array.from(new Set([0, 1, 2, 3, 5, watchWHT])).sort((a, b) => a - b)

  // Picking a book fills the rate of its tax type (VAT or WHT); both fields stay editable.
  const { data: expenseBooks = [] } = useDocumentBooks('expense')
  const bookField = register('book_id', {
    onChange: e => {
      const tax = expenseBooks.find(b => b.id === e.target.value)?.tax_code
      if (tax?.kind === 'vat') setValue('vat_rate', Number(tax.rate))
      if (tax?.kind === 'wht') setValue('wht_rate', Number(tax.rate))
    },
  })
  const subtotal   = watchItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  const vatAmt     = subtotal * watchVAT / 100
  const whtAmt     = subtotal * watchWHT / 100
  const total      = subtotal + vatAmt
  const netPayable = total - whtAmt

  async function handleAICategorize() {
    if (!aiDesc || !aiAmt) return
    const { data } = await api.post('/api/v1/ap/ai/categorize', { description: aiDesc, amount: Number(aiAmt) })
    setAiResult(data)
    if (data.category_code) {
      const cat = categories.find((c: ExpCategory) => c.code === data.category_code)
      if (cat) setValue('category_id', cat.id)
    }
    setValue('description', aiDesc)
    setShowCreate(true)
    setShowOCR(false)
  }

  async function handleOCR(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setOcrLoading(true)
    const form = new FormData(); form.append('file', file)
    try {
      const { data } = await api.post('/api/v1/ap/ai/ocr-receipt', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setOcrResult(data)
      if (data.supplier_name) setValue('description', data.supplier_name)
      if (data.ref_number)    setValue('ref_number', data.ref_number)
      if (data.items?.length > 0) {
        const mapped = data.items.map((it: any, i: number) => ({
          description: it.description || `รายการ ${i+1}`, quantity: 1, unit_price: Number(it.amount || 0)
        }))
        setValue('items', mapped)
      }
    } catch { alert('ไม่สามารถอ่านเอกสารได้') }
    finally { setOcrLoading(false) }
  }

  const totalPayable = bills.filter(b => ['approved','partial'].includes(b.status)).reduce((s, b) => s + Number(b.balance_due), 0)
  const pendingApproval = bills.filter(b => b.status === 'pending_approval').length

  // The form or a bill's detail replaces the list on the page.
  const panelOpen = showCreate
  // Approval, posting and payments refetch the list; show the fresh copy.
  const current = openBill ? (bills.find(b => b.id === openBill.id) ?? openBill) : null
  const supplierMissing = current?.supplier && !suppliers.some(s => s.id === current.supplier_id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!panelOpen && <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>บิล / ค่าใช้จ่าย</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Accounts Payable — ทั้งหมด {bills.length} รายการ</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowOCR(true)} style={{ background: '#F2714E15', border: '1px solid #F2714E40', color: '#F2714E', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
            📄 OCR ใบเสร็จ
          </button>
          <button onClick={openCreate} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
            + บันทึกค่าใช้จ่าย
          </button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
        {[
          { l: 'ค้างจ่ายทั้งหมด',   v: `฿${totalPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: '#FF6B6B' },
          { l: 'รออนุมัติ',          v: pendingApproval,                                                            color: 'var(--color-accent-light)' },
          { l: 'อนุมัติแล้ว/รอจ่าย', v: bills.filter(b => b.status === 'approved').length,                          color: '#43E97B' },
          { l: 'Draft',              v: bills.filter(b => b.status === 'draft').length,                              color: '#F5A623' },
        ].map(s => (
          <div key={s.l} style={{ background: 'var(--color-card)', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)' }}>{s.l}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        : bills.length === 0 ? <div style={{ padding: 56, textAlign: 'center', color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีรายการ</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่','ผู้จำหน่าย','คำอธิบาย','ครบกำหนด','ค้างจ่าย','สถานะ','GL','Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bills.map(bill => {
                const sm = STATUS_META[bill.status] || STATUS_META.draft
                const overdue = new Date(bill.due_date) < new Date() && !['paid','cancelled','rejected'].includes(bill.status)
                return (
                  <tr key={bill.id} onClick={() => openView(bill)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: 'monospace', fontSize: 11, color: '#F093FB' }}>{bill.number}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12 }}>{bill.supplier?.name || <span style={{ color: 'var(--color-dim)' }}>—</span>}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bill.description}
                      {bill.ai_categorized && <span style={{ marginLeft: 6, fontSize: 9, background: '#F2714E15', color: '#F2714E', border: '1px solid #F2714E30', padding: '1px 5px', borderRadius: 8 }}>AI</span>}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11, color: overdue ? '#FF6B6B' : 'var(--color-text-tertiary)' }}>
                      {new Date(bill.due_date).toLocaleDateString('th-TH')}
                      {overdue && <span style={{ marginLeft: 4, fontSize: 9, color: '#FF6B6B' }}>⚠</span>}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: Number(bill.balance_due) > 0 ? '#F093FB' : '#43E97B' }}>
                      {Number(bill.balance_due) > 0 ? `฿${Number(bill.balance_due).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '✓'}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color + '18', border: `1px solid ${sm.color}35`, padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      {bill.gl_posted ? <span style={{ fontSize: 10, color: '#43E97B' }}>✓</span> : <span style={{ fontSize: 10, color: 'var(--color-dim)' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canEdit(bill) && (
                          <button onClick={() => openEdit(bill)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #0A84FF40', background: '#0A84FF12', color: '#0A84FF', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>✎ แก้ไข</button>
                        )}
                        {bill.status === 'draft' && (
                          <button onClick={() => submitM.mutate(bill.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #FFB59E40', background: '#FFB59E12', color: 'var(--color-accent-light)', cursor: 'pointer', fontWeight: 700 }}>ส่งขออนุมัติ</button>
                        )}
                        {bill.status === 'pending_approval' && (
                          <>
                            <button onClick={() => setShowApprove({ bill, action: 'approved' })} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #43E97B40', background: '#43E97B12', color: '#43E97B', cursor: 'pointer', fontWeight: 700 }}>อนุมัติ</button>
                            <button onClick={() => setShowApprove({ bill, action: 'rejected' })} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #FF6B6B40', background: '#FF6B6B12', color: '#FF6B6B', cursor: 'pointer' }}>ปฏิเสธ</button>
                          </>
                        )}
                        {bill.status === 'approved' && !bill.gl_posted && (
                          <button onClick={() => postM.mutate(bill.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #F5A62340', background: '#F5A62312', color: '#F5A623', cursor: 'pointer', fontWeight: 700 }}>Post GL</button>
                        )}
                        {['approved', 'partial'].includes(bill.status) && (
                          <button onClick={() => { setShowPay(bill); setPayAmount(String(bill.balance_due)); setPayMethod('bank_transfer'); setPayRef('') }}
                            style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #F093FB40', background: '#F093FB12', color: '#F093FB', cursor: 'pointer', fontWeight: 700 }}>จ่าย</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      </>}

      {/* ── OCR + AI MODAL ── */}
      {showOCR && (
        <div style={overlay} onClick={() => setShowOCR(false)}>
          <div style={{ ...modal, maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 22 }}>🤖</span>
                <div><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI ช่วยบันทึกค่าใช้จ่าย</h3><p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>OCR ใบเสร็จ หรือให้ AI จัดหมวดหมู่อัตโนมัติ</p></div>
              </div>
              <button onClick={() => setShowOCR(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* OCR upload */}
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>📄 สแกนใบเสร็จ</p>
                <label style={{ display: 'block', background: 'var(--color-bg-inset)', border: '2px dashed var(--color-border-strong)', borderRadius: 12, padding: '24px', textAlign: 'center', cursor: 'pointer' }}>
                  <input type="file" accept="image/*,.pdf" onChange={handleOCR} style={{ display: 'none' }} />
                  <p style={{ margin: '0 0 6px', fontSize: 24 }}>{ocrLoading ? '⏳' : '📁'}</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>{ocrLoading ? 'AI กำลังอ่าน...' : 'คลิกเพื่ออัปโหลด JPG/PNG/PDF'}</p>
                </label>
                {ocrResult && !ocrResult.error && (
                  <div style={{ marginTop: 12, background: '#F2714E08', border: '1px solid #F2714E25', borderRadius: 10, padding: 14 }}>
                    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#F2714E' }}>✓ อ่านสำเร็จ (ข้อมูลถูกนำไปใส่ใน Form แล้ว)</p>
                    {ocrResult.supplier_name && <p style={{ margin: '2px 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>ผู้ขาย: {ocrResult.supplier_name}</p>}
                    {ocrResult.total && <p style={{ margin: '2px 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>ยอดรวม: ฿{Number(ocrResult.total).toLocaleString('th-TH')}</p>}
                    <button onClick={() => { setShowOCR(false); setShowCreate(true) }} style={{ marginTop: 10, background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 700, fontSize: 12, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                      เปิด Form บันทึก →
                    </button>
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>🤖 AI จัดหมวดหมู่อัตโนมัติ</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={aiDesc} onChange={e => setAiDesc(e.target.value)} placeholder="อธิบายค่าใช้จ่าย เช่น ซื้อกระดาษ A4 สำนักงาน, ค่าไฟฟ้าเดือนมกราคม..." style={{ ...inp, padding: '10px 12px' }} />
                  <input type="number" value={aiAmt} onChange={e => setAiAmt(e.target.value)} placeholder="จำนวนเงิน (บาท)" style={{ ...inp, padding: '10px 12px' }} />
                  {aiResult && (
                    <div style={{ background: '#FFB59E10', border: '1px solid #FFB59E30', borderRadius: 10, padding: '12px 14px' }}>
                      <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-accent-light)' }}>
                        AI แนะนำ: {aiResult.category_name} ({Math.round(aiResult.confidence * 100)}%)
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{aiResult.explanation}</p>
                    </div>
                  )}
                  <button onClick={handleAICategorize} disabled={!aiDesc || !aiAmt}
                    style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 700, fontSize: 12, border: 'none', borderRadius: 9, padding: '10px', cursor: 'pointer', opacity: !aiDesc || !aiAmt ? 0.5 : 1 }}>
                    🤖 จัดหมวดหมู่ + เปิด Form
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BILL CARD — one layout for create, view and edit ── */}
      {showCreate && (
          <DocCard
            title={current ? `${readOnly ? '' : 'แก้ไข'}บิล ${current.number}` : 'บันทึกค่าใช้จ่าย / Bill'}
            subtitle={current ? (current.supplier?.name || 'ไม่ระบุผู้จำหน่าย') : 'บิล / ค่าใช้จ่าย'}
            onBack={closeForm} backLabel="กลับไปที่บิล / ค่าใช้จ่าย"
            actions={current && <>
              <span style={docBadge((STATUS_META[current.status] || STATUS_META.draft).color)}>{(STATUS_META[current.status] || STATUS_META.draft).label}</span>
              {current.gl_posted && <span style={docBadge('#43E97B')}>✓ ลงบัญชีแล้ว</span>}
            </>}>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <DocumentBookSelect side="expense" field={bookField} value={watch('book_id')} inputStyle={inp} labelStyle={lbl} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>ผู้จำหน่าย</label>
                  <select {...register('supplier_id')} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="">— ไม่ระบุ —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    {supplierMissing && current?.supplier && <option value={current.supplier_id}>{current.supplier.code} — {current.supplier.name}</option>}
                  </select>
                </div>
                <div>
                  <label style={lbl}>หมวดหมู่</label>
                  <select {...register('category_id')} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="">— เลือกหมวดหมู่ —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>คำอธิบาย *</label>
                <input {...register('description')} placeholder="ค่าวัสดุสำนักงานเดือนกุมภาพันธ์" style={{ ...inp, padding: '10px 12px' }} />
                {errors.description && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.description.message}</p>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>วันที่</label><input {...register('date')} type="date" style={inp} /></div>
                <div><label style={lbl}>ครบกำหนด</label><input {...register('due_date')} type="date" style={inp} /></div>
                <div><label style={lbl}>เลขที่ใบ (Supplier)</label><input {...register('ref_number')} placeholder="INV-SUPPLIER" style={inp} /></div>
                <div>
                  <label style={lbl}>VAT %</label>
                  <input {...register('vat_rate', { valueAsNumber: true })} type="number" min="0" max="100" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>ภาษีหัก ณ ที่จ่าย (%)</label>
                <select {...register('wht_rate', { valueAsNumber: true })} style={{ ...inp, cursor: 'pointer', width: 200 }}>
                  {whtRates.map(r => <option key={r} value={r}>{r === 0 ? 'ไม่หัก (0%)' : `${r}%`}</option>)}
                </select>
              </div>

              {/* Items */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ ...lbl, margin: 0 }}>รายการ</label>
                  <button type="button" className="doc-edit-only" onClick={() => append({ description: '', quantity: 1, unit_price: 0 })}
                    style={{ fontSize: 11, background: 'var(--color-border)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background: 'var(--color-bg-inset)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['รายละเอียด', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'จำนวนเงิน', ''].map(h => <th key={h} style={{ padding: '7px 8px', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {fields.map((field, i) => {
                        const it = watchItems[i] || {}
                        const amt = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
                        return (
                          <tr key={field.id}>
                            <td style={{ padding: '5px 6px', width: '38%' }}><input {...register(`items.${i}.description`)} placeholder="ชื่อสินค้า/บริการ" style={{ ...inp, fontSize: 11 }} /></td>
                            <td style={{ padding: '5px 6px', width: '12%' }}><input {...register(`items.${i}.quantity`, { valueAsNumber: true })} type="number" min="0.001" step="0.01" style={{ ...inp, fontSize: 11 }} /></td>
                            <td style={{ padding: '5px 6px', width: '10%' }}><input {...register(`items.${i}.unit`)} placeholder="ชิ้น" style={{ ...inp, fontSize: 11 }} /></td>
                            <td style={{ padding: '5px 6px', width: '18%' }}><input {...register(`items.${i}.unit_price`, { valueAsNumber: true })} type="number" min="0" step="0.01" style={{ ...inp, fontSize: 11, textAlign: 'right' }} /></td>
                            <td style={{ padding: '5px 6px', width: '16%', fontFamily: 'monospace', fontSize: 12, color: '#F093FB', textAlign: 'right', paddingRight: 10 }}>{amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                            <td style={{ padding: '5px 6px', width: 28 }}>{fields.length > 1 && <button type="button" className="doc-edit-only" onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer', fontSize: 13 }}>✕</button>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '14px 20px', minWidth: 260 }}>
                  {[
                    ['ก่อน VAT', `฿${subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, 'var(--color-text)'],
                    [`VAT ${watchVAT}%`, `฿${vatAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, '#F5A623'],
                    [`ภาษีหัก ณ ที่จ่าย ${watchWHT}%`, `-฿${whtAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, '#FF6B6B'],
                  ].map(([l, v, c]) => (
                    <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>{l}</span><span style={{ color: c as string }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', borderTop: '1px solid var(--color-border-strong)', marginTop: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>ยอดที่ต้องจ่ายจริง</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#F093FB' }}>฿{netPayable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {readOnly && current && Number(current.paid_amount) > 0 && <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: 12 }}><span style={{ color: 'var(--color-text-tertiary)' }}>จ่ายแล้ว</span><span style={{ color: '#43E97B' }}>{baht(current.paid_amount)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0 0', fontSize: 12 }}><span style={{ color: 'var(--color-text-tertiary)' }}>ค้างจ่าย</span><span style={{ color: '#FF6B6B', fontWeight: 700 }}>{baht(current.balance_due)}</span></div>
                  </>}
                </div>
              </div>

              <div><label style={lbl}>หมายเหตุ</label><textarea {...register('note')} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" /></div>
              </fieldset>

              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{typeof (createM.error as any)?.response?.data?.detail === 'string' ? (createM.error as any).response.data.detail : 'เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล'}</p></div>}
              <div style={docFooter}>
                {readOnly && current ? <>
                  {!canEdit(current) && <span style={docLockedNote}>แก้ไขได้เฉพาะ Draft หรือที่ถูกปฏิเสธ และยังไม่ Post GL</span>}
                  {current.status === 'draft' && <button type="button" onClick={() => submitM.mutate(current.id)} style={docActionBtn('#FFB59E')}>ส่งขออนุมัติ</button>}
                  {current.status === 'pending_approval' && <>
                    <button type="button" onClick={() => setShowApprove({ bill: current, action: 'rejected' })} style={docActionBtn('#FF6B6B')}>ปฏิเสธ</button>
                    <button type="button" onClick={() => setShowApprove({ bill: current, action: 'approved' })} style={docActionBtn('#43E97B')}>อนุมัติ</button>
                  </>}
                  {current.status === 'approved' && !current.gl_posted && <button type="button" onClick={() => postM.mutate(current.id)} style={docActionBtn('#F5A623')}>Post GL</button>}
                  {['approved', 'partial'].includes(current.status) && <button type="button" onClick={() => { setShowPay(current); setPayAmount(String(current.balance_due)); setPayMethod('bank_transfer'); setPayRef('') }} style={docActionBtn('#F093FB')}>จ่าย</button>}
                  {canEdit(current) && <button type="button" onClick={() => openEdit(current)} style={docPrimaryBtn('#FF9E80', '#F2714E')}>✎ แก้ไข</button>}
                </> : <>
                  <button type="button" onClick={cancelForm} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending} style={{ ...docPrimaryBtn('#FF9E80', '#F2714E'), opacity: createM.isPending ? 0.7 : 1 }}>
                    {createM.isPending ? 'กำลังบันทึก...' : current ? '✓ บันทึกการแก้ไข' : '✓ บันทึกค่าใช้จ่าย'}
                  </button>
                </>}
              </div>
            </form>
          </DocCard>
      )}

      {/* ── APPROVE MODAL ── */}
      {showApprove && (
        <div style={overlay} onClick={() => setShowApprove(null)}>
          <div style={{ ...modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '28px', textAlign: 'center' }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>{showApprove.action === 'approved' ? '✅' : '❌'}</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>
                {showApprove.action === 'approved' ? 'ยืนยันการอนุมัติ' : 'ยืนยันการปฏิเสธ'}
              </h3>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>{showApprove.bill.number}</p>
              <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 700 }}>{showApprove.bill.description}</p>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: showApprove.action === 'approved' ? '#43E97B' : '#FF6B6B' }}>
                ยอด: ฿{Number(showApprove.bill.net_payable).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={{ ...lbl, textAlign: 'left', display: 'block' }}>ความคิดเห็น (ไม่บังคับ)</label>
                <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={3}
                  placeholder={showApprove.action === 'approved' ? 'อนุมัติตามที่เสนอ...' : 'เหตุผลในการปฏิเสธ...'}
                  style={{ ...inp, resize: 'vertical', padding: '10px 12px' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setShowApprove(null)} style={{ padding: '10px 24px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={() => approveM.mutate({ id: showApprove.bill.id, action: showApprove.action, comment: approveComment })}
                  disabled={approveM.isPending}
                  style={{ padding: '10px 24px', borderRadius: 9, border: 'none', background: showApprove.action === 'approved' ? '#43E97B' : '#FF6B6B', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  {approveM.isPending ? 'กำลังดำเนินการ...' : showApprove.action === 'approved' ? '✓ อนุมัติ' : '✗ ปฏิเสธ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PAY MODAL ── */}
      {showPay && (
        <div style={overlay} onClick={() => setShowPay(null)}>
          <div style={{ ...modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>จ่ายชำระเงิน</h3><p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>{showPay.number} — ค้างจ่าย ฿{Number(showPay.balance_due).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p></div>
              <button onClick={() => setShowPay(null)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div><label style={lbl}>จำนวนเงิน (บาท)</label><input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} style={{ ...inp, fontSize: 16, fontWeight: 700, padding: '12px 14px', color: '#F093FB' }} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>ช่องทางการจ่าย</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="bank_transfer">โอนธนาคาร</option>
                    <option value="cash">เงินสด</option>
                    <option value="check">เช็ค</option>
                    <option value="promptpay">PromptPay</option>
                  </select>
                </div>
                <div><label style={lbl}>เลขที่อ้างอิง</label><input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="เลขที่โอน/เช็ค" style={inp} /></div>
              </div>
              <div style={{ background: '#F093FB08', border: '1px solid #F093FB25', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#F093FB' }}>✦ ระบบจะ Auto Post GL อัตโนมัติ (Dr เจ้าหนี้ / Cr ธนาคาร)</p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowPay(null)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={() => payM.mutate({ bid: showPay.id, amt: payAmount, method: payMethod, ref: payRef })}
                  disabled={payM.isPending || !payAmount}
                  style={{ background: '#F093FB', color: '#141018', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 24px', cursor: 'pointer', opacity: payM.isPending ? 0.7 : 1 }}>
                  {payM.isPending ? 'กำลังบันทึก...' : '✓ จ่ายชำระ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
