import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { openDocPdf } from '@/lib/pdf'

type DocType = 'quotation' | 'sales_order' | 'deposit'

interface Customer { id: string; code: string; name: string }
interface DocItem { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number }
interface SalesDoc {
  id: string; number: string; doc_type: DocType; customer_id: string; customer?: Customer
  date: string; valid_until?: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number; deposit_amount: number
  note?: string; gl_posted: boolean
  converted_to_type?: string; converted_to_id?: string
  items: DocItem[]
}

const CFG: Record<DocType, {
  title: string; subtitle: string; createLabel: string; validLabel: string
  convertLabel?: string; accent: string
}> = {
  quotation:   { title: 'ใบเสนอราคา (Quotation)', subtitle: 'เสนอราคาสินค้า/บริการให้ลูกค้า', createLabel: '+ สร้างใบเสนอราคา', validLabel: 'ยืนราคาถึง', convertLabel: 'แปลงเป็นคำสั่งขาย', accent: '#0A84FF' },
  sales_order: { title: 'คำสั่งขาย (Sales Order)', subtitle: 'ยืนยันคำสั่งซื้อจากลูกค้า', createLabel: '+ สร้างคำสั่งขาย', validLabel: 'กำหนดส่งของ', convertLabel: 'แปลงเป็นใบแจ้งหนี้', accent: '#5E5CE6' },
  deposit:     { title: 'ใบมัดจำ (Deposit)', subtitle: 'รับเงินมัดจำล่วงหน้าจากลูกค้า', createLabel: '+ สร้างใบมัดจำ', validLabel: 'กำหนดชำระ', accent: '#FF9F0A' },
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',      color: '#F5A623' },
  sent:      { label: 'ส่งแล้ว',    color: 'var(--color-accent-light)' },
  accepted:  { label: 'รับแล้ว',    color: '#43E97B' },
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
  customer_id:    z.string().min(1, 'เลือกลูกค้า'),
  date:           z.string().min(1),
  valid_until:    z.string().optional(),
  vat_rate:       z.number().min(0).max(100),
  deposit_amount: z.number().min(0).optional(),
  note:           z.string().optional(),
  items:          z.array(itemSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
})
type DForm = z.infer<typeof docSchema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }

export default function SalesDocPage({ docType }: { docType: DocType }) {
  const cfg = CFG[docType]
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [viewDoc, setViewDoc] = useState<SalesDoc|null>(null)
  const isDeposit = docType === 'deposit'

  const { data: docs = [], isLoading } = useQuery<SalesDoc[]>({
    queryKey: ['sales-docs', docType],
    queryFn: async () => (await api.get('/api/v1/ar/sales-documents', { params: { doc_type: docType } })).data,
  })
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/api/v1/ar/customers')).data,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sales-docs', docType] })
  const createM  = useMutation({ mutationFn: (d: DForm) => api.post('/api/v1/ar/sales-documents', { doc_type: docType, ...d, valid_until: d.valid_until || undefined }), onSuccess: () => { invalidate(); setShowCreate(false); reset() } })
  const sendM    = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ar/sales-documents/${id}/status`, null, { params: { status: 'sent' } }), onSuccess: invalidate })
  const convertM = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ar/sales-documents/${id}/convert`), onSuccess: (r) => { invalidate(); qc.invalidateQueries({ queryKey: ['sales-docs'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); alert(`แปลงเอกสารสำเร็จ → ${r.data.target_number}`) } })
  const depositM = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ar/sales-documents/${id}/post-deposit`), onSuccess: invalidate })
  const cancelM  = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/ar/sales-documents/${id}/cancel`), onSuccess: invalidate })

  const { register, handleSubmit, control, reset, watch, formState:{ errors } } = useForm<DForm>({
    resolver: zodResolver(docSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0], vat_rate: isDeposit ? 0 : 7, deposit_amount: 0, items: [{ description:'', quantity:1, unit_price:0, discount_pct:0 }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items'); const watchVAT = watch('vat_rate') || 0
  const subtotal = watchItems.reduce((s, it) => s + (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100), 0)
  const vatAmt = subtotal * watchVAT / 100; const total = subtotal + vatAmt

  const overlay: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:16 }
  const modal: React.CSSProperties  = { background:'var(--color-card)', border:'1px solid var(--color-border-strong)', borderRadius:16, width:'100%', maxWidth:820, maxHeight:'92vh', overflowY:'auto' }

  const activeTotal = docs.filter(d=>!['cancelled','converted'].includes(d.status)).reduce((s,d)=>s+Number(isDeposit?d.deposit_amount:d.total),0)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>{cfg.title}</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>{cfg.subtitle} — ทั้งหมด {docs.length} ฉบับ</p>
        </div>
        <button onClick={()=>setShowCreate(true)} style={{ background:`linear-gradient(135deg,${cfg.accent},${cfg.accent}CC)`, color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>{cfg.createLabel}</button>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
        {[
          { l: isDeposit?'ยอดมัดจำที่ใช้งานอยู่':'มูลค่ารวม (ใช้งานอยู่)', v:`฿${activeTotal.toLocaleString('th-TH',{minimumFractionDigits:2})}`, color:cfg.accent },
          { l:'ฉบับร่าง', v: docs.filter(d=>d.status==='draft').length, color:'#F5A623' },
          { l:'ส่งแล้ว', v: docs.filter(d=>d.status==='sent').length, color:'var(--color-accent-light)' },
          { l: isDeposit?'รับมัดจำแล้ว':'แปลงแล้ว', v: docs.filter(d=> isDeposit ? d.gl_posted : d.status==='converted').length, color:'#43E97B' },
        ].map(s=>(
          <div key={s.l} style={{ background:'var(--color-card)', border:`1px solid ${s.color}20`, borderTop:`2px solid ${s.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{s.l}</p>
            <p style={{ margin:0, fontSize:20, fontWeight:800, color:s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'hidden' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : docs.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีเอกสาร</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['เลขที่','ลูกค้า','วันที่', cfg.validLabel, isDeposit?'ยอดมัดจำ':'ยอดรวม','สถานะ','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(d => {
                const sm = STATUS_META[d.status] || STATUS_META.draft
                const locked = ['converted','cancelled'].includes(d.status)
                return (
                  <tr key={d.id} onClick={()=>setViewDoc(d)} style={{ cursor:'pointer' }}>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:12, color:'var(--color-accent-light)' }}>{d.number}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }}>{d.customer?.name || '—'}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(d.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{d.valid_until ? new Date(d.valid_until).toLocaleDateString('th-TH') : '—'}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', fontWeight:600 }}>฿{Number(isDeposit?d.deposit_amount:d.total).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize:10, fontWeight:700, color:sm.color, background:sm.color+'18', border:`1px solid ${sm.color}35`, padding:'2px 8px', borderRadius:10 }}>{sm.label}</span>
                      {isDeposit && d.gl_posted && <span style={{ fontSize:9, marginLeft:6, color:'#43E97B' }}>✓ GL</span>}
                    </td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }} onClick={e=>e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        <button onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/sales-document/${d.id}`)} style={btn('#8E8E93')}>🖨 พิมพ์</button>
                        {d.status==='draft' && <button onClick={()=>sendM.mutate(d.id)} style={btn('#FFB59E')}>ส่ง</button>}
                        {!isDeposit && !locked && cfg.convertLabel && (
                          <button onClick={()=>convertM.mutate(d.id)} style={btn('#64D2FF')}>{cfg.convertLabel}</button>
                        )}
                        {isDeposit && !d.gl_posted && !locked && <button onClick={()=>depositM.mutate(d.id)} style={btn('#43E97B')}>รับมัดจำ (Post GL)</button>}
                        {!locked && !(isDeposit && d.gl_posted) && <button onClick={()=>cancelM.mutate(d.id)} style={btn('#FF6B6B')}>ยกเลิก</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={()=>setShowCreate(false)}>
          <div style={modal} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>{cfg.createLabel.replace('+ ','')}</h3>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:12 }}>
                <div>
                  <label style={lbl}>ลูกค้า *</label>
                  <select {...register('customer_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                  {errors.customer_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.customer_id.message}</p>}
                </div>
                <div><label style={lbl}>วันที่</label><input {...register('date')} type="date" style={inp} /></div>
                <div><label style={lbl}>{cfg.validLabel}</label><input {...register('valid_until')} type="date" style={inp} /></div>
                <div><label style={lbl}>VAT %</label><input {...register('vat_rate',{valueAsNumber:true})} type="number" min="0" max="100" style={inp} /></div>
              </div>

              {isDeposit && (
                <div style={{ maxWidth:260 }}>
                  <label style={lbl}>ยอดเงินมัดจำ (บาท) *</label>
                  <input {...register('deposit_amount',{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:15, fontWeight:700, color:cfg.accent }} />
                </div>
              )}

              {/* Items */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <label style={lbl}>รายการสินค้า/บริการ</label>
                  <button type="button" onClick={()=>append({description:'',quantity:1,unit_price:0,discount_pct:0})} style={{ fontSize:11, background:'var(--color-border)', border:'1px solid var(--color-border-strong)', color:'var(--color-text-secondary)', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background:'var(--color-bg-inset)', borderRadius:10, overflow:'hidden', border:'1px solid var(--color-border)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
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
                            <td style={{ padding:'5px 6px', width:28 }}>{fields.length>1&&<button type="button" onClick={()=>remove(i)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer', fontSize:13 }}>✕</button>}</td>
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
                  {[['ยอดก่อน VAT', `฿${subtotal.toLocaleString('th-TH',{minimumFractionDigits:2})}`, 'var(--color-text)'],
                    [`VAT ${watchVAT}%`, `฿${vatAmt.toLocaleString('th-TH',{minimumFractionDigits:2})}`, '#F5A623']].map(([l,v,c])=>(
                    <div key={l as string} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:12 }}>
                      <span style={{ color:'var(--color-text-tertiary)' }}>{l}</span><span style={{ color:c as string }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0 0', borderTop:'1px solid var(--color-border-strong)', marginTop:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>ยอดรวมทั้งสิ้น</span>
                    <span style={{ fontSize:16, fontWeight:800, color:cfg.accent }}>฿{total.toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>

              <div><label style={lbl}>หมายเหตุ</label><textarea {...register('note')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" /></div>

              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background:`linear-gradient(135deg,${cfg.accent},${cfg.accent}CC)`, color:'#fff', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity:createM.isPending?0.7:1 }}>{createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {viewDoc && (
        <div style={overlay} onClick={()=>setViewDoc(null)}>
          <div style={{ ...modal, maxWidth:640 }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div><h3 style={{ margin:0, fontSize:15, fontWeight:800, fontFamily:'monospace' }}>{viewDoc.number}</h3><p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>{viewDoc.customer?.name}</p></div>
              <button onClick={()=>setViewDoc(null)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div style={{ padding:24 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:16 }}>
                <thead><tr>{['รายการ','จำนวน','ราคา','รวม'].map(h=><th key={h} style={{ padding:'6px 8px', fontSize:10, color:'var(--color-dim)', textAlign:'left', borderBottom:'1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
                <tbody>{viewDoc.items.map(it=>(
                  <tr key={it.id}>
                    <td style={{ padding:'6px 8px', fontSize:12, borderBottom:'1px solid var(--color-border-subtle)' }}>{it.description}</td>
                    <td style={{ padding:'6px 8px', fontSize:12, borderBottom:'1px solid var(--color-border-subtle)' }}>{Number(it.quantity)} {it.unit||''}</td>
                    <td style={{ padding:'6px 8px', fontSize:12, borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace' }}>฿{Number(it.unit_price).toLocaleString('th-TH')}</td>
                    <td style={{ padding:'6px 8px', fontSize:12, borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', textAlign:'right' }}>฿{Number(it.amount).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:24, fontSize:13 }}>
                <div style={{ textAlign:'right' }}>
                  <p style={{ margin:'2px 0', color:'var(--color-text-tertiary)' }}>ยอดก่อน VAT: <b style={{ color:'var(--color-text)' }}>฿{Number(viewDoc.subtotal).toLocaleString('th-TH',{minimumFractionDigits:2})}</b></p>
                  <p style={{ margin:'2px 0', color:'var(--color-text-tertiary)' }}>VAT: <b style={{ color:'#F5A623' }}>฿{Number(viewDoc.vat_amount).toLocaleString('th-TH',{minimumFractionDigits:2})}</b></p>
                  {isDeposit && <p style={{ margin:'2px 0', color:'var(--color-text-tertiary)' }}>เงินมัดจำ: <b style={{ color:cfg.accent }}>฿{Number(viewDoc.deposit_amount).toLocaleString('th-TH',{minimumFractionDigits:2})}</b></p>}
                  <p style={{ margin:'6px 0 0', fontSize:16, fontWeight:800, color:cfg.accent }}>รวม ฿{Number(viewDoc.total).toLocaleString('th-TH',{minimumFractionDigits:2})}</p>
                </div>
              </div>
              {viewDoc.note && <p style={{ marginTop:14, fontSize:12, color:'var(--color-text-tertiary)' }}>📝 {viewDoc.note}</p>}
              {viewDoc.converted_to_type && <p style={{ marginTop:10, fontSize:11, color:'#64D2FF' }}>↪ แปลงเป็น {viewDoc.converted_to_type === 'invoice' ? 'ใบแจ้งหนี้' : 'คำสั่งขาย'} แล้ว</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return { fontSize:10, padding:'4px 8px', borderRadius:6, border:`1px solid ${color}40`, background:`${color}12`, color, cursor:'pointer', fontWeight:700 }
}
