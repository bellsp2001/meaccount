import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface SalesReport {
  period_from: string; period_to: string
  total_sales: number; total_vat: number; invoice_count: number
  paid_amount: number; outstanding: number
  by_month: { month: string; total: number; count: number }[]
  by_customer: { customer: string; total: number; count: number }[]
  by_status: Record<string, number>
}
interface AgingBucket { count: number; total: number; items: { number: string; customer: string; due_date: string; balance_due: number }[] }
interface Aging { as_of: string; current: AgingBucket; '1_30': AgingBucket; '31_60': AgingBucket; '61_90': AgingBucket; over_90: AgingBucket; grand_total: number }

const STATUS_LABEL: Record<string,string> = { draft:'ร่าง', sent:'ส่งแล้ว', partial:'ชำระบางส่วน', paid:'ชำระครบ', overdue:'เกินกำหนด', cancelled:'ยกเลิก' }
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`

export default function SalesReportPage() {
  const today = new Date()
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth()-5, 1).toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const { data: rep, isLoading } = useQuery<SalesReport>({
    queryKey: ['sales-report', from, to],
    queryFn: async () => (await api.get('/api/v1/ar/reports/sales', { params: { period_from: from, period_to: to } })).data,
  })
  const { data: aging } = useQuery<Aging>({
    queryKey: ['aging'],
    queryFn: async () => (await api.get('/api/v1/ar/reports/aging')).data,
  })

  const maxMonth = Math.max(1, ...(rep?.by_month || []).map(m=>Number(m.total)))
  const agingBuckets = aging ? [
    { l:'ยังไม่ครบกำหนด', b: aging.current, c:'#43E97B' },
    { l:'1–30 วัน', b: aging['1_30'], c:'#F5A623' },
    { l:'31–60 วัน', b: aging['31_60'], c:'#FF9F0A' },
    { l:'61–90 วัน', b: aging['61_90'], c:'#FF6B6B' },
    { l:'เกิน 90 วัน', b: aging.over_90, c:'#FF375F' },
  ] : []

  const card: React.CSSProperties = { background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, padding:'18px 20px' }
  const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'7px 10px', fontSize:12, color:'var(--color-text)', outline:'none' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>รายงานการขาย</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>สรุปยอดขาย ภาษีขาย และลูกหนี้คงค้าง</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={inp} />
          <span style={{ color:'var(--color-dim)' }}>—</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={inp} />
        </div>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
        {[
          { l:'ยอดขาย (ก่อน VAT)', v: baht(rep?.total_sales||0), color:'#43E97B' },
          { l:'ภาษีขาย (VAT)', v: baht(rep?.total_vat||0), color:'#F5A623' },
          { l:'รับชำระแล้ว', v: baht(rep?.paid_amount||0), color:'var(--color-accent-light)' },
          { l:'ค้างชำระ', v: baht(rep?.outstanding||0), color:'#FF6B6B' },
          { l:'จำนวนใบแจ้งหนี้', v: rep?.invoice_count||0, color:'#64D2FF' },
        ].map(s=>(
          <div key={s.l} style={{ background:'var(--color-card)', border:`1px solid ${s.color}20`, borderTop:`2px solid ${s.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{s.l}</p>
            <p style={{ margin:0, fontSize:18, fontWeight:800, color:s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div> : (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Monthly */}
        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ยอดขายรายเดือน</h3>
          {(rep?.by_month || []).length === 0 ? <p style={{ fontSize:12, color:'var(--color-dim)' }}>ไม่มีข้อมูลในช่วงนี้</p> :
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {rep!.by_month.map(m=>(
                <div key={m.month}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                    <span style={{ color:'var(--color-text-tertiary)' }}>{m.month}</span>
                    <span style={{ fontFamily:'monospace', fontWeight:600 }}>{baht(m.total)}</span>
                  </div>
                  <div style={{ height:8, background:'var(--color-bg-inset)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Number(m.total)/maxMonth*100}%`, background:'linear-gradient(90deg,#43E97B,#38C172)', borderRadius:4 }} />
                  </div>
                </div>
              ))}
            </div>}
        </div>

        {/* Top customers */}
        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ลูกค้ายอดสูงสุด</h3>
          {(rep?.by_customer || []).length === 0 ? <p style={{ fontSize:12, color:'var(--color-dim)' }}>ไม่มีข้อมูล</p> :
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {rep!.by_customer.map((c,i)=>(
                <div key={c.customer} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--color-border-subtle)' }}>
                  <span><span style={{ color:'var(--color-dim)', marginRight:8 }}>{i+1}</span>{c.customer}</span>
                  <span style={{ fontFamily:'monospace', fontWeight:600, color:'#43E97B' }}>{baht(c.total)}</span>
                </div>
              ))}
            </div>}
        </div>

        {/* By status */}
        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ตามสถานะ</h3>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {Object.entries(rep?.by_status || {}).length === 0 ? <p style={{ fontSize:12, color:'var(--color-dim)' }}>ไม่มีข้อมูล</p> :
              Object.entries(rep!.by_status).map(([k,v])=>(
                <div key={k} style={{ background:'var(--color-bg-inset)', borderRadius:10, padding:'10px 16px', minWidth:100 }}>
                  <p style={{ margin:'0 0 2px', fontSize:11, color:'var(--color-muted)' }}>{STATUS_LABEL[k]||k}</p>
                  <p style={{ margin:0, fontSize:20, fontWeight:800 }}>{v}</p>
                </div>
              ))}
          </div>
        </div>

        {/* Aging */}
        <div style={card}>
          <h3 style={{ margin:'0 0 4px', fontSize:14, fontWeight:800 }}>อายุลูกหนี้คงค้าง (Aging)</h3>
          <p style={{ margin:'0 0 14px', fontSize:11, color:'var(--color-dim)' }}>รวมค้างชำระ {baht(aging?.grand_total || 0)}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {agingBuckets.map(a=>(
              <div key={a.l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12 }}>
                <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:a.c, display:'inline-block' }} />
                  {a.l} <span style={{ color:'var(--color-dim)', fontSize:10 }}>({a.b.count})</span>
                </span>
                <span style={{ fontFamily:'monospace', fontWeight:600, color: Number(a.b.total)>0?a.c:'var(--color-dim)' }}>{baht(a.b.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
