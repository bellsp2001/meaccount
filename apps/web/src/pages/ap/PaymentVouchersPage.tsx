import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import DocSearch from '@/components/doc/DocSearch'
import PanelBack from '@/components/doc/PanelBack'
import ColumnPicker from '@/components/doc/ColumnPicker'
import { useColumns } from '@/components/doc/columns'
import { matchesSearch } from '@/components/doc/search'
import SearchSelect from '@/components/ui/SearchSelect'

// ใบเสร็จรับเงิน/การชำระเงิน (ฝั่งค่าใช้จ่าย) — payments made against bills, mirroring ReceiptsPage.
interface Voucher {
  id: string; voucher_number: string; bill_id: string; bill_number?: string
  supplier_name?: string; date: string; amount: number; method: string
  reference?: string; gl_posted: boolean
}
interface Bill { id: string; number: string; supplier?: { name: string }; status: string; balance_due: number }

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด', bank_transfer: 'โอนธนาคาร', check: 'เช็ค',
  credit_card: 'บัตรเครดิต', promptpay: 'PromptPay',
}

const schema = z.object({
  bill_id:   z.string().min(1, 'เลือกบิล'),
  amount:    z.number().min(0.01, 'จำนวนเงินต้องมากกว่า 0'),
  method:    z.enum(['cash','bank_transfer','check','credit_card','promptpay']),
  date:      z.string().min(1),
  reference: z.string().optional(),
})
type PForm = z.infer<typeof schema>

const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'var(--color-text)', outline:'none', width:'100%', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`
const ACCENT = '#FF9F0A'

export default function PaymentVouchersPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const cols = useColumns('payment-vouchers', [
    { id:'number', label:'เลขที่ใบสำคัญจ่าย', required:true }, { id:'bill', label:'บิล' }, { id:'supplier', label:'ผู้จำหน่าย' },
    { id:'date', label:'วันที่' }, { id:'method', label:'ช่องทาง' }, { id:'reference', label:'อ้างอิง' },
    { id:'amount', label:'จำนวนเงิน' }, { id:'gl', label:'GL' },
  ])

  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ['payment-vouchers'],
    queryFn: async () => (await api.get('/api/v1/ap/payment-vouchers')).data,
  })
  const { data: bills = [] } = useQuery<Bill[]>({
    queryKey: ['bills'],
    queryFn: async () => (await api.get('/api/v1/ap/bills')).data,
  })
  // The API only pays approved (or part-paid) bills.
  const payable = bills.filter(b => ['approved','partial'].includes(b.status) && Number(b.balance_due) > 0)

  const createM = useMutation({
    mutationFn: (d: PForm) => api.post('/api/v1/ap/payments', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-vouchers'] })
      qc.invalidateQueries({ queryKey: ['bills'] })
      setShowCreate(false); reset()
    },
  })

  const { register, handleSubmit, reset, setValue, watch, formState:{ errors } } = useForm<PForm>({
    resolver: zodResolver(schema),
    defaultValues: { date: new Date().toISOString().split('T')[0], method: 'bank_transfer' },
  })
  const selected = payable.find(b => b.id === watch('bill_id'))
  const shown = vouchers.filter(v => matchesSearch(search, v.voucher_number, v.bill_number, v.supplier_name, v.reference,
    v.amount, METHOD_LABEL[v.method] || v.method, new Date(v.date).toLocaleDateString('th-TH')))

  const detail = (createM.error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail

  const th: React.CSSProperties = { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }
  const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:11 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบเสร็จรับเงิน / การชำระเงิน</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>รายการจ่ายชำระให้ผู้จำหน่าย — ทั้งหมด {vouchers.length} รายการ</p>
        </div>
        <button onClick={()=>setShowCreate(true)} style={{ background:`linear-gradient(135deg,${ACCENT},${ACCENT}CC)`, color:'#2A1600', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 20px', cursor:'pointer' }}>+ บันทึกจ่ายชำระ</button>
      </div>

      <DocSearch value={search} onChange={setSearch} count={shown.length} total={vouchers.length} placeholder="ค้นหาเลขที่ บิล ผู้จำหน่าย อ้างอิง หรือยอดเงิน">
        <ColumnPicker cols={cols} />
      </DocSearch>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : vouchers.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีการจ่ายชำระ — กด “+ บันทึกจ่ายชำระ” เพื่อเริ่ม</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่พบรายการที่ค้นหา</div>
        : (
          <table className="doc-list">
            <thead><tr>{cols.visible.map(c=><th key={c.id} style={th}>{c.label}</th>)}</tr></thead>
            <tbody>
              {shown.map(v=>(
                <tr key={v.id}>
                  <td style={{ ...td, fontFamily:'monospace', color: ACCENT }}>{v.voucher_number}</td>
                  {cols.on('bill') && <td style={{ ...td, fontFamily:'monospace', color:'var(--color-accent-light)' }}>{v.bill_number || '—'}</td>}
                  {cols.on('supplier') && <td className="doc-wrap" style={{ ...td, fontSize:12 }}>{v.supplier_name || '—'}</td>}
                  {cols.on('date') && <td style={{ ...td, color:'var(--color-text-tertiary)' }}>{new Date(v.date).toLocaleDateString('th-TH')}</td>}
                  {cols.on('method') && <td style={{ ...td, color:'var(--color-text-tertiary)' }}>{METHOD_LABEL[v.method] || v.method}</td>}
                  {cols.on('reference') && <td style={{ ...td, fontFamily:'monospace', color:'var(--color-text-tertiary)' }}>{v.reference || '—'}</td>}
                  {cols.on('amount') && <td style={{ ...td, fontSize:12, fontFamily:'monospace', fontWeight:700, color: ACCENT }}>{baht(v.amount)}</td>}
                  {cols.on('gl') && <td style={td}>{v.gl_posted ? <span style={{ fontSize:10, color:'#43E97B' }}>✓</span> : <span style={{ fontSize:10, color:'var(--color-dim)' }}>—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="doc-panel">
          <PanelBack onClick={()=>setShowCreate(false)} label="กลับไปที่การชำระเงิน" />
          <div className="doc-panel-card">
            <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div><h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>บันทึกจ่ายชำระ</h3><p style={{ margin:0, fontSize:11, color:'var(--color-muted)' }}>เลือกบิลที่อนุมัติแล้วและยังค้างจ่าย</p></div>
              <button onClick={()=>setShowCreate(false)} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d=>createM.mutate(d))} style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <label style={lbl}>บิลที่ค้างจ่าย *</label>
                <SearchSelect {...register('bill_id', { onChange: e => { const b = payable.find(x=>x.id===e.target.value); if (b) setValue('amount', Number(b.balance_due)) } })} style={{ ...inp, cursor:'pointer' }}>
                  <option value="">-- เลือกบิล --</option>
                  {payable.map(b => <option key={b.id} value={b.id}>{b.number} — {b.supplier?.name || 'ไม่ระบุ'} (ค้าง {baht(b.balance_due)})</option>)}
                </SearchSelect>
                {errors.bill_id && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.bill_id.message}</p>}
                {payable.length === 0 && <p style={{ margin:'6px 0 0', fontSize:11, color:'var(--color-dim)' }}>ไม่มีบิลค้างจ่าย (บิลต้องได้รับการอนุมัติก่อนจึงจะจ่ายได้)</p>}
              </div>
              <div>
                <label style={lbl}>จำนวนเงิน (บาท) *</label>
                <input {...register('amount', {valueAsNumber:true})} type="number" min="0.01" step="0.01" style={{ ...inp, fontSize:16, fontWeight:700, padding:'12px 14px', color: ACCENT }} />
                {selected && <p style={{ margin:'4px 0 0', fontSize:10, color:'var(--color-muted)' }}>ยอดค้างจ่าย: {baht(selected.balance_due)}</p>}
                {errors.amount && <p style={{ margin:'3px 0 0', fontSize:10, color:'#FF6B6B' }}>{errors.amount.message}</p>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={lbl}>วันที่จ่าย</label><input {...register('date')} type="date" style={inp} /></div>
                <div>
                  <label style={lbl}>ช่องทางการจ่าย</label>
                  <SearchSelect {...register('method')} style={{ ...inp, cursor:'pointer' }}>
                    {Object.entries(METHOD_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </SearchSelect>
                </div>
              </div>
              <div><label style={lbl}>เลขที่อ้างอิง (เลขที่โอน/เช็ค)</label><input {...register('reference')} style={inp} /></div>
              <div style={{ background:`${ACCENT}0A`, border:`1px solid ${ACCENT}30`, borderRadius:10, padding:'12px 16px' }}>
                <p style={{ margin:0, fontSize:11, color: ACCENT }}>✦ ระบบจะ Auto Post เข้า GL (Dr เจ้าหนี้ / Cr ธนาคาร/เงินสด)</p>
              </div>
              {createM.isError && <div style={{ background:'#FF6B6B12', border:'1px solid #FF6B6B35', borderRadius:8, padding:'10px 14px' }}><p style={{ margin:0, fontSize:12, color:'#FF6B6B' }}>{typeof detail === 'string' ? detail : 'เกิดข้อผิดพลาด — จำนวนเงินอาจเกินยอดค้างจ่าย'}</p></div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button type="button" onClick={()=>setShowCreate(false)} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--color-border-strong)', background:'transparent', color:'var(--color-text-tertiary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background:`linear-gradient(135deg,${ACCENT},${ACCENT}CC)`, color:'#2A1600', fontWeight:800, fontSize:13, border:'none', borderRadius:9, padding:'10px 24px', cursor:'pointer', opacity:createM.isPending?0.7:1 }}>{createM.isPending ? 'กำลังบันทึก...' : '✓ บันทึกจ่ายชำระ'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
