import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { openDocPdf } from '@/lib/pdf'

interface Customer { id: string; code: string; name: string; credit_days: number }
interface InvoiceItem { id: string; description: string; quantity: number; unit?: string; unit_price: number; discount_pct: number; amount: number }
interface Invoice {
  id: string; number: string; customer_id: string; customer?: Customer
  date: string; due_date: string; status: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number
  paid_amount: number; balance_due: number; note?: string; gl_posted: boolean
  items: InvoiceItem[]
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',        color: '#F5A623' },
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
})
const invoiceSchema = z.object({
  customer_id: z.string().min(1, 'เลือกลูกค้า'),
  date:        z.string().min(1),
  due_date:    z.string().optional(),
  vat_rate:    z.number().min(0).max(100),
  note:        z.string().optional(),
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
  const [showOCR, setShowOCR] = useState(false)
  const [viewInv, setViewInv] = useState<Invoice|null>(null)
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

  const createM = useMutation({
    mutationFn: (d: IForm) => api.post('/api/v1/ar/invoices', { ...d, due_date: d.due_date || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); setShowCreate(false); resetInv() },
  })
  const postM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ar/invoices/${id}/post-gl`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
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

  const { register: regInv, handleSubmit: subInv, control, reset: resetInv, watch: watchInv, formState: { errors: errInv } } = useForm<IForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0], vat_rate: 7, items: [{ description:'', quantity:1, unit_price:0, discount_pct:0 }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watchInv('items')
  const watchVAT = watchInv('vat_rate') || 7
  const subtotal = watchItems.reduce((s, it) => {
    const amt = (Number(it.quantity)||0) * (Number(it.unit_price)||0) * (1 - (Number(it.discount_pct)||0)/100)
    return s + amt
  }, 0)
  const vatAmt = subtotal * watchVAT / 100
  const total  = subtotal + vatAmt

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

  const totalUnpaid = invoices.filter(i=>['sent','partial','overdue'].includes(i.status)).reduce((s,i)=>s+Number(i.balance_due),0)
  const totalPaid   = invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+Number(i.total),0)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบแจ้งหนี้ (Invoice)</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>Accounts Receivable — ทั้งหมด {invoices.length} ฉบับ</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>setShowOCR(true)} style={{ background:'#F2714E15', border:'1px solid #F2714E40', color:'#F2714E', fontWeight:700, fontSize:12, borderRadius:9, padding:'9px 16px', cursor:'pointer' }}>
            📄 OCR อ่านใบแจ้งหนี้
          </button>
          <button onClick={()=>setShowCreate(true)} style={{ background:'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>
            + ออกใบแจ้งหนี้
          </button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
        {[
          { l:'ค้างชำระทั้งหมด', v:`฿${totalUnpaid.toLocaleString('th-TH',{minimumFractionDigits:2})}`, color:'#FF6B6B' },
          { l:'ชำระครบแล้ว', v:`฿${totalPaid.toLocaleString('th-TH',{minimumFractionDigits:2})}`, color:'#43E97B' },
          { l:'Draft', v: invoices.filter(i=>i.status==='draft').length, color:'#F5A623' },
          { l:'เกินกำหนด', v: invoices.filter(i=>i.status==='overdue').length, color:'#F093FB' },
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
        : invoices.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีใบแจ้งหนี้</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['เลขที่','ลูกค้า','วันที่','ครบกำหนด','ยอดรวม','ค้างชำระ','สถานะ','GL','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const sm = STATUS_META[inv.status] || STATUS_META.draft
                return (
                  <tr key={inv.id} onClick={()=>setViewInv(inv)} style={{ cursor:'pointer' }}>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:12, color: 'var(--color-accent-light)' }}>{inv.number}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }}>{inv.customer?.name || '—'}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(inv.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color: new Date(inv.due_date)<new Date()&&inv.status!=='paid'?'#FF6B6B':'var(--color-text-tertiary)' }}>{new Date(inv.due_date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', fontWeight:600 }}>฿{Number(inv.total).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', color: Number(inv.balance_due)>0?'#FF6B6B':'#43E97B', fontWeight:600 }}>{Number(inv.balance_due)>0?`฿${Number(inv.balance_due).toLocaleString('th-TH',{minimumFractionDigits:2})}`:'✓'}</td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize:10, fontWeight:700, color:sm.color, background:sm.color+'18', border:`1px solid ${sm.color}35`, padding:'2px 8px', borderRadius:10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
                      {inv.gl_posted ? <span style={{ fontSize:10, color:'#43E97B' }}>✓ Posted</span> : <span style={{ fontSize:10, color:'var(--color-dim)' }}>—</span>}
                    </td>
                    <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }} onClick={e=>e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        <button onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/invoice/${inv.id}`)} style={{ fontSize:10, padding:'4px 8px', borderRadius:6, border:'1px solid #8E8E9340', background:'#8E8E9312', color:'var(--color-text-secondary)', cursor:'pointer', fontWeight:700 }}>🖨 พิมพ์</button>
                        {!inv.gl_posted && inv.status==='draft' && (
                          <button onClick={()=>postM.mutate(inv.id)} style={{ fontSize:10, padding:'4px 8px', borderRadius:6, border:'1px solid #FFB59E40', background:'#FFB59E12', color: 'var(--color-accent-light)', cursor:'pointer', fontWeight:700 }}>Post GL</button>
                        )}
                        {['sent','partial'].includes(inv.status) && (
                          <button onClick={()=>{ setShowPay(inv); resetPay({ date: new Date().toISOString().split('T')[0], method:'bank_transfer' }) }}
                            style={{ fontSize:10, padding:'4px 8px', borderRadius:6, border:'1px solid #43E97B40', background:'#43E97B12', color:'#43E97B', cursor:'pointer', fontWeight:700 }}>รับเงิน</button>
                        )}
                        {['draft','sent'].includes(inv.status) && (
                          <button onClick={()=>cancelM.mutate(inv.id)} style={{ fontSize:10, padding:'4px 8px', borderRadius:6, border:'1px solid #FF6B6B30', background:'#FF6B6B08', color:'#FF6B6B', cursor:'pointer' }}>ยกเลิก</button>
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

      {/* ── CREATE INVOICE MODAL ── */}
      {showCreate && (
        <div style={overlay} onClick={()=>setShowCreate(false)}>
          <div style={modal} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>ออกใบแจ้งหนี้ใหม่</h3>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={subInv(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
              {/* Header */}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>ลูกค้า *</label>
                  <select {...regInv('customer_id')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
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
                <div>
                  <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>VAT %</label>
                  <input {...regInv('vat_rate', {valueAsNumber:true})} type="number" min="0" max="100" style={inp} />
                </div>
              </div>

              {/* Items */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em' }}>รายการสินค้า/บริการ</label>
                  <button type="button" onClick={()=>append({description:'',quantity:1,unit_price:0,discount_pct:0})}
                    style={{ fontSize:11, background:'var(--color-border)', border:'1px solid var(--color-border-strong)', color:'var(--color-text-secondary)', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>+ เพิ่มรายการ</button>
                </div>
                <div style={{ background:'var(--color-bg-inset)', borderRadius:10, overflow:'hidden', border:'1px solid var(--color-border)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['รายละเอียด','จำนวน','หน่วย','ราคา/หน่วย','ส่วนลด%','จำนวนเงิน',''].map(h=>(
                          <th key={h} style={{ padding:'7px 8px', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', borderBottom:'1px solid var(--color-border)', textAlign:'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, i) => {
                        const it = watchItems[i] || {}
                        const amt = (Number(it.quantity)||0)*(Number(it.unit_price)||0)*(1-(Number(it.discount_pct)||0)/100)
                        return (
                          <tr key={field.id}>
                            <td style={{ padding:'5px 6px', width:'32%' }}><input {...regInv(`items.${i}.description`)} placeholder="ชื่อสินค้า/บริการ" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'10%' }}><input {...regInv(`items.${i}.quantity`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'9%' }}><input {...regInv(`items.${i}.unit`)} placeholder="ชิ้น" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'15%' }}><input {...regInv(`items.${i}.unit_price`,{valueAsNumber:true})} type="number" min="0" step="0.01" style={{ ...inp, fontSize:11, textAlign:'right' }}/></td>
                            <td style={{ padding:'5px 6px', width:'10%' }}><input {...regInv(`items.${i}.discount_pct`,{valueAsNumber:true})} type="number" min="0" max="100" step="0.01" style={{ ...inp, fontSize:11 }}/></td>
                            <td style={{ padding:'5px 6px', width:'16%', fontFamily:'monospace', fontSize:12, color:'#43E97B', textAlign:'right', paddingRight:10 }}>{amt.toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:'5px 6px', width:28 }}>
                              {fields.length>1&&<button type="button" onClick={()=>remove(i)} style={{ background:'none', border:'none', color:'#FF6B6B', cursor:'pointer', fontSize:13 }}>✕</button>}
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
                    [`VAT ${watchVAT}%`, `฿${vatAmt.toLocaleString('th-TH',{minimumFractionDigits:2})}`, '#F5A623'],
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
                </div>
              </div>

              <div>
                <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>หมายเหตุ</label>
                <textarea {...regInv('note')} rows={2} style={{ ...inp, resize:'vertical' }} placeholder="ข้อความเพิ่มเติม (ไม่บังคับ)" />
              </div>

              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background:'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity:createM.isPending?0.7:1 }}>
                  {createM.isPending ? 'กำลังออกใบแจ้งหนี้...' : '✓ ออกใบแจ้งหนี้'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
                  <select {...regPay('method')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="bank_transfer">โอนธนาคาร</option>
                    <option value="cash">เงินสด</option>
                    <option value="promptpay">PromptPay</option>
                    <option value="check">เช็ค</option>
                    <option value="credit_card">บัตรเครดิต</option>
                  </select>
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
