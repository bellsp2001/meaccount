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
import { docBadge, docPrimaryBtn, docCancelBtn, docFooter, docLockedNote } from '@/components/doc/docStyles'
import { DocumentBookSelect, useDocumentBooks } from '@/components/books/DocumentBookSelect'
import VatSelect from '@/components/doc/VatSelect'
import VatModeSelect from '@/components/doc/VatModeSelect'
import ProductInput from '@/components/doc/ProductInput'
import { useProducts, productPrice, type ProductOption } from '@/components/doc/products'
import { useVatCodes, defaultVatCodeId, vatRateOf, vatCodeForLine, documentTotals } from '@/components/doc/vat'
import SearchSelect from '@/components/ui/SearchSelect'

interface Customer { id: string; code?: string; name: string; tax_id?: string; address?: string; branch_code?: string }
interface Item { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number
                 tax_code_id?: string | null; vat_rate?: number | null; product_id?: string | null; detail?: string | null }
interface Invoice {
  id: string; number: string; customer_id: string; customer?: Customer; date: string; due_date: string; note?: string
  book_id?: string | null; book?: { code: string; name: string } | null
  subtotal: number; vat_rate: number; vat_amount: number; total: number; items: Item[]; vat_inclusive?: boolean
}

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

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
const schema = z.object({
  customer_id: z.string().min(1, 'เลือกลูกค้า'),
  date:        z.string().min(1),
  due_date:    z.string().optional(),
  vat_mode:    z.enum(['exclusive', 'inclusive']),
  note:       z.string().optional(),
  // Issuing a tax invoice posts it straight away, so the สมุดบันทึก is required here.
  book_id:     z.string().min(1, 'เลือกสมุดบันทึกก่อนออกใบกำกับภาษี'),
  items:       z.array(itemSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
})
type TForm = z.infer<typeof schema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }

export default function TaxInvoicesPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<Invoice|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const cols = useColumns('tax-invoices', [
    { id:'number', label:'เลขที่', required:true }, { id:'customer', label:'ลูกค้า' }, { id:'tax_id', label:'เลขผู้เสียภาษี' },
    { id:'date', label:'วันที่' }, { id:'subtotal', label:'มูลค่า' }, { id:'vat', label:'VAT' }, { id:'total', label:'รวม' },
    
  ])

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['tax-invoices'],
    queryFn: async () => (await api.get('/api/v1/ar/tax-invoices')).data,
  })
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/api/v1/ar/customers')).data,
  })
  const { data: vatCodes = [] } = useVatCodes()
  const { data: products = [] } = useProducts()

  // Issue a tax invoice = create the invoice, then post it to GL (Dr AR / Cr Revenue + VAT).
  const createM = useMutation({
    mutationFn: async (d: TForm) => {
      // Each line carries its own VAT; the header rate is just the first line's, for display.
      const items = d.items.map(it => ({ ...it, tax_code_id: it.tax_code_id || undefined, product_id: it.product_id || undefined, detail: it.detail || undefined, vat_rate: vatRateOf(vatCodes, it.tax_code_id) }))
      const { vat_mode, ...rest } = d
      const payload = { ...rest, due_date: d.due_date || undefined, items, vat_rate: items[0]?.vat_rate ?? 0, vat_inclusive: vat_mode === 'inclusive' }
      const { data: inv } = await api.post('/api/v1/ar/invoices', payload)
      await api.post(`/api/v1/ar/invoices/${inv.id}/post-gl`)
      return inv
    },
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['tax-invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      openView(inv)   // issued: show it
    },
  })

  const newLine = () => ({ description:'', quantity:1, unit:'', unit_price:0, discount_pct:0, tax_code_id: defaultVatCodeId(vatCodes), product_id: '', detail: '' })
  const blankForm = (): TForm => ({ customer_id: '', date: localToday(), due_date: '', vat_mode: 'exclusive', note: '', book_id: '', items: [newLine()] })
  const invForm = (inv: Invoice): TForm => ({
    customer_id: inv.customer_id ?? inv.customer?.id ?? '', date: inv.date, due_date: inv.due_date, note: inv.note ?? '',
    vat_mode: inv.vat_inclusive ? 'inclusive' : 'exclusive',
    book_id: inv.book_id ?? '',
    items: inv.items.map(it => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit ?? '',
                                  unit_price: Number(it.unit_price), discount_pct: Number(it.discount_pct ?? 0),
                                  tax_code_id: vatCodeForLine(vatCodes, it.tax_code_id, it.vat_rate ?? inv.vat_rate), product_id: it.product_id ?? '', detail: it.detail ?? '' })),
  })
  const { register, handleSubmit, control, reset, watch, setValue, formState:{ errors } } = useForm<TForm>({
    resolver: zodResolver(schema),
    defaultValues: blankForm(),
  })
  // One card for issuing and viewing: an issued tax invoice is posted, so it opens read-only.
  const openCreate = () => { setView(null); reset(blankForm()); createM.reset(); setShowCreate(true) }
  const openView = (inv: Invoice) => { setView(inv); reset(invForm(inv)); createM.reset(); setShowCreate(true) }
  const closeCard = () => { setShowCreate(false); setView(null) }
  const readOnly = !!view
  const customerMissing = view?.customer && !customers.some(c => c.id === view.customer_id)
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')
  // Picking a สินค้า/บริการ for a line fills its unit and selling price.
  const pickProduct = (i: number, p: ProductOption) => {
    setValue(`items.${i}.description`, p.name)
    setValue(`items.${i}.product_id`, p.id)
    setValue(`items.${i}.unit`, p.unit ?? '')
    setValue(`items.${i}.unit_price`, productPrice(p, 'sales'))
  }
  const lineAmount = (it: Partial<TForm['items'][number]>) => (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100)
  const { subtotal, vat: vatAmt, total } = documentTotals(vatCodes,
    watchItems.map(it => ({ amount: lineAmount(it), codeId: it.tax_code_id })), watch('vat_mode'))
  // Picking a book with a VAT tax type sets every line's VAT to it; each line stays editable.
  const { data: incomeBooks = [] } = useDocumentBooks('income')
  const bookField = register('book_id', {
    onChange: e => {
      const book = incomeBooks.find(b => b.id === e.target.value)
      if (book?.tax_code?.kind === 'vat' && book.tax_code_id)
        watchItems.forEach((_, i) => setValue(`items.${i}.tax_code_id`, book.tax_code_id ?? ''))
    },
  })

  // The tax invoice card replaces the list on the page.
  const panelOpen = showCreate
  const shown = invoices.filter(i => matchesSearch(search, i.number, i.customer?.name, i.customer?.code, i.customer?.tax_id,
    i.subtotal, i.vat_amount, i.total, new Date(i.date).toLocaleDateString('th-TH')))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {!panelOpen && <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบกำกับภาษี (Tax Invoice)</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>ออกใบกำกับภาษี/ใบแจ้งหนี้และบันทึกบัญชีอัตโนมัติ — ทั้งหมด {invoices.length} ฉบับ</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#FF9E80,#F2714E)', color:'var(--color-on-accent)', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>+ ออกใบกำกับภาษี</button>
      </div>

      <DocSearch value={search} onChange={setSearch} count={shown.length} total={invoices.length} placeholder="ค้นหาเลขที่ ชื่อลูกค้า เลขผู้เสียภาษี หรือยอดเงิน">
        <ColumnPicker cols={cols} />
      </DocSearch>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : invoices.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีใบกำกับภาษี — กด “+ ออกใบกำกับภาษี” เพื่อเริ่ม</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่พบใบกำกับภาษีที่ค้นหา</div>
        : (
          <table className="doc-list">
            <thead><tr>{cols.visible.map(c=>(
              <th key={c.id} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{c.id === 'actions' ? '' : c.label}</th>))}
            </tr></thead>
            <tbody>
              {shown.map(inv=>(
                <tr key={inv.id} onClick={()=>openView(inv)} style={{ cursor:'pointer' }}>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:12, color:'var(--color-accent-light)' }}>{inv.number}</td>
                  {cols.on('customer') && <td className="doc-wrap" style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }}>{inv.customer?.name || '—'}</td>}
                  {cols.on('tax_id') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, fontFamily:'monospace', color:'var(--color-text-tertiary)' }}>{inv.customer?.tax_id || '—'}</td>}
                  {cols.on('date') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(inv.date).toLocaleDateString('th-TH')}</td>}
                  {cols.on('subtotal') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace' }}>฿{Number(inv.subtotal).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>}
                  {cols.on('vat') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', color:'#F5A623' }}>฿{Number(inv.vat_amount).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>}
                  {cols.on('total') && <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', fontWeight:700 }}>฿{Number(inv.total).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      </>}

      {/* TAX INVOICE CARD — one layout for issuing and viewing */}
      {showCreate && (
          <DocCard
            title={view ? `ใบกำกับภาษี ${view.number}` : 'ออกใบกำกับภาษี'}
            subtitle={view
              ? [view.customer?.name, view.customer?.tax_id && `เลขผู้เสียภาษี ${view.customer.tax_id}${view.customer.branch_code ? ` (สาขา ${view.customer.branch_code})` : ''}`, view.customer?.address].filter(Boolean).join(' · ')
              : 'บันทึกใบแจ้งหนี้และลงบัญชี (Dr ลูกหนี้ / Cr รายได้ + VAT) อัตโนมัติ'}
            onBack={closeCard} backLabel="กลับไปที่ใบกำกับภาษี"
            actions={view && <span style={docBadge('#43E97B')}>✓ ลงบัญชีแล้ว</span>}>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              <fieldset disabled={readOnly} className={`doc-form${readOnly ? ' doc-ro' : ''}`} style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <div>
                <DocumentBookSelect side="income" field={bookField} value={watch('book_id')} inputStyle={inp} labelStyle={lbl}
                  current={view?.book && { ...view.book, id: view.book_id ?? undefined }} />
                {errors.book_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.book_id.message}</p>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1.4fr', gap:12 }}>
                <div>
                  <label style={lbl}>ลูกค้า *</label>
                  <SearchSelect {...register('customer_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                    {customerMissing && view?.customer && <option value={view.customer_id}>{view.customer.code} — {view.customer.name}</option>}
                  </SearchSelect>
                  {errors.customer_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.customer_id.message}</p>}
                </div>
                <div><label style={lbl}>วันที่</label><input {...register('date')} type="date" style={inp} /></div>
                <div><label style={lbl}>ครบกำหนด</label><input {...register('due_date')} type="date" style={inp} /></div>
                <VatModeSelect field={register('vat_mode')} labelStyle={lbl} style={inp} />
              </div>

              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <label style={lbl}>รายการสินค้า/บริการ</label>
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

              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:10, padding:'14px 20px', minWidth:240 }}>
                  {[['ยอดก่อน VAT', `฿${subtotal.toLocaleString('th-TH',{minimumFractionDigits:2})}`, 'var(--color-text)'],
                    ['ภาษีมูลค่าเพิ่ม (VAT)', `฿${vatAmt.toLocaleString('th-TH',{minimumFractionDigits:2})}`, '#F5A623']].map(([l,v,c])=>(
                    <div key={l as string} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:12 }}>
                      <span style={{ color:'var(--color-text-tertiary)' }}>{l}</span><span style={{ color:c as string }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0 0', borderTop:'1px solid var(--color-border-strong)', marginTop:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>ยอดรวมทั้งสิ้น</span>
                    <span style={{ fontSize:16, fontWeight:800, color:'#F2714E' }}>฿{total.toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>

              <div><label style={lbl}>หมายเหตุ</label><textarea {...register('note')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" /></div>
              </fieldset>

              {!readOnly && (
                <div style={{ background:'#F2714E08', border:'1px solid #F2714E25', borderRadius:10, padding:'12px 16px' }}>
                  <p style={{ margin:0, fontSize:11, color:'#F2714E' }}>✦ เมื่อบันทึก ระบบจะออกใบแจ้งหนี้/ใบกำกับภาษี และลงบัญชีเข้า GL อัตโนมัติ</p>
                </div>
              )}
              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>เกิดข้อผิดพลาด — โปรดตรวจสอบว่ามีบัญชีลูกหนี้/รายได้ในผังบัญชี</p></div>}
              <div style={docFooter}>
                {view ? <>
                  <span style={docLockedNote}>ใบกำกับภาษีลงบัญชีแล้ว แก้ไขไม่ได้ — ปรับยอดด้วยใบลดหนี้/ใบเพิ่มหนี้</span>
                  <button type="button" onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/tax-invoice/${view.id}`)} style={docPrimaryBtn('#FF9E80', '#F2714E')}>🖨 พิมพ์ PDF</button>
                </> : <>
                  <button type="button" onClick={closeCard} style={docCancelBtn}>ยกเลิก</button>
                  <button type="submit" disabled={createM.isPending} style={{ ...docPrimaryBtn('#FF9E80', '#F2714E'), opacity:createM.isPending?0.7:1 }}>{createM.isPending ? 'กำลังออกใบกำกับภาษี...' : '✓ ออกใบกำกับภาษี + ลงบัญชี'}</button>
                </>}
              </div>
            </form>
          </DocCard>
      )}

    </div>
  )
}
