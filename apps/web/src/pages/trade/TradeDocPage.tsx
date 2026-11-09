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
import { docBadge as badge, docActionBtn as footBtn, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote, docDisabled, docNeedsBookNote } from '@/components/doc/docStyles'
import { DocumentBookSelect } from '@/components/books/DocumentBookSelect'
import VatSelect from '@/components/doc/VatSelect'
import VatModeSelect from '@/components/doc/VatModeSelect'
import ProductInput from '@/components/doc/ProductInput'
import { useProducts, productPrice, type ProductOption } from '@/components/doc/products'
import { useVatCodes, defaultVatCodeId, vatRateOf, vatCodeForLine, documentTotals } from '@/components/doc/vat'
import SearchSelect from '@/components/ui/SearchSelect'

// One page for every line-item document on both sides of the business:
//   sales:    quotation → sales_order → invoice, deposit, credit_note, debit_note
//   purchase: rfq → purchase_order → bill,       deposit, credit_note, debit_note
export type Side = 'sales' | 'purchase'
export type DocType = 'quotation' | 'sales_order' | 'rfq' | 'purchase_order' | 'deposit' | 'credit_note' | 'debit_note'

interface Party { id: string; code: string; name: string }
interface RefDoc { id: string; number: string; status: string; gl_posted: boolean; total: number; balance_due: number; customer_id?: string; supplier_id?: string; book_id?: string | null }
interface DocItem { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number; tax_code_id?: string | null; vat_rate?: number | null; product_id?: string | null; detail?: string | null }
interface TradeDoc {
  id: string; number: string; doc_type: DocType
  customer?: Party; supplier?: Party
  date: string; valid_until?: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number; deposit_amount: number; vat_inclusive?: boolean
  ref_number?: string; note?: string; reason?: string; gl_posted: boolean
  converted_to_type?: string
  invoice_id?: string; bill_id?: string
  invoice?: { number: string }; bill?: { number: string }
  book_id?: string | null; book?: { code: string; name: string } | null
  items: DocItem[]
}

interface DocCfg { title: string; subtitle: string; createLabel: string; validLabel: string; convertLabel?: string; postLabel?: string; accent: string }

const CFG: Record<Side, Partial<Record<DocType, DocCfg>>> = {
  sales: {
    quotation:   { title: 'ใบเสนอราคา', subtitle: 'เสนอราคาสินค้า/บริการให้ลูกค้า', createLabel: '+ สร้างใบเสนอราคา', validLabel: 'ยืนราคาถึง', convertLabel: 'แปลงเป็นใบสั่งขาย', accent: '#0A84FF' },
    sales_order: { title: 'ใบสั่งขาย / คำสั่งขาย', subtitle: 'ยืนยันคำสั่งซื้อจากลูกค้า', createLabel: '+ สร้างใบสั่งขาย', validLabel: 'กำหนดส่งของ', convertLabel: 'แปลงเป็นใบแจ้งหนี้', accent: '#5E5CE6' },
    deposit:     { title: 'ใบรับมัดจำ', subtitle: 'รับเงินมัดจำล่วงหน้าจากลูกค้า', createLabel: '+ สร้างใบรับมัดจำ', validLabel: 'กำหนดชำระ', postLabel: 'รับมัดจำ (Post GL)', accent: '#FF9F0A' },
    credit_note: { title: 'ใบลดหนี้', subtitle: 'ลดยอดใบแจ้งหนี้ที่ออกแล้ว เช่น คืนสินค้า ลดราคา', createLabel: '+ ออกใบลดหนี้', validLabel: 'อ้างอิง', postLabel: 'ออกใบลดหนี้ (Post GL)', accent: '#FF6B6B' },
    debit_note:  { title: 'ใบเพิ่มหนี้', subtitle: 'เพิ่มยอดใบแจ้งหนี้ที่ออกแล้ว เช่น ส่งของเพิ่ม ปรับราคาขึ้น', createLabel: '+ ออกใบเพิ่มหนี้', validLabel: 'อ้างอิง', postLabel: 'ออกใบเพิ่มหนี้ (Post GL)', accent: '#30D158' },
  },
  purchase: {
    rfq:            { title: 'ใบขอเสนอราคา', subtitle: 'ขอใบเสนอราคาจากผู้จำหน่าย', createLabel: '+ สร้างใบขอเสนอราคา', validLabel: 'ขอคำตอบภายใน', convertLabel: 'แปลงเป็นใบสั่งซื้อ', accent: '#0A84FF' },
    purchase_order: { title: 'ใบสั่งซื้อ / คำสั่งซื้อ', subtitle: 'สั่งซื้อสินค้า/บริการจากผู้จำหน่าย', createLabel: '+ สร้างใบสั่งซื้อ', validLabel: 'กำหนดรับของ', convertLabel: 'แปลงเป็นใบแจ้งหนี้ (บิล)', accent: '#5E5CE6' },
    deposit:        { title: 'ใบจ่ายมัดจำ', subtitle: 'จ่ายเงินมัดจำล่วงหน้าให้ผู้จำหน่าย', createLabel: '+ สร้างใบจ่ายมัดจำ', validLabel: 'กำหนดจ่าย', postLabel: 'จ่ายมัดจำ (Post GL)', accent: '#FF9F0A' },
    credit_note:    { title: 'ใบลดหนี้', subtitle: 'ใบลดหนี้ที่ได้รับจากผู้จำหน่าย — ลดยอดบิลที่ต้องจ่าย', createLabel: '+ บันทึกใบลดหนี้', validLabel: 'อ้างอิง', postLabel: 'บันทึกบัญชี (Post GL)', accent: '#FF6B6B' },
    debit_note:     { title: 'ใบเพิ่มหนี้', subtitle: 'ใบเพิ่มหนี้ที่ได้รับจากผู้จำหน่าย — เพิ่มยอดบิลที่ต้องจ่าย', createLabel: '+ บันทึกใบเพิ่มหนี้', validLabel: 'อ้างอิง', postLabel: 'บันทึกบัญชี (Post GL)', accent: '#30D158' },
  },
}

const SIDE = {
  sales:    { docs: '/api/v1/ar/sales-documents',    parties: '/api/v1/ar/customers', partyLabel: 'ลูกค้า', partyKey: 'customer_id' as const,
              refs: '/api/v1/ar/invoices', refLabel: 'ใบแจ้งหนี้', refKey: 'invoice_id' as const, refQuery: 'invoices', targetQuery: 'invoices' },
  purchase: { docs: '/api/v1/ap/purchase-documents', parties: '/api/v1/ap/suppliers', partyLabel: 'ผู้จำหน่าย', partyKey: 'supplier_id' as const,
              refs: '/api/v1/ap/bills', refLabel: 'บิล', refKey: 'bill_id' as const, refQuery: 'bills', targetQuery: 'bills' },
}

const TARGET_LABEL: Record<string, string> = { sales_order: 'ใบสั่งขาย', invoice: 'ใบแจ้งหนี้', purchase_order: 'ใบสั่งซื้อ', bill: 'ใบแจ้งหนี้ (บิล)' }

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:     { label: 'ฉบับร่าง',   color: '#F5A623' },
  sent:      { label: 'ส่งแล้ว',    color: 'var(--color-accent-light)' },
  accepted:  { label: 'ยืนยันแล้ว', color: '#43E97B' },
  converted: { label: 'แปลงแล้ว',   color: '#64D2FF' },
  cancelled: { label: 'ยกเลิก',      color: 'var(--color-dim)' },
  expired:   { label: 'หมดอายุ',    color: '#FF6B6B' },
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
const docSchema = z.object({
  party_id:       z.string().min(1, 'เลือกคู่ค้า'),
  ref_id:         z.string().optional(),
  date:           z.string().min(1),
  valid_until:    z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  vat_mode:       z.enum(['exclusive', 'inclusive']),
  ref_number:     z.string().optional(),
  reason:         z.string().optional(),
  note:           z.string().optional(),
  book_id:        z.string().optional(),
  items:          z.array(itemSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
})
type DForm = z.infer<typeof docSchema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`
const apiError = (e: unknown) => (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
const errText = (e: unknown, fallback: string) => { const d = apiError(e); return typeof d === 'string' ? d : fallback }
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
// Editable until posted to GL, converted or cancelled (the API enforces the same rule).
const canEdit = (d: TradeDoc) => ['draft','sent'].includes(d.status) && !d.gl_posted

export default function TradeDocPage({ side, docType }: { side: Side; docType: DocType }) {
  const cfg = CFG[side][docType]!
  const s = SIDE[side]
  const qc = useQueryClient()
  // One card serves create, view and edit: `openDoc` is the document shown (null = new),
  // `readOnly` switches the same form layout between viewing and editing.
  const [showCreate, setShowCreate] = useState(false)
  const [openDoc, setOpenDoc] = useState<TradeDoc|null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [actionError, setActionError] = useState<string|null>(null)
  const [search, setSearch] = useState('')
  const isDeposit = docType === 'deposit'
  const isNote = docType === 'credit_note' || docType === 'debit_note'
  const cols = useColumns(`trade:${side}:${docType}`, [
    { id:'number', label:'เลขที่', required:true }, { id:'party', label:s.partyLabel }, { id:'status', label:'สถานะ' },
    { id:'date', label:'วันที่' }, { id:'valid', label: isNote ? `อ้างอิง${s.refLabel}` : cfg.validLabel },
    ...(side === 'purchase' ? [{ id:'ref_number', label:'เลขที่เอกสารผู้จำหน่าย', defaultHidden:true }] : []),
    { id:'subtotal', label:'ยอดก่อน VAT', defaultHidden:true }, { id:'vat', label:'VAT', defaultHidden:true },
    { id:'amount', label: isDeposit ? 'ยอดมัดจำ' : 'ยอดรวม' },
    { id:'note', label: isNote ? 'เหตุผล' : 'หมายเหตุ', defaultHidden:true }, 
  ])
  const queryKey = ['trade-docs', side, docType]

  const { data: docs = [], isLoading } = useQuery<TradeDoc[]>({
    queryKey,
    queryFn: async () => (await api.get(s.docs, { params: { doc_type: docType } })).data,
  })
  const { data: parties = [] } = useQuery<Party[]>({
    queryKey: [side === 'sales' ? 'customers' : 'suppliers'],
    queryFn: async () => (await api.get(s.parties)).data,
  })
  const { data: refDocs = [] } = useQuery<RefDoc[]>({
    queryKey: [s.refQuery],
    queryFn: async () => (await api.get(s.refs)).data,
    enabled: isNote,
  })
  const { data: vatCodes = [] } = useVatCodes()
  const { data: products = [] } = useProducts()
  // Only issued documents can be adjusted by a note.
  const adjustable = refDocs.filter(r => r.gl_posted && !['cancelled','rejected'].includes(r.status))

  const after = (extra?: string) => () => {
    setActionError(null)
    qc.invalidateQueries({ queryKey })
    if (extra) qc.invalidateQueries({ queryKey: [extra] })
  }
  const onActionError = (e: unknown) => setActionError(errText(e, 'ทำรายการไม่สำเร็จ'))

  // Confirming a document: deposits and notes are confirmed by posting them to GL; the
  // others (quotation, order, RFQ…) by moving to "accepted", which locks them from editing.
  const confirmsByPosting = isDeposit || isNote
  const confirmLabel = confirmsByPosting ? `ยืนยัน · ${cfg.postLabel}` : 'ยืนยันเอกสาร'
  const confirmCall = (id: string) => confirmsByPosting
    ? api.post(`${s.docs}/${id}/${isDeposit ? 'post-deposit' : 'post-note'}`)
    : api.post(`${s.docs}/${id}/status`, null, { params: { status: 'accepted' } })

  // Save as a draft, or save and confirm in one go. If saving works but confirming fails,
  // the document stays a draft and opens with the reason.
  const createM  = useMutation({
    mutationFn: async ({ d, confirm }: { d: DForm; confirm: boolean }) => {
      const { party_id, ref_id, vat_mode, ...rest } = d
      // Each line carries its own VAT; the header rate is just the first line's, for display.
      const items = d.items.map(it => ({ ...it, tax_code_id: it.tax_code_id || undefined, product_id: it.product_id || undefined, detail: it.detail || undefined, vat_rate: vatRateOf(vatCodes, it.tax_code_id) }))
      const body = {
        doc_type: docType, ...rest, [s.partyKey]: party_id,
        ...(isNote ? { [s.refKey]: ref_id || undefined } : {}),
        valid_until: d.valid_until || undefined,
        book_id: d.book_id || undefined,
        items, vat_rate: items[0]?.vat_rate ?? 0, vat_inclusive: vat_mode === 'inclusive',
      }
      const { data: saved } = openDoc ? await api.put(`${s.docs}/${openDoc.id}`, body) : await api.post(s.docs, body)
      if (!confirm) return { doc: saved as TradeDoc, error: null }
      try { return { doc: (await confirmCall(saved.id)).data as TradeDoc, error: null } }
      catch (e) { return { doc: saved as TradeDoc, error: errText(e, 'ยืนยันเอกสารไม่สำเร็จ') } }
    },
    onSuccess: ({ doc, error }) => { after(isNote ? s.refQuery : undefined)(); openView(doc); if (error) setActionError(error) },
  })
  const confirmM = useMutation({ mutationFn: (id: string) => confirmCall(id), onSuccess: after(isNote ? s.refQuery : undefined), onError: onActionError })
  const sendM    = useMutation({ mutationFn: (id: string) => api.post(`${s.docs}/${id}/status`, null, { params: { status: 'sent' } }), onSuccess: after(), onError: onActionError })
  const convertM = useMutation({
    mutationFn: (id: string) => api.post(`${s.docs}/${id}/convert`),
    onSuccess: (r) => { after(s.targetQuery)(); qc.invalidateQueries({ queryKey: ['trade-docs', side] }); alert(`แปลงเอกสารสำเร็จ → ${r.data.target_number}`) },
    onError: onActionError,
  })
  const cancelM  = useMutation({ mutationFn: (id: string) => api.post(`${s.docs}/${id}/cancel`), onSuccess: after(), onError: onActionError })

  // A new line starts with the default VAT code (deposits carry no VAT by default).
  const newLine = () => ({ description:'', quantity:1, unit:'', unit_price:0, discount_pct:0, tax_code_id: isDeposit ? '' : defaultVatCodeId(vatCodes), product_id: '', detail: '' })
  const blankForm = (): DForm => ({
    party_id: '', ref_id: '', date: localToday(), valid_until: '', deposit_amount: 0,
    ref_number: '', reason: '', note: '', book_id: '', vat_mode: 'exclusive', items: [newLine()],
  })
  const docForm = (d: TradeDoc): DForm => ({
    party_id: (side === 'sales' ? d.customer : d.supplier)?.id ?? '',
    ref_id: (side === 'sales' ? d.invoice_id : d.bill_id) ?? '',
    date: d.date, valid_until: d.valid_until ?? '', deposit_amount: Number(d.deposit_amount),
    ref_number: d.ref_number ?? '', reason: d.reason ?? '', note: d.note ?? '', book_id: d.book_id ?? '',
    vat_mode: d.vat_inclusive ? 'inclusive' : 'exclusive',
    items: d.items.map(it => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit ?? '',
                                unit_price: Number(it.unit_price), discount_pct: Number(it.discount_pct),
                                tax_code_id: vatCodeForLine(vatCodes, it.tax_code_id, it.vat_rate ?? d.vat_rate), product_id: it.product_id ?? '', detail: it.detail ?? '' })),
  })

  const { register, handleSubmit, control, reset, watch, setValue, formState:{ errors } } = useForm<DForm>({
    resolver: zodResolver(docSchema),
    defaultValues: blankForm(),
  })
  const openCard = (d: TradeDoc | null, ro: boolean) => {
    setOpenDoc(d); reset(d ? docForm(d) : blankForm()); setReadOnly(ro); createM.reset(); setActionError(null); setShowCreate(true)
  }
  const openCreate = () => openCard(null, false)
  const openView = (d: TradeDoc) => openCard(d, true)
  const openEdit = (d: TradeDoc) => openCard(d, false)
  const closeForm = () => { setShowCreate(false); setOpenDoc(null); setReadOnly(false) }
  // Cancelling an edit goes back to viewing the document; cancelling a new one goes back to the list.
  const cancelForm = () => openDoc ? openView(openDoc) : closeForm()
  // Status changes (send, post, convert…) refetch the list; show the fresh copy.
  const current = openDoc ? (docs.find(d => d.id === openDoc.id) ?? openDoc) : null
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')
  const watchParty = watch('party_id')
  const lineAmount = (it: Partial<DForm['items'][number]>) => (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100)
  const { subtotal, vat: vatAmt, total } = documentTotals(vatCodes,
    watchItems.map(it => ({ amount: lineAmount(it), codeId: it.tax_code_id })), watch('vat_mode'))
  // Picking a สินค้า/บริการ for a line fills its unit and price.
  const pickProduct = (i: number, p: ProductOption) => {
    setValue(`items.${i}.description`, p.name)
    setValue(`items.${i}.product_id`, p.id)
    setValue(`items.${i}.unit`, p.unit ?? '')
    setValue(`items.${i}.unit_price`, productPrice(p, side))
  }
  const refOptions = adjustable.filter(r => !watchParty || (side === 'sales' ? r.customer_id : r.supplier_id) === watchParty)


  const amountOf = (d: TradeDoc) => Number(isDeposit ? d.deposit_amount : d.total)
  const partyOf = (d: TradeDoc) => (side === 'sales' ? d.customer : d.supplier)?.name || '—'
  const refOf = (d: TradeDoc) => (side === 'sales' ? d.invoice : d.bill)?.number

  // The document card replaces the list on the page.
  const panelOpen = showCreate
  const docName = cfg.title.split(' /')[0]
  const partyMissing = current && !parties.some(p => p.id === (side === 'sales' ? current.customer : current.supplier)?.id)
  const currentParty = current ? (side === 'sales' ? current.customer : current.supplier) : undefined
  const shown = docs.filter(d => matchesSearch(search, d.number, partyOf(d), (side === 'sales' ? d.customer : d.supplier)?.code,
    d.ref_number, refOf(d), d.reason, d.note, amountOf(d), (STATUS_META[d.status] || STATUS_META.draft).label, new Date(d.date).toLocaleDateString('th-TH')))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {!panelOpen && <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>{cfg.title}</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>{cfg.subtitle} — ทั้งหมด {docs.length} ฉบับ</p>
        </div>
        <button onClick={openCreate} style={{ background:`linear-gradient(135deg,${cfg.accent},${cfg.accent}CC)`, color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>{cfg.createLabel}</button>
      </div>

      {actionError && (
        <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:10, padding:'10px 14px', display:'flex', justifyContent:'space-between', gap:12 }}>
          <span style={{ fontSize:12, color:'#FF6B6B' }}>{actionError}</span>
          <button onClick={()=>setActionError(null)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer' }}>✕</button>
        </div>
      )}

      <DocSearch value={search} onChange={setSearch} count={shown.length} total={docs.length}
        placeholder={`ค้นหาเลขที่ ชื่อ${s.partyLabel} อ้างอิง หรือยอดเงิน`}>
        <ColumnPicker cols={cols} />
      </DocSearch>

      {/* Table */}
      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : docs.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีเอกสาร — กด “{cfg.createLabel}” เพื่อเริ่ม</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่พบเอกสารที่ค้นหา</div>
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
              {shown.map(d => {
                const sm = STATUS_META[d.status] || STATUS_META.draft
                const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }
                return (
                  <tr key={d.id} onClick={()=>openView(d)} style={{ cursor:'pointer' }}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:12, color:'var(--color-accent-light)' }}>{d.number}</td>
                    {cols.on('party') && <td className="doc-wrap" style={{ ...td, fontSize:12 }}>{partyOf(d)}</td>}
                    {cols.on('status') && <td style={td}>
                      <span style={{ fontSize:10, fontWeight:700, color:sm.color, background:sm.color+'18', border:`1px solid ${sm.color}35`, padding:'2px 8px', borderRadius:10, whiteSpace:'nowrap' }}>{sm.label}</span>
                      {d.gl_posted && <div style={{ fontSize:9, color:'#43E97B', marginTop:3 }}>✓ ลงบัญชีแล้ว</div>}
                    </td>}
                    {cols.on('date') && <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(d.date).toLocaleDateString('th-TH')}</td>}
                    {cols.on('valid') && <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)', fontFamily: isNote ? 'monospace' : undefined }}>
                      {isNote ? (refOf(d) || '—') : d.valid_until ? new Date(d.valid_until).toLocaleDateString('th-TH') : '—'}
                    </td>}
                    {cols.on('ref_number') && <td style={{ ...td, fontSize:11, fontFamily:'monospace', color:'var(--color-text-tertiary)' }}>{d.ref_number || '—'}</td>}
                    {cols.on('subtotal') && <td style={{ ...td, fontSize:12, fontFamily:'monospace' }}>{baht(d.subtotal)}</td>}
                    {cols.on('vat') && <td style={{ ...td, fontSize:12, fontFamily:'monospace', color:'#F5A623' }}>{baht(d.vat_amount)}</td>}
                    {cols.on('amount') && <td style={{ ...td, fontSize:12, fontFamily:'monospace', fontWeight:600 }}>{baht(amountOf(d))}</td>}
                    {cols.on('note') && <td className="doc-wrap" style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{(isNote ? d.reason : d.note) || '—'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      </>}

      {/* DOCUMENT CARD — one layout for create, view and edit */}
      {showCreate && (
          <DocCard
            title={current ? `${readOnly ? '' : 'แก้ไข'}${docName} ${current.number}` : cfg.createLabel.replace('+ ','')}
            subtitle={current ? partyOf(current) : cfg.title}
            onBack={closeForm} backLabel={`กลับไปที่${docName}`}
            actions={current && <>
              <span style={badge((STATUS_META[current.status] || STATUS_META.draft).color)}>{(STATUS_META[current.status] || STATUS_META.draft).label}</span>
              {current.gl_posted && <span style={badge('#43E97B')}>✓ ลงบัญชีแล้ว</span>}
            </>}>
            <form onSubmit={handleSubmit(d=>createM.mutate({ d, confirm:false }))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12 }}>
                <div style={{ gridColumn:'span 2' }}>
                  <label style={lbl}>{s.partyLabel} *</label>
                  <SearchSelect {...register('party_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือก{s.partyLabel} --</option>
                    {parties.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    {partyMissing && currentParty && <option value={currentParty.id}>{currentParty.code} — {currentParty.name}</option>}
                  </SearchSelect>
                  {errors.party_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.party_id.message}</p>}
                </div>
                <div><label style={lbl}>วันที่</label><input {...register('date')} type="date" style={inp} /></div>
                {/* An empty date input shows "dd/mm/yyyy"; when viewing, show it blank instead. */}
                {!isNote && <div><label style={lbl}>{cfg.validLabel}</label><input {...register('valid_until')} type={readOnly && !watch('valid_until') ? 'text' : 'date'} style={inp} /></div>}
                <VatModeSelect field={register('vat_mode')} labelStyle={lbl} style={inp} />
              </div>

              {isNote && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
                  <div>
                    <label style={lbl}>อ้างอิง{s.refLabel} *</label>
                    <SearchSelect {...register('ref_id', { onChange: e => {
                      const ref = adjustable.find(r => r.id === e.target.value)
                      const owner = ref && (side === 'sales' ? ref.customer_id : ref.supplier_id)
                      if (owner) setValue('party_id', owner)
                      // A note normally posts through the adjusted document's own book.
                      if (ref?.book_id && !watch('book_id')) setValue('book_id', ref.book_id)
                    } })} style={{ ...inp, cursor:'pointer' }}>
                      <option value="">-- เลือก{s.refLabel}ที่ลงบัญชีแล้ว --</option>
                      {refOptions.map(r => <option key={r.id} value={r.id}>{r.number} — ยอด {baht(r.total)} (ค้าง {baht(r.balance_due)})</option>)}
                      {current && refOf(current) && !refOptions.some(r => r.id === (side === 'sales' ? current.invoice_id : current.bill_id)) &&
                        <option value={(side === 'sales' ? current.invoice_id : current.bill_id) ?? ''}>{refOf(current)}</option>}
                    </SearchSelect>
                    {!readOnly && refOptions.length === 0 && <p style={{ margin:'4px 0 0', fontSize:10, color:'var(--color-dim)' }}>ไม่มี{s.refLabel}ที่ Post GL แล้ว{watchParty ? `ของ${s.partyLabel}นี้` : ''}</p>}
                  </div>
                  <div><label style={lbl}>เหตุผล</label><input {...register('reason')} placeholder={docType === 'credit_note' ? 'เช่น รับคืนสินค้า / ลดราคา' : 'เช่น ส่งสินค้าเพิ่ม / ปรับราคา'} style={inp} /></div>
                </div>
              )}

              {/* Deposits and notes post to GL, so they need a สมุดบันทึก to be confirmed. */}
              {confirmsByPosting && (
                <div style={{ maxWidth:520 }}>
                  <DocumentBookSelect side={side === 'sales' ? 'income' : 'expense'} field={register('book_id')} value={watch('book_id')}
                    inputStyle={inp} labelStyle={lbl} current={current?.book && { ...current.book, id: current.book_id ?? undefined }} />
                </div>
              )}

              {side === 'purchase' && (
                <div style={{ maxWidth:300 }}>
                  <label style={lbl}>เลขที่เอกสารของผู้จำหน่าย</label>
                  <input {...register('ref_number')} placeholder="ไม่บังคับ" style={inp} />
                </div>
              )}

              {isDeposit && (
                <div style={{ maxWidth:260 }}>
                  <label style={lbl}>ยอดเงินมัดจำ (บาท) *</label>
                  <input {...register('deposit_amount',{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:15, fontWeight:700, color:cfg.accent }} />
                </div>
              )}

              {/* Items */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <label style={lbl}>{isNote ? 'รายการที่ปรับ' : 'รายการสินค้า/บริการ'}</label>
                  <button type="button" className="doc-edit-only" onClick={()=>append(newLine())} style={{ fontSize:11, background:'var(--color-border)', border:'1px solid var(--color-border-strong)', color:'var(--color-text-secondary)', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background:'var(--color-bg-inset)', borderRadius:10, overflow:'auto', border:'1px solid var(--color-border)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
                    <thead><tr>{['สินค้า/บริการ','คำอธิบาย','จำนวน','หน่วย','ราคา/หน่วย','ส่วนลด%','VAT','จำนวนเงิน',''].map(h=>(
                      <th key={h} style={{ padding:'7px 8px', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', borderBottom:'1px solid var(--color-border)', textAlign:'left' }}>{h}</th>))}
                    </tr></thead>
                    <tbody>
                      {fields.map((field, i) => {
                        const it = watchItems[i] || {}
                        const amt = lineAmount(it)
                        return (
                          <tr key={field.id}>
                            <td style={{ padding:'5px 6px', width:'18%' }}><ProductInput field={register(`items.${i}.description`)} products={products} onPick={p => pickProduct(i, p)} onUnlink={() => setValue(`items.${i}.product_id`, '')} style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'16%' }}><input {...register(`items.${i}.detail`)} placeholder="คำอธิบาย" style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...register(`items.${i}.quantity`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...register(`items.${i}.unit`)} placeholder="ชิ้น" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'13%' }}><input {...register(`items.${i}.unit_price`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11, textAlign:'right' }}/></td>
                            <td style={{ padding:'5px 6px', width:'8%' }}><input {...register(`items.${i}.discount_pct`,{valueAsNumber:true})} type="number" min="0" max="100" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'14%' }}><VatSelect field={register(`items.${i}.tax_code_id`)} codes={vatCodes} value={it.tax_code_id} style={{ ...inp, fontSize:11 }} /></td>
                            <td style={{ padding:'5px 6px', width:'14%', fontFamily:'monospace', fontSize:12, color:'#43E97B', textAlign:'right', paddingRight:10 }}>{amt.toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:'5px 6px', width:28 }}>{fields.length>1&&<button type="button" className="doc-edit-only" onClick={()=>remove(i)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer', fontSize:13 }}>✕</button>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {errors.items && <p style={{ margin:'4px 0 0', fontSize:10, color:'#FF6B6B' }}>กรุณาตรวจสอบรายการ</p>}
              </div>

              {/* Totals */}
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:10, padding:'14px 20px', minWidth:240 }}>
                  {[['ยอดก่อน VAT', baht(subtotal), 'var(--color-text)'],
                    ['ภาษีมูลค่าเพิ่ม (VAT)', baht(vatAmt), '#F5A623']].map(([l,v,c])=>(
                    <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:12 }}>
                      <span style={{ color:'var(--color-text-tertiary)' }}>{l}</span><span style={{ color:c }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0 0', borderTop:'1px solid var(--color-border-strong)', marginTop:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>{isNote ? (docType === 'credit_note' ? 'ยอดลดหนี้' : 'ยอดเพิ่มหนี้') : 'ยอดรวมทั้งสิ้น'}</span>
                    <span style={{ fontSize:16, fontWeight:800, color:cfg.accent }}>{baht(total)}</span>
                  </div>
                </div>
              </div>

              <div><label style={lbl}>หมายเหตุ</label><textarea {...register('note')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" /></div>
              </fieldset>

              {readOnly && current?.converted_to_type && <p style={{ margin:0, fontSize:12, color:'#64D2FF' }}>↪ แปลงเป็น{TARGET_LABEL[current.converted_to_type] || current.converted_to_type}แล้ว</p>}
              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{errText(createM.error, 'เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล')}</p></div>}
              {readOnly && actionError && <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{actionError}</p></div>}

              <div style={docFooter}>
                {readOnly && current ? (() => {
                  const locked = ['converted','cancelled'].includes(current.status)
                  return <>
                    {!canEdit(current) && <span style={docLockedNote}>แก้ไขไม่ได้ — เอกสาร{current.gl_posted ? 'ยืนยันและลงบัญชีแล้ว' : { accepted: 'ยืนยันแล้ว', converted: 'ถูกแปลงแล้ว', cancelled: 'ถูกยกเลิกแล้ว' }[current.status] ?? 'ปิดแล้ว'}</span>}
                    {canEdit(current) && confirmsByPosting && !current.book_id && <span style={docNeedsBookNote}>ยังไม่ได้เลือกสมุดบันทึก — กด “แก้ไข” เพื่อเลือกก่อนยืนยัน</span>}
                    {!locked && !current.gl_posted && <button type="button" onClick={()=>cancelM.mutate(current.id)} style={footBtn('#FF6B6B')}>ยกเลิกเอกสาร</button>}
                    {side === 'sales' && <button type="button" onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/sales-document/${current.id}`)} style={footBtn('#8E8E93')}>🖨 พิมพ์</button>}
                    {current.status==='draft' && !confirmsByPosting && <button type="button" onClick={()=>sendM.mutate(current.id)} style={footBtn('#FFB59E')}>ส่ง</button>}
                    {cfg.convertLabel && !locked && <button type="button" onClick={()=>convertM.mutate(current.id)} style={footBtn('#64D2FF')}>{cfg.convertLabel}</button>}
                    {canEdit(current) && <button type="button" onClick={()=>openEdit(current)} style={footBtn(cfg.accent)}>✎ แก้ไข</button>}
                    {canEdit(current) && (() => {
                      const blocked = confirmsByPosting && !current.book_id
                      return <button type="button" disabled={confirmM.isPending || blocked} onClick={()=>confirmM.mutate(current.id)}
                        title={blocked ? 'เลือกสมุดบันทึกก่อนยืนยัน' : undefined}
                        style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), ...(blocked ? docDisabled : {}), opacity: blocked ? 0.45 : confirmM.isPending ? 0.7 : 1 }}>{confirmM.isPending ? 'กำลังยืนยัน...' : `✓ ${confirmLabel}`}</button>
                    })()}
                  </>
                })() : <>
                  <button type="button" onClick={cancelForm} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending} style={{ ...footBtn(cfg.accent), opacity:createM.isPending?0.7:1 }}>{current && current.status !== 'draft' ? 'บันทึก' : 'บันทึกร่าง'}</button>
                  {(() => {
                    const blocked = confirmsByPosting && !watch('book_id')
                    return <button type="button" disabled={createM.isPending || blocked} onClick={handleSubmit(d=>createM.mutate({ d, confirm:true }))}
                      title={blocked ? 'เลือกสมุดบันทึกก่อนยืนยัน' : undefined}
                      style={{ ...docPrimaryBtn('#43E97B', '#2FBF63'), ...(blocked ? docDisabled : {}), opacity: blocked ? 0.45 : createM.isPending ? 0.7 : 1 }}>{createM.isPending ? 'กำลังบันทึก...' : `✓ บันทึกและ${confirmLabel}`}</button>
                  })()}
                </>}
              </div>
            </form>
          </DocCard>
      )}

    </div>
  )
}

