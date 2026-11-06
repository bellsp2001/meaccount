import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { openDocPdf } from '@/lib/pdf'

interface Receipt {
  id: string; receipt_number: string; invoice_id: string; invoice_number?: string
  customer_name?: string; date: string; amount: number; method: string
  reference?: string; gl_posted: boolean
}
interface Invoice {
  id: string; number: string; customer?: { name: string }; status: string
  total: number; balance_due: number
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด', bank_transfer: 'โอนธนาคาร', check: 'เช็ค',
  credit_card: 'บัตรเครดิต', promptpay: 'PromptPay',
}

const schema = z.object({
  invoice_id: z.string().min(1, 'เลือกใบแจ้งหนี้'),
  amount:     z.number().min(0.01, 'จำนวนเงินต้องมากกว่า 0'),
  method:     z.enum(['cash','bank_transfer','check','credit_card','promptpay']),
  date:       z.string().min(1),
  reference:  z.string().optional(),
})
type RForm = z.infer<typeof schema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }

export default function ReceiptsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: receipts = [], isLoading } = useQuery<Receipt[]>({
    queryKey: ['receipts'],
    queryFn: async () => (await api.get('/api/v1/ar/receipts')).data,
  })
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get('/api/v1/ar/invoices')).data,
  })
  const outstanding = invoices.filter(i => ['sent','partial','overdue'].includes(i.status) && Number(i.balance_due) > 0)

  const createM = useMutation({
    mutationFn: (d: RForm) => api.post('/api/v1/ar/payments', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receipts'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setShowCreate(false); reset()
    },
  })

  const { register, handleSubmit, reset, setValue, watch, formState:{ errors } } = useForm<RForm>({
    resolver: zodResolver(schema),
    defaultValues: { date: new Date().toISOString().split('T')[0], method: 'bank_transfer' },
  })
  const selectedInv = outstanding.find(i => i.id === watch('invoice_id'))

  const total = receipts.reduce((s,r)=>s+Number(r.amount),0)
  const thisMonth = receipts.filter(r=>{ const d=new Date(r.date); const n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear() }).reduce((s,r)=>s+Number(r.amount),0)

  const overlay: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:16 }
  const modal: React.CSSProperties  = { background:'var(--color-card)', border:'1px solid var(--color-border-strong)', borderRadius:16, width:'100%', maxWidth:480, maxHeight:'92vh', overflowY:'auto' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>การชำระ / ใบเสร็จรับเงิน</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>รายการรับชำระเงินจากลูกค้า — ทั้งหมด {receipts.length} รายการ</p>
        </div>
        <button onClick={()=>setShowCreate(true)} style={{ background:'linear-gradient(135deg,#43E97B,#38C172)', color:'#0A2818', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>+ บันทึกรับชำระ</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12 }}>
        {[
          { l:'ยอดรับชำระทั้งหมด', v:`฿${total.toLocaleString('th-TH',{minimumFractionDigits:2})}`, color:'#43E97B' },
          { l:'รับชำระเดือนนี้', v:`฿${thisMonth.toLocaleString('th-TH',{minimumFractionDigits:2})}`, color:'var(--color-accent-light)' },
          { l:'จำนวนใบเสร็จ', v: receipts.length, color:'#F5A623' },
        ].map(s=>(
          <div key={s.l} style={{ background:'var(--color-card)', border:`1px solid ${s.color}20`, borderTop:`2px solid ${s.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{s.l}</p>
            <p style={{ margin:0, fontSize:20, fontWeight:800, color:s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'hidden' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : receipts.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีการรับชำระเงิน — กด “+ บันทึกรับชำระ” เพื่อเริ่ม</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['เลขที่ใบเสร็จ','ใบแจ้งหนี้','ลูกค้า','วันที่','ช่องทาง','อ้างอิง','จำนวนเงิน','GL',''].map(h=>(
              <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }}>{h}</th>))}
            </tr></thead>
            <tbody>
              {receipts.map(r=>(
                <tr key={r.id}>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:11, color:'#43E97B' }}>{r.receipt_number}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontFamily:'monospace', fontSize:11, color:'var(--color-accent-light)' }}>{r.invoice_number || '—'}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }}>{r.customer_name || '—'}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(r.date).toLocaleDateString('th-TH')}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)' }}>{METHOD_LABEL[r.method] || r.method}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11, fontFamily:'monospace', color:'var(--color-text-tertiary)' }}>{r.reference || '—'}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12, fontFamily:'monospace', fontWeight:700, color:'#43E97B' }}>฿{Number(r.amount).toLocaleString('th-TH',{minimumFractionDigits:2})}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>{r.gl_posted ? <span style={{ fontSize:10, color:'#43E97B' }}>✓</span> : <span style={{ fontSize:10, color:'var(--color-dim)' }}>—</span>}</td>
                  <td style={{ padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
                    <button onClick={()=>openDocPdf(`/api/v1/doc-templates/preview/receipt/${r.id}`)} style={{ fontSize:10, padding:'4px 8px', borderRadius:6, border:'1px solid #8E8E9340', background:'#8E8E9312', color:'var(--color-text-secondary)', cursor:'pointer', fontWeight:700 }}>🖨 พิมพ์</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE RECEIPT MODAL */}
      {showCreate && (
        <div style={overlay} onClick={()=>setShowCreate(false)}>
          <div style={modal} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div><h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>บันทึกรับชำระเงิน</h3><p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>เลือกใบแจ้งหนี้ที่ค้างชำระ</p></div>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <label style={lbl}>ใบแจ้งหนี้ที่ค้างชำระ *</label>
                <select {...register('invoice_id')} onChange={e=>{ setValue('invoice_id', e.target.value); const inv = outstanding.find(i=>i.id===e.target.value); if (inv) setValue('amount', Number(inv.balance_due)) }} style={{ ...inp, cursor:'pointer' }}>
                  <option value="">-- เลือกใบแจ้งหนี้ --</option>
                  {outstanding.map(i => <option key={i.id} value={i.id}>{i.number} — {i.customer?.name} (ค้าง ฿{Number(i.balance_due).toLocaleString('th-TH',{minimumFractionDigits:2})})</option>)}
                </select>
                {errors.invoice_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.invoice_id.message}</p>}
                {outstanding.length === 0 && <p style={{ margin:'6px 0 0', fontSize:11, color:'var(--color-dim)' }}>ไม่มีใบแจ้งหนี้ค้างชำระ (ต้อง Post GL ใบแจ้งหนี้ก่อนจึงจะรับชำระได้)</p>}
              </div>
              <div>
                <label style={lbl}>จำนวนเงิน (บาท) *</label>
                <input {...register('amount', {valueAsNumber:true})} type="number" min="0.01" step="0.01" style={{ ...inp, fontSize:16, fontWeight:700, padding:'12px 14px', color:'#43E97B' }} />
                {selectedInv && <p style={{ margin:'4px 0 0', fontSize:10, color:'var(--color-muted)' }}>ยอดค้างชำระ: ฿{Number(selectedInv.balance_due).toLocaleString('th-TH',{minimumFractionDigits:2})}</p>}
                {errors.amount && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.amount.message}</p>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={lbl}>วันที่รับเงิน</label><input {...register('date')} type="date" style={inp} /></div>
                <div>
                  <label style={lbl}>ช่องทางการรับเงิน</label>
                  <select {...register('method')} style={{ ...inp, cursor:'pointer' }}>
                    <option value="bank_transfer">โอนธนาคาร</option>
                    <option value="cash">เงินสด</option>
                    <option value="promptpay">PromptPay</option>
                    <option value="check">เช็ค</option>
                    <option value="credit_card">บัตรเครดิต</option>
                  </select>
                </div>
              </div>
              <div><label style={lbl}>เลขที่อ้างอิง (เลขที่โอน/เช็ค)</label><input {...register('reference')} placeholder="TRANS20260929001" style={inp} /></div>
              <div style={{ background:'#43E97B08', border:'1px solid #43E97B25', borderRadius:10, padding:'12px 16px' }}>
                <p style={{ margin:0, fontSize:11, color:'#43E97B' }}>✦ ระบบจะออกใบเสร็จและ Auto Post เข้า GL อัตโนมัติ (Dr ธนาคาร/เงินสด / Cr ลูกหนี้)</p>
              </div>
              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>เกิดข้อผิดพลาด — จำนวนเงินอาจเกินยอดค้างชำระ</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background:'linear-gradient(135deg,#43E97B,#38C172)', color:'#0A2818', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity:createM.isPending?0.7:1 }}>{createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึกรับชำระ'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
