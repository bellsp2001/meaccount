import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { openDocPdf } from '@/lib/pdf'
import DocCard from '@/components/doc/DocCard'
import { docBadge as badge, docActionBtn as footBtn, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote } from '@/components/doc/docStyles'

// One page for every line-item document on both sides of the business:
//   sales:    quotation → sales_order → invoice, deposit, credit_note, debit_note
//   purchase: rfq → purchase_order → bill,       deposit, credit_note, debit_note
export type Side = 'sales' | 'purchase'
export type DocType = 'quotation' | 'sales_order' | 'rfq' | 'purchase_order' | 'deposit' | 'credit_note' | 'debit_note'

interface Party { id: string; code: string; name: string }
interface RefDoc { id: string; number: string; status: string; gl_posted: boolean; total: number; balance_due: number; customer_id?: string; supplier_id?: string }
interface DocItem { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number }
interface TradeDoc {
  id: string; number: string; doc_type: DocType
  customer?: Party; supplier?: Party
  date: string; valid_until?: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number; deposit_amount: number
  ref_number?: string; note?: string; reason?: string; gl_posted: boolean
  converted_to_type?: string
  invoice_id?: string; bill_id?: string
  invoice?: { number: string }; bill?: { number: string }
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
  draft:     { label: 'Draft',      color: '#F5A623' },
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
})
const docSchema = z.object({
  party_id:       z.string().min(1, 'เลือกคู่ค้า'),
  ref_id:         z.string().optional(),
  date:           z.string().min(1),
  valid_until:    z.string().optional(),
  vat_rate:       z.number().min(0).max(100),
  deposit_amount: z.number().min(0).optional(),
  ref_number:     z.string().optional(),
  reason:         z.string().optional(),
  note:           z.string().optional(),
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
  const isDeposit = docType === 'deposit'
  const isNote = docType === 'credit_note' || docType === 'debit_note'
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
  // Only issued documents can be adjusted by a note.
  const adjustable = refDocs.filter(r => r.gl_posted && !['cancelled','rejected'].includes(r.status))

  const after = (extra?: string) => () => {
    setActionError(null)
    qc.invalidateQueries({ queryKey })
    if (extra) qc.invalidateQueries({ queryKey: [extra] })
  }
  const onActionError = (e: unknown) => setActionError(errText(e, 'ทำรายการไม่สำเร็จ'))

  const createM  = useMutation({
    mutationFn: (d: DForm) => {
      const { party_id, ref_id, ...rest } = d
      const body = {
        doc_type: docType, ...rest, [s.partyKey]: party_id,
        ...(isNote ? { [s.refKey]: ref_id || undefined } : {}),
        valid_until: d.valid_until || undefined,
      }
      return openDoc ? api.put(`${s.docs}/${openDoc.id}`, body) : api.post(s.docs, body)
    },
    onSuccess: (r) => { after()(); openView(r.data) },   // saved: show the document
  })
  const sendM    = useMutation({ mutationFn: (id: string) => api.post(`${s.docs}/${id}/status`, null, { params: { status: 'sent' } }), onSuccess: after(), onError: onActionError })
  const convertM = useMutation({
    mutationFn: (id: string) => api.post(`${s.docs}/${id}/convert`),
    onSuccess: (r) => { after(s.targetQuery)(); qc.invalidateQueries({ queryKey: ['trade-docs', side] }); alert(`แปลงเอกสารสำเร็จ → ${r.data.target_number}`) },
    onError: onActionError,
  })
  const postM    = useMutation({
    mutationFn: (id: string) => api.post(`${s.docs}/${id}/${isDeposit ? 'post-deposit' : 'post-note'}`),
    onSuccess: after(isNote ? s.refQuery : undefined), onError: onActionError,
  })
  const cancelM  = useMutation({ mutationFn: (id: string) => api.post(`${s.docs}/${id}/cancel`), onSuccess: after(), onError: onActionError })

  const blankForm = (): DForm => ({
    party_id: '', ref_id: '', date: localToday(), valid_until: '', vat_rate: isDeposit ? 0 : 7, deposit_amount: 0,
    ref_number: '', reason: '', note: '', items: [{ description:'', quantity:1, unit:'', unit_price:0, discount_pct:0 }],
  })
  const docForm = (d: TradeDoc): DForm => ({
    party_id: (side === 'sales' ? d.customer : d.supplier)?.id ?? '',
    ref_id: (side === 'sales' ? d.invoice_id : d.bill_id) ?? '',
    date: d.date, valid_until: d.valid_until ?? '', vat_rate: Number(d.vat_rate), deposit_amount: Number(d.deposit_amount),
    ref_number: d.ref_number ?? '', reason: d.reason ?? '', note: d.note ?? '',
    items: d.items.map(it => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit ?? '',
                                unit_price: Number(it.unit_price), discount_pct: Number(it.discount_pct) })),
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
  const watchItems = watch('items'); const vatInput = watch('vat_rate')
  const watchVAT = Number.isFinite(vatInput) ? vatInput : 0
  const watchParty = watch('party_id')
  const subtotal = watchItems.reduce((sum, it) => sum + (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100), 0)
  const vatAmt = subtotal * watchVAT / 100; const total = subtotal + vatAmt
  const refOptions = adjustable.filter(r => !watchParty || (side === 'sales' ? r.customer_id : r.supplier_id) === watchParty)


  const amountOf = (d: TradeDoc) => Number(isDeposit ? d.deposit_amount : d.total)
  const activeTotal = docs.filter(d=>!['cancelled','converted'].includes(d.status)).reduce((sum,d)=>sum+amountOf(d),0)
  const partyOf = (d: TradeDoc) => (side === 'sales' ? d.customer : d.supplier)?.name || '—'
  const refOf = (d: TradeDoc) => (side === 'sales' ? d.invoice : d.bill)?.number

  // The document card replaces the list on the page.
  const panelOpen = showCreate
  const docName = cfg.title.split(' /')[0]
  const partyMissing = current && !parties.some(p => p.id === (side === 'sales' ? current.customer : current.supplier)?.id)
  const currentParty = current ? (side === 'sales' ? current.customer : current.supplier) : undefined

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

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
        {[
          { l: isDeposit ? 'ยอดมัดจำที่ใช้งานอยู่' : 'มูลค่ารวม (ใช้งานอยู่)', v: baht(activeTotal), color: cfg.accent },
          { l:'ฉบับร่าง', v: docs.filter(d=>d.status==='draft').length, color:'#F5A623' },
          { l:'ส่งแล้ว', v: docs.filter(d=>d.status==='sent').length, color:'var(--color-accent-light)' },
          { l: isDeposit || isNote ? 'ลงบัญชีแล้ว' : 'แปลงแล้ว', v: docs.filter(d=> isDeposit || isNote ? d.gl_posted : d.status==='converted').length, color:'#43E97B' },
        ].map(k=>(
          <div key={k.l} style={{ background:'var(--color-card)', border:`1px solid ${k.color}20`, borderTop:`2px solid ${k.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{k.l}</p>
            <p style={{ margin:0, fontSize:20, fontWeight:800, color:k.color }}>{k.v}</p>
          </div>
        ))}
      </div>

      {actionError && (
        <div role="alert" style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:10, padding:'10px 14px', display:'flex', justifyContent:'space-between', gap:12 }}>
          <span style={{ fontSize:12, color:'#FF6B6B' }}>{actionError}</span>
          <button onClick={()=>setActionError(null)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer' }}>✕</button>
        </div>
      )}

      {/* Table */}
      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : docs.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีเอกสาร — กด “{cfg.createLabel}” เพื่อเริ่ม</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['เลขที่', s.partyLabel, 'วันที่', isNote ? `อ้างอิง${s.refLabel}` : cfg.validLabel, isDeposit?'ยอดมัดจำ':'ยอดรวม','สถานะ','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(d => {
                const sm = STATUS_META[d.status] || STATUS_META.draft
                const locked = ['converted','cancelled'].includes(d.status)
                const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }
                return (
                  <tr key={d.id} onClick={()=>openView(d)} style={{ cursor:'pointer' }}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:12, color:'var(--color-accent-light)' }}>{d.number}</td>
                    <td style={{ ...td, fontSize:12 }}>{partyOf(d)}</td>
                    <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(d.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)', fontFamily: isNote ? 'monospace' : undefined }}>
                      {isNote ? (refOf(d) || '—') : d.valid_until ? new Date(d.valid_until).toLocaleDateString('th-TH') : '—'}
                    </td>
                    <td style={{ ...td, fontSize:12, fontFamily:'monospace', fontWeight:600 }}>{baht(amountOf(d))}</td>
                    <td style={td}>
                      <span style={{ fontSize:10, fontWeight:700, color:sm.color, background:sm.color+'18', border:`1px solid ${sm.color}35`, padding:'2px 8px', borderRadius:10, whiteSpace:'nowrap' }}>{sm.label}</span>
                      {d.gl_posted && <span style={{ fontSize:9, marginLeft:6, color:'#43E97B' }}>✓ GL</span>}
                    </td>
                    <td style={td} onClick={e=>e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {canEdit(d) && <button onClick={()=>openEdit(d)} style={btn('#0A84FF')}>✎ แก้ไข</button>}
                        {side === 'sales' &&<button onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/sales-document/${d.id}`)} style={btn('#8E8E93')}>🖨 พิมพ์</button>}
                        {d.status==='draft' && <button onClick={()=>sendM.mutate(d.id)} style={btn('#FFB59E')}>ส่ง</button>}
                        {cfg.convertLabel && !locked && <button onClick={()=>convertM.mutate(d.id)} style={btn('#64D2FF')}>{cfg.convertLabel}</button>}
                        {cfg.postLabel && !d.gl_posted && !locked && <button onClick={()=>postM.mutate(d.id)} style={btn('#43E97B')}>{cfg.postLabel}</button>}
                        {!locked && !d.gl_posted && <button onClick={()=>cancelM.mutate(d.id)} style={btn('#FF6B6B')}>ยกเลิก</button>}
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
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12 }}>
                <div style={{ gridColumn:'span 2' }}>
                  <label style={lbl}>{s.partyLabel} *</label>
                  <select {...register('party_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือก{s.partyLabel} --</option>
                    {parties.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    {partyMissing && currentParty && <option value={currentParty.id}>{currentParty.code} — {currentParty.name}</option>}
                  </select>
                  {errors.party_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.party_id.message}</p>}
                </div>
                <div><label style={lbl}>วันที่</label><input {...register('date')} type="date" style={inp} /></div>
                {/* An empty date input shows "dd/mm/yyyy"; when viewing, show it blank instead. */}
                {!isNote && <div><label style={lbl}>{cfg.validLabel}</label><input {...register('valid_until')} type={readOnly && !watch('valid_until') ? 'text' : 'date'} style={inp} /></div>}
                <div><label style={lbl}>VAT %</label><input {...register('vat_rate',{valueAsNumber:true})} type="number" min="0" max="100" style={inp} /></div>
              </div>

              {isNote && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
                  <div>
                    <label style={lbl}>อ้างอิง{s.refLabel} *</label>
                    <select {...register('ref_id', { onChange: e => {
                      const ref = adjustable.find(r => r.id === e.target.value)
                      const owner = ref && (side === 'sales' ? ref.customer_id : ref.supplier_id)
                      if (owner) setValue('party_id', owner)
                    } })} style={{ ...inp, cursor:'pointer' }}>
                      <option value="">-- เลือก{s.refLabel}ที่ลงบัญชีแล้ว --</option>
                      {refOptions.map(r => <option key={r.id} value={r.id}>{r.number} — ยอด {baht(r.total)} (ค้าง {baht(r.balance_due)})</option>)}
                      {current && refOf(current) && !refOptions.some(r => r.id === (side === 'sales' ? current.invoice_id : current.bill_id)) &&
                        <option value={(side === 'sales' ? current.invoice_id : current.bill_id) ?? ''}>{refOf(current)}</option>}
                    </select>
                    {!readOnly && refOptions.length === 0 && <p style={{ margin:'4px 0 0', fontSize:10, color:'var(--color-dim)' }}>ไม่มี{s.refLabel}ที่ Post GL แล้ว{watchParty ? `ของ${s.partyLabel}นี้` : ''}</p>}
                  </div>
                  <div><label style={lbl}>เหตุผล</label><input {...register('reason')} placeholder={docType === 'credit_note' ? 'เช่น รับคืนสินค้า / ลดราคา' : 'เช่น ส่งสินค้าเพิ่ม / ปรับราคา'} style={inp} /></div>
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
                  <button type="button" className="doc-edit-only" onClick={()=>append({description:'',quantity:1,unit_price:0,discount_pct:0})} style={{ fontSize:11, background:'var(--color-border)', border:'1px solid var(--color-border-strong)', color:'var(--color-text-secondary)', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background:'var(--color-bg-inset)', borderRadius:10, overflow:'auto', border:'1px solid var(--color-border)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', minWidth:560 }}>
                    <thead><tr>{['รายละเอียด','จำนวน','หน่วย','ราคา/หน่วย','ส่วนลด%','จำนวนเงิน',''].map(h=>(
                      <th key={h} style={{ padding:'7px 8px', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', borderBottom:'1px solid var(--color-border)', textAlign:'left' }}>{h}</th>))}
                    </tr></thead>
                    <tbody>
                      {fields.map((field, i) => {
                        const it = watchItems[i] || {}
                        const amt = (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100)
                        return (
                          <tr key={field.id}>
                            <td style={{ padding:'5px 6px', width:'32%' }}><input {...register(`items.${i}.description`)} placeholder="ชื่อสินค้า/บริการ" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'10%' }}><input {...register(`items.${i}.quantity`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'9%' }}><input {...register(`items.${i}.unit`)} placeholder="ชิ้น" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'15%' }}><input {...register(`items.${i}.unit_price`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11, textAlign:'right' }}/></td>
                            <td style={{ padding:'5px 6px', width:'10%' }}><input {...register(`items.${i}.discount_pct`,{valueAsNumber:true})} type="number" min="0" max="100" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'16%', fontFamily:'monospace', fontSize:12, color:'#43E97B', textAlign:'right', paddingRight:10 }}>{amt.toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
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
                    [`VAT ${watchVAT}%`, baht(vatAmt), '#F5A623']].map(([l,v,c])=>(
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
                    {!canEdit(current) && <span style={docLockedNote}>แก้ไขไม่ได้ — เอกสาร{current.gl_posted ? 'ลงบัญชีแล้ว' : 'ถูกแปลง/ยกเลิกแล้ว'}</span>}
                    {!locked && !current.gl_posted && <button type="button" onClick={()=>cancelM.mutate(current.id)} style={footBtn('#FF6B6B')}>ยกเลิกเอกสาร</button>}
                    {side === 'sales' && <button type="button" onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/sales-document/${current.id}`)} style={footBtn('#8E8E93')}>🖨 พิมพ์</button>}
                    {current.status==='draft' && <button type="button" onClick={()=>sendM.mutate(current.id)} style={footBtn('#FFB59E')}>ส่ง</button>}
                    {cfg.convertLabel && !locked && <button type="button" onClick={()=>convertM.mutate(current.id)} style={footBtn('#64D2FF')}>{cfg.convertLabel}</button>}
                    {cfg.postLabel && !current.gl_posted && !locked && <button type="button" onClick={()=>postM.mutate(current.id)} style={footBtn('#43E97B')}>{cfg.postLabel}</button>}
                    {canEdit(current) && <button type="button" onClick={()=>openEdit(current)} style={docPrimaryBtn(cfg.accent, `${cfg.accent}CC`)}>✎ แก้ไข</button>}
                  </>
                })() : <>
                  <button type="button" onClick={cancelForm} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending} style={{ ...docPrimaryBtn(cfg.accent, `${cfg.accent}CC`), opacity:createM.isPending?0.7:1 }}>{createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึก'}</button>
                </>}
              </div>
            </form>
          </DocCard>
      )}

    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return { fontSize:10, padding:'4px 8px', borderRadius:6, border:`1px solid ${color}40`, background:`${color}12`, color, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap' }
}
