import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { openDocPdf } from '@/lib/pdf'
import DocCard from '@/components/doc/DocCard'
import DocSearch from '@/components/doc/DocSearch'
import ColumnPicker from '@/components/doc/ColumnPicker'
import { useColumns } from '@/components/doc/columns'
import { matchesSearch } from '@/components/doc/search'
import { docBadge, docActionBtn, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote, docDisabled, docNeedsBookNote } from '@/components/doc/docStyles'
import { DocumentBookSelect, useDocumentBooks } from '@/components/books/DocumentBookSelect'
import VatSelect from '@/components/doc/VatSelect'
import VatModeSelect from '@/components/doc/VatModeSelect'
import ProductInput from '@/components/doc/ProductInput'
import { useProducts, productPrice, type ProductOption } from '@/components/doc/products'
import { useVatCodes, defaultVatCodeId, vatRateOf, vatCodeForLine, documentTotals } from '@/components/doc/vat'
import SearchSelect from '@/components/ui/SearchSelect'

interface Customer { id: string; code: string; name: string; credit_days: number }
interface InvoiceItem { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number
                        tax_code_id?: string | null; vat_rate?: number | null; product_id?: string | null; detail?: string | null }
interface Invoice {
  id: string; number: string; customer_id: string; customer?: Customer
  date: string; due_date: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number; vat_inclusive?: boolean
  paid_amount: number; balance_due: number; note?: string; gl_posted: boolean
  book_id?: string | null; book?: { code: string; name: string } | null
  items: InvoiceItem[]
}

// Editable until posted to GL, paid or cancelled (the API enforces the same rule).
const canEdit = (inv: Invoice) => !inv.gl_posted && !Number(inv.paid_amount) && inv.status !== 'cancelled'
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`
const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:     { label: 'ฉบับร่าง',     color: '#F5A623' },
  sent:      { label: 'ส่งแล้ว',      color: 'var(--color-accent-light)' },
  partial:   { label: 'ชำระบางส่วน', color: '#F093FB' },
  paid:      { label: 'ชำระครบ',      color: '#43E97B' },
  overdue:   { label: 'เกินกำหนด',   color: '#FF6B6B' },
  cancelled: { label: 'ยกเลิก',       color: 'var(--color-dim)' },
}

const itemSchema = z.object({
  description:  z.string().min(1, 'ระบุรายการ'),
  quantity:     z.number().min(0.001),
  unit:         z.string().optional(),
  unit_price:   z.number().min(0),
  discount_pct: z.number().min(0).max(100),
  tax_code_id:  z.string().optional(),      // the line's ประเภทภาษี (VAT); '' = no VAT
  product_id:  z.string().optional(),      // the สินค้า/บริการ picked for the line
  detail:      z.string().optional(),      // the line's คำอธิบาย
})
const invoiceSchema = z.object({
  customer_id: z.string().min(1, 'เลือกลูกค้า'),
  date:        z.string().min(1),
  due_date:    z.string().optional(),
  vat_mode:    z.enum(['exclusive', 'inclusive']),
  note:      z.string().optional(),
  book_id:     z.string().optional(),
  items:       z.array(itemSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
})
type IForm = z.infer<typeof invoiceSchema>

const paySchema = z.object({
  amount:    z.number().min(0.01),
  method:    z.enum(['cash','bank_transfer','check','credit_card','promptpay']),
  reference: z.string().optional(),
  date:      z.string().min(1),
})
type PForm = z.infer<typeof paySchema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }

export default function InvoicePage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const cols = useColumns('invoices', [
    { id:'number', label:'เลขที่', required:true }, { id:'customer', label:'ลูกค้า' }, { id:'status', label:'สถานะ' },
    { id:'date', label:'วันที่' }, { id:'due', label:'ครบกำหนด' }, { id:'total', label:'ยอดรวม' },
    { id:'paid', label:'รับชำระแล้ว', defaultHidden:true }, { id:'balance', label:'ค้างชำระ' },
    { id:'book', label:'สมุดบันทึก', defaultHidden:true }, { id:'note', label:'หมายเหตุ', defaultHidden:true }, 
  ])
  const [showOCR, setShowOCR] = useState(false)
  // One card serves create, view and edit: `openInv` is the invoice shown (null = new),
  // `readOnly` switches the same form layout between viewing and editing.
  const [openInv, setOpenInv] = useState<Invoice|null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [showPay, setShowPay] = useState<Invoice|null>(null)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [ocrLoading, setOcrLoading] = useState(false)

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get('/api/v1/ar/invoices')).data,
  })
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/api/v1/ar/customers')).data,
  })
  const { data: vatCodes = [] } = useVatCodes()
  const { data: products = [] } = useProducts()

  // Save as a draft, or save and confirm (post to GL) in one go. If saving works but
  // posting fails, the invoice stays a draft and opens with the reason.
  const [actionError, setActionError] = useState<string|null>(null)
  const createM = useMutation({
    mutationFn: async ({ d, confirm }: { d: IForm; confirm: boolean }) => {
      // Each line carries its own VAT; the header rate is just the first line's, for display.
      const items = d.items.map(it => ({ ...it, tax_code_id: it.tax_code_id || undefined, product_id: it.product_id || undefined, detail: it.detail || undefined, vat_rate: vatRateOf(vatCodes, it.tax_code_id) }))
      const { vat_mode, ...rest } = d
      const body = { ...rest, due_date: d.due_date || undefined, book_id: d.book_id || undefined, items,
                     vat_rate: items[0]?.vat_rate ?? 0, vat_inclusive: vat_mode === 'inclusive' }
      const { data: saved } = openInv ? await api.put(`/api/v1/ar/invoices/${openInv.id}`, body) : await api.post('/api/v1/ar/invoices', body)
      if (!confirm) return { inv: saved as Invoice, error: null }
      try { return { inv: (await api.post(`/api/v1/ar/invoices/${saved.id}/post-gl`)).data as Invoice, error: null } }
      catch (e) { return { inv: saved as Invoice, error: errText(e, 'ยืนยันใบแจ้งหนี้ไม่สำเร็จ') } }
    },
    onSuccess: ({ inv, error }) => { qc.invalidateQueries({ queryKey: ['invoices'] }); openView(inv); setActionError(error) },
  })
  const postM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ar/invoices/${id}/post-gl`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); setActionError(null) },
    onError: (e) => setActionError(errText(e, 'ยืนยันใบแจ้งหนี้ไม่สำเร็จ')),
  })
  const cancelM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ar/invoices/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  })
  const payM = useMutation({
    mutationFn: ({ invoice_id, ...rest }: PForm & { invoice_id: string }) =>
      api.post('/api/v1/ar/payments', { invoice_id, ...rest }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); setShowPay(null) },
  })

  const newLine = () => ({ description:'', quantity:1, unit:'', unit_price:0, discount_pct:0, tax_code_id: defaultVatCodeId(vatCodes), product_id: '', detail: '' })
  const blankForm = (): IForm => ({ customer_id: '', date: localToday(), due_date: '', vat_mode: 'exclusive', note: '', book_id: '', items: [newLine()] })
  const invForm = (inv: Invoice): IForm => ({
    customer_id: inv.customer_id, date: inv.date, due_date: inv.due_date, vat_mode: inv.vat_inclusive ? 'inclusive' : 'exclusive',
    note: inv.note ?? '', book_id: inv.book_id ?? '',
    items: inv.items.map(it => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit ?? '',
                                  unit_price: Number(it.unit_price), discount_pct: Number(it.discount_pct),
                                  tax_code_id: vatCodeForLine(vatCodes, it.tax_code_id, it.vat_rate ?? inv.vat_rate), product_id: it.product_id ?? '', detail: it.detail ?? '' })),
  })
  const { register: regInv, handleSubmit: subInv, control, reset: resetInv, watch: watchInv, setValue: setInv, formState: { errors: errInv } } = useForm<IForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: blankForm(),
  })
  const openCard = (inv: Invoice | null, ro: boolean) => {
    setOpenInv(inv); resetInv(inv ? invForm(inv) : blankForm()); setReadOnly(ro); createM.reset(); setActionError(null); setShowCreate(true)
  }
  const openCreate = () => openCard(null, false)
  const openView = (inv: Invoice) => openCard(inv, true)
  const openEdit = (inv: Invoice) => openCard(inv, false)
  const closeForm = () => { setShowCreate(false); setOpenInv(null); setReadOnly(false) }
  // Cancelling an edit goes back to viewing the invoice; cancelling a new one goes back to the list.
  const cancelForm = () => openInv ? openView(openInv) : closeForm()
  // Posting, payments and cancelling refetch the list; show the fresh copy.
  const current = openInv ? (invoices.find(i => i.id === openInv.id) ?? openInv) : null
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watchInv('items')

  // Picking a book with a VAT tax type sets every line's VAT to it; each line stays editable.
  const { data: incomeBooks = [] } = useDocumentBooks('income')
  const bookField = regInv('book_id', {
    onChange: e => {
      const book = incomeBooks.find(b => b.id === e.target.value)
      if (book?.tax_code?.kind === 'vat' && book.tax_code_id)
        watchItems.forEach((_, i) => setInv(`items.${i}.tax_code_id`, book.tax_code_id ?? ''))
    },
  })
  // Picking a สินค้า/บริการ for a line fills its unit and selling price.
  const pickProduct = (i: number, p: ProductOption) => {
    setInv(`items.${i}.description`, p.name)
    setInv(`items.${i}.product_id`, p.id)
    setInv(`items.${i}.unit`, p.unit ?? '')
    setInv(`items.${i}.unit_price`, productPrice(p, 'sales'))
  }
  const lineAmount = (it: Partial<IForm['items'][number]>) => (Number(it.quantity)||0) * (Number(it.unit_price)||0) * (1 - (Number(it.discount_pct)||0)/100)
  const { subtotal, vat: vatAmt, total } = documentTotals(vatCodes,
    watchItems.map(it => ({ amount: lineAmount(it), codeId: it.tax_code_id })), watchInv('vat_mode'))

  const { register: regPay, handleSubmit: subPay, reset: resetPay } = useForm<PForm>({
    defaultValues: { date: new Date().toISOString().split('T')[0], method: 'bank_transfer' },
  })

  async function handleOCR(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrLoading(true)
    const form = new FormData(); form.append('file', file)
    try {
      const { data } = await api.post('/api/v1/ar/ocr/invoice', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setOcrResult(data)
    } catch { alert('ไม่สามารถอ่านเอกสารได้') }
    finally { setOcrLoading(false) }
  }

  const overlay: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:16 }
  const modal: React.CSSProperties  = { background:'var(--color-card)', border:'1px solid var(--color-border-strong)', borderRadius:16, width:'100%', maxWidth:820, maxHeight:'92vh', overflowY:'auto' }

  // The invoice card replaces the list on the page.
  const panelOpen = showCreate
  const customerMissing = current?.customer && !customers.some(c => c.id === current.customer_id)
  const shown = invoices.filter(i => matchesSearch(search, i.number, i.customer?.name, i.customer?.code, i.total, i.balance_due,
    (STATUS_META[i.status] || STATUS_META.draft).label, i.note, new Date(i.date).toLocaleDateString('th-TH')))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {!panelOpen && <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบแจ้งหนี้ (Invoice)</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>Accounts Receivable — ทั้งหมด {invoices.length} ฉบับ</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>setShowOCR(true)} style={{ background:'#F2714E15', border:'1px solid #F2714E40', color:'#F2714E', fontWeight:700, fontSize:12, borderRadius:9, padding:'9px 16px', cursor:'pointer' }}>
            📄 OCR อ่านใบแจ้งหนี้
          </button>
          <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>
            + ออกใบแจ้งหนี้
          </button>
        </div>
      </div>

      <DocSearch value={search} onChange={setSearch} count={shown.length} total={invoices.length} placeholder="ค้นหาเลขที่ ชื่อลูกค้า สถานะ หรือยอดเงิน">
        <ColumnPicker cols={cols} />
      </DocSearch>

      {/* Table */}
      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : invoices.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีใบแจ้งหนี้</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่พบใบแจ้งหนี้ที่ค้นหา</div>
        : (
          <table className="doc-list">
            <thead>
              <tr>
                {cols.visible.map(c=>(
                  <th key={c.id} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(inv => {
                const sm = STATUS_META[inv.status] || STATUS_META.draft
                return (
                  <tr key={inv.id} onClick={()=>openView(inv)} style={{ cursor:'pointer' }}>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:12, color: 'var(--color-accent-light)' }}>{inv.number}</td>
                    {cols.on('customer') && <td className="doc-wrap" style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }}>{inv.customer?.name || '—'}</td>}
                    {cols.on('status') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize:10, fontWeight:700, color:sm.color, background:sm.color+'18', border:`1px solid ${sm.color}35`, padding:'2px 8px', borderRadius:10 }}>{sm.label}</span>
                      {inv.gl_posted && <div style={{ fontSize:9, color:'#43E97B', marginTop:3 }}>✓ ลงบัญชีแล้ว</div>}
                    </td>}
                    {cols.on('date') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(inv.date).toLocaleDateString('th-TH')}</td>}
                    {cols.on('due') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color: new Date(inv.due_date)<new Date()&&inv.status!=='paid'?'#FF6B6B':'var(--color-text-tertiary)' }}>{new Date(inv.due_date).toLocaleDateString('th-TH')}</td>}
                    {cols.on('total') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', fontWeight:600 }}>฿{Number(inv.total).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>}
                    {cols.on('paid') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', color:'#43E97B' }}>{baht(inv.paid_amount)}</td>}
                    {cols.on('balance') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', color: Number(inv.balance_due)>0?'#FF6B6B':'#43E97B', fontWeight:600 }}>{Number(inv.balance_due)>0?`฿${Number(inv.balance_due).toLocaleString('th-TH',{minimumFractionDigits:2})}`:'✓'}</td>}
                    {cols.on('book') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{inv.book ? `${inv.book.code} ${inv.book.name}` : '—'}</td>}
                    {cols.on('note') && <td className="doc-wrap" style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{inv.note || '—'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      </>}

      {/* ── OCR MODAL ── */}
      {showOCR && (
        <div style={overlay} onClick={()=>setShowOCR(false)}>
          <div style={{ ...modal, maxWidth:520 }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:22 }}>📄</span>
                <div><h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>OCR อ่านใบแจ้งหนี้</h3><p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>AI จะอ่านข้อมูลจากรูปภาพให้อัตโนมัติ</p></div>
              </div>
              <button onClick={()=>setShowOCR(false)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div style={{ padding:24 }}>
              <label style={{ display:'block', background:'var(--color-bg-inset)', border:'2px dashed var(--color-border-strong)', borderRadius:12, padding:'32px', textAlign:'center', cursor:'pointer' }}>
                <input type="file" accept="image/*,.pdf" onChange={handleOCR} style={{ display:'none' }} />
                <p style={{ margin:'0 0 6px', fontSize:28 }}>{ocrLoading ? '⏳' : '📁'}</p>
                <p style={{ margin:0, fontSize:13, color:'var(--color-text-tertiary)' }}>{ocrLoading ? 'AI กำลังอ่านเอกสาร...' : 'คลิกหรือลากไฟล์มาวาง (JPG, PNG, PDF)'}</p>
              </label>
              {ocrResult && (
                <div style={{ marginTop:20, background:'#F2714E08', border:'1px solid #F2714E25', borderRadius:12, padding:18 }}>
                  <p style={{ margin:'0 0 14px', fontSize:12, fontWeight:700, color:'#F2714E' }}>✦ AI อ่านข้อมูลได้ (Confidence: {Math.round(ocrResult.confidence*100)}%)</p>
                  {[
                    ['ลูกค้า', ocrResult.customer_name],
                    ['เลขที่ Invoice', ocrResult.invoice_number],
                    ['วันที่', ocrResult.invoice_date],
                    ['ครบกำหนด', ocrResult.due_date],
                    ['ยอดรวม', ocrResult.total ? `฿${Number(ocrResult.total).toLocaleString('th-TH')}` : null],
                  ].map(([l,v]) => v && (
                    <div key={l as string} style={{ display:'flex', gap:8, padding:'4px 0', fontSize:12, borderBottom:'1px solid #1A2A1A' }}>
                      <span style={{ color:'var(--color-muted)', minWidth:100 }}>{l}</span>
                      <span style={{ color:'var(--color-text)', fontWeight:600 }}>{v as string}</span>
                    </div>
                  ))}
                  {ocrResult.items?.length > 0 && (
                    <div style={{ marginTop:12 }}>
                      <p style={{ margin:'0 0 8px', fontSize:11, color:'var(--color-muted)', fontWeight:700 }}>รายการ ({ocrResult.items.length} รายการ)</p>
                      {ocrResult.items.map((it: any, i: number) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--color-text-secondary)', padding:'3px 0' }}>
                          <span>{it.description}</span>
                          <span style={{ color:'#43E97B' }}>฿{Number(it.amount||0).toLocaleString('th-TH')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── INVOICE CARD — one layout for create, view and edit ── */}
      {showCreate && (
          <DocCard
            title={current ? `${readOnly ? '' : 'แก้ไข'}ใบแจ้งหนี้ ${current.number}` : 'ออกใบแจ้งหนี้ใหม่'}
            subtitle={current ? (current.customer?.name || '—') : 'ใบแจ้งหนี้ (Invoice)'}
            onBack={closeForm} backLabel="กลับไปที่ใบแจ้งหนี้"
            actions={current && <>
              <span style={docBadge((STATUS_META[current.status] || STATUS_META.draft).color)}>{(STATUS_META[current.status] || STATUS_META.draft).label}</span>
              {current.gl_posted && <span style={docBadge('#43E97B')}>✓ ลงบัญชีแล้ว</span>}
            </>}>
            <form onSubmit={subInv(d=>createM.mutate({ d, confirm:false }))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <DocumentBookSelect side="income" field={bookField} value={watchInv('book_id')} inputStyle={inp} current={current?.book && { ...current.book, id: current.book_id ?? undefined }}
                labelStyle={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }} />
              {/* Header */}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1.4fr', gap:12 }}>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>ลูกค้า *</label>
                  <SearchSelect {...regInv('customer_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                    {customerMissing && current?.customer && <option value={current.customer_id}>{current.customer.code} — {current.customer.name}</option>}
                  </SearchSelect>
                  {errInv.customer_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errInv.customer_id.message}</p>}
                </div>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>วันที่</label>
                  <input {...regInv('date')} type="date" style={inp} />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>ครบกำหนด</label>
                  <input {...regInv('due_date')} type="date" style={inp} />
                </div>
                <VatModeSelect field={regInv('vat_mode')} style={inp}
                  labelStyle={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }} />
              </div>

              {/* Items */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em' }}>รายการสินค้า/บริการ</label>
                  <button type="button" className="doc-edit-only" onClick={()=>append(newLine())}
                    style={{ fontSize:11, background:'var(--color-border)', border:'1px solid var(--color-border-strong)', color:'var(--color-text-secondary)', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background:'var(--color-bg-inset)', borderRadius:10, overflow:'auto', border:'1px solid var(--color-border)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
                    <thead>
                      <tr>
                        {['สินค้า/บริการ','คำอธิบาย','จำนวน','หน่วย','ราคา/หน่วย','ส่วนลด%','VAT','จำนวนเงิน',''].map(h=>(
                          <th key={h} style={{ padding:'7px 8px', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', borderBottom:'1px solid var(--color-border)', textAlign:'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, i) => {
                        const it = watchItems[i] || {}
                        const amt = lineAmount(it)
                        return (
                          <tr key={field.id}>
                            <td style={{ padding:'5px 6px', width:'18%' }}><ProductInput field={regInv(`items.${i}.description`)} products={products} onPick={p => pickProduct(i, p)} onUnlink={() => setInv(`items.${i}.product_id`, '')} style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'16%' }}><input {...regInv(`items.${i}.detail`)} placeholder="คำอธิบาย" style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...regInv(`items.${i}.quantity`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...regInv(`items.${i}.unit`)} placeholder="ชิ้น" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'13%' }}><input {...regInv(`items.${i}.unit_price`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11, textAlign:'right' }}/></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...regInv(`items.${i}.discount_pct`,{valueAsNumber:true})} type="number" min="0" max="100" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'14%' }}><VatSelect field={regInv(`items.${i}.tax_code_id`)} codes={vatCodes} value={it.tax_code_id} style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'14%', fontFamily:'monospace', fontSize:12, color:'#43E97B', textAlign:'right', paddingRight:10 }}>{amt.toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:'5px 6px', width:28 }}>
                              {fields.length>1&&<button type="button" className="doc-edit-only" onClick={()=>remove(i)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer', fontSize:13 }}>✕</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {errInv.items && <p style={{ margin:'4px 0 0', fontSize:10, color:'#FF6B6B' }}>กรุณาตรวจสอบรายการ</p>}
              </div>

              {/* Totals */}
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:10, padding:'14px 20px', minWidth:240 }}>
                  {[
                    ['ยอดก่อน VAT', `฿${subtotal.toLocaleString('th-TH',{minimumFractionDigits:2})}`, 'var(--color-text)'],
                    ['ภาษีมูลค่าเพิ่ม (VAT)', `฿${vatAmt.toLocaleString('th-TH',{minimumFractionDigits:2})}`, '#F5A623'],
                  ].map(([l,v,c])=>(
                    <div key={l as string} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:12 }}>
                      <span style={{ color:'var(--color-text-tertiary)' }}>{l}</span>
                      <span style={{ color:c as string }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0 0', borderTop:'1px solid var(--color-border-strong)', marginTop:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>ยอดรวมทั้งสิ้น</span>
                    <span style={{ fontSize:16, fontWeight:800, color:'#F2714E' }}>฿{total.toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                  </div>
                  {readOnly && current && Number(current.paid_amount) > 0 && <>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0 0', fontSize:12 }}><span style={{ color:'var(--color-text-tertiary)' }}>รับชำระแล้ว</span><span style={{ color:'#43E97B' }}>{baht(current.paid_amount)}</span></div>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0 0', fontSize:12 }}><span style={{ color:'var(--color-text-tertiary)' }}>ค้างชำระ</span><span style={{ color:'#FF6B6B', fontWeight:700 }}>{baht(current.balance_due)}</span></div>
                  </>}
                </div>
              </div>

              <div>
                <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>หมายเหตุ</label>
                <textarea {...regInv('note')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" />
              </div>
              </fieldset>

              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{errText(createM.error, 'เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล')}</p></div>}
              {readOnly && actionError && <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{actionError}</p></div>}
              <div style={docFooter}>
                {readOnly && current ? <>
                  {!canEdit(current) && <span style={docLockedNote}>แก้ไขไม่ได้ — ใบแจ้งหนี้{current.status === 'cancelled' ? 'ถูกยกเลิก' : current.gl_posted ? 'ยืนยันและลงบัญชีแล้ว' : 'รับชำระแล้ว'}</span>}
                  {canEdit(current) && !current.book_id && <span style={docNeedsBookNote}>ยังไม่ได้เลือกสมุดบันทึก — กด “แก้ไข” เพื่อเลือกก่อนยืนยัน</span>}
                  {['draft','sent'].includes(current.status) && !current.gl_posted && <button type="button" onClick={()=>cancelM.mutate(current.id)} style={docActionBtn('#FF6B6B')}>ยกเลิกเอกสาร</button>}
                  <button type="button" onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/invoice/${current.id}`)} style={docActionBtn('#8E8E93')}>🖨 พิมพ์</button>
                  {['sent','partial'].includes(current.status) && current.gl_posted && <button type="button" onClick={()=>{ setShowPay(current); resetPay({ date: localToday(), method:'bank_transfer' }) }} style={docActionBtn('#43E97B')}>รับเงิน</button>}
                  {canEdit(current) && <button type="button" onClick={()=>openEdit(current)} style={docActionBtn('#F2714E')}>✎ แก้ไข</button>}
                  {canEdit(current) && <button type="button" disabled={postM.isPending || !current.book_id} onClick={()=>postM.mutate(current.id)}
                    title={current.book_id ? undefined : 'เลือกสมุดบันทึกก่อนยืนยัน'}
                    style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), ...(current.book_id ? {} : docDisabled), opacity: !current.book_id ? 0.45 : postM.isPending ? 0.7 : 1 }}>{postM.isPending ? 'กำลังยืนยัน...' : '✓ ยืนยัน · ลงบัญชี'}</button>}
                </> : <>
                  <button type="button" onClick={cancelForm} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending} style={{ ...docActionBtn('#F2714E'), opacity:createM.isPending?0.7:1 }}>บันทึกร่าง</button>
                  <button type="button" disabled={createM.isPending || !watchInv('book_id')} onClick={subInv(d=>createM.mutate({ d, confirm:true }))}
                    title={watchInv('book_id') ? undefined : 'เลือกสมุดบันทึกก่อนยืนยัน'}
                    style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), ...(watchInv('book_id') ? {} : docDisabled), opacity: !watchInv('book_id') ? 0.45 : createM.isPending ? 0.7 : 1 }}>{createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึกและยืนยัน · ลงบัญชี'}</button>
                </>}
              </div>
            </form>
          </DocCard>
      )}

      {/* ── RECEIVE PAYMENT MODAL ── */}
      {showPay && (
        <div style={overlay} onClick={()=>setShowPay(null)}>
          <div style={{ ...modal, maxWidth:440 }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div><h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>รับชำระเงิน</h3><p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>{showPay.number} — ค้างชำระ ฿{Number(showPay.balance_due).toLocaleString('th-TH',{minimumFractionDigits:2})}</p></div>
              <button onClick={()=>setShowPay(null)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={subPay(d=>payM.mutate({ ...d, invoice_id: showPay.id }))} style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>จำนวนเงิน (บาท)</label>
                <input {...regPay('amount', {valueAsNumber:true})} type="number" min="0.01" step="0.01"
                  defaultValue={Number(showPay.balance_due)}
                  style={{ ...inp, fontSize:16, fontWeight:700, padding:'12px 14px', color:'#43E97B' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>วันที่รับเงิน</label>
                  <input {...regPay('date')} type="date" style={inp} />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>ช่องทางการรับเงิน</label>
                  <SearchSelect {...regPay('method')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="bank_transfer">โอนธนาคาร</option>
                    <option value="cash">เงินสด</option>
                    <option value="promptpay">PromptPay</option>
                    <option value="check">เช็ค</option>
                    <option value="credit_card">บัตรเครดิต</option>
                  </SearchSelect>
                </div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>เลขที่อ้างอิง (เลขที่โอน/เช็ค)</label>
                <input {...regPay('reference')} placeholder="TRANS20240115001" style={inp} />
              </div>
              <div style={{ background:'#43E97B08', border:'1px solid #43E97B25', borderRadius:10, padding:'12px 16px' }}>
                <p style={{ margin:0, fontSize:11, color:'#43E97B' }}>✦ ระบบจะ Auto Post รายการเข้า GL อัตโนมัติ (Dr ธนาคาร / Cr ลูกหนี้)</p>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" onClick={()=>setShowPay(null)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={payM.isPending} style={{ background:'#43E97B', color: '#141018', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity:payM.isPending?0.7:1 }}>
                  {payM.isPending ? 'กำลังบันทึก...' : '✓ บันทึกการรับเงิน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
