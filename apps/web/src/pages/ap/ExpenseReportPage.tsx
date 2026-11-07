import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Ranked { total: number; count: number }
interface ExpenseReport {
  period_from: string; period_to: string
  total_expense: number; total_vat: number; total_wht: number; bill_count: number
  paid_amount: number; outstanding: number
  by_month: ({ month: string } & Ranked)[]
  by_category: ({ category: string } & Ranked)[]
  by_supplier: ({ supplier: string } & Ranked)[]
}

const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`
const ACCENT = '#FF9F0A'
// Local calendar date — toISOString() would shift to UTC and land on the previous day in Thailand.
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ExpenseReportPage() {
  const today = new Date()
  const [from, setFrom] = useState(localDate(new Date(today.getFullYear(), today.getMonth()-5, 1)))
  const [to, setTo] = useState(localDate(today))

  const { data: rep, isLoading } = useQuery<ExpenseReport>({
    queryKey: ['expense-report', from, to],
    queryFn: async () => (await api.get('/api/v1/ap/reports/expenses', { params: { period_from: from, period_to: to } })).data,
  })

  const maxMonth = Math.max(1, ...(rep?.by_month || []).map(m=>Number(m.total)))
  const catTotal = Math.max(1, Number(rep?.total_expense || 0))
  const card: React.CSSProperties = { background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, padding:'18px 20px' }
  const inp: React.CSSProperties = { background:'var(--color-bg-inset)', border:'1px solid var(--color-border)', borderRadius:8, padding:'7px 10px', fontSize:12, color:'var(--color-text)', outline:'none' }
  const empty = <p style={{ fontSize:12, color:'var(--color-dim)' }}>ไม่มีข้อมูลในช่วงนี้</p>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>รายงานค่าใช้จ่าย</h2>
          <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>สรุปค่าใช้จ่าย ภาษีซื้อ และเจ้าหนี้คงค้าง</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={inp} aria-label="ตั้งแต่วันที่" />
          <span style={{ color:'var(--color-dim)' }}>—</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={inp} aria-label="ถึงวันที่" />
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:12 }}>
        {[
          { l:'ค่าใช้จ่าย (ก่อน VAT)', v: baht(rep?.total_expense||0), color: ACCENT },
          { l:'ภาษีซื้อ (VAT)', v: baht(rep?.total_vat||0), color:'#F5A623' },
          { l:'ภาษีหัก ณ ที่จ่าย', v: baht(rep?.total_wht||0), color:'#BF5AF2' },
          { l:'จ่ายแล้ว', v: baht(rep?.paid_amount||0), color:'#43E97B' },
          { l:'ค้างจ่าย', v: baht(rep?.outstanding||0), color:'#FF6B6B' },
          { l:'จำนวนบิล', v: rep?.bill_count||0, color:'#64D2FF' },
        ].map(k=>(
          <div key={k.l} style={{ background:'var(--color-card)', border:`1px solid ${k.color}20`, borderTop:`2px solid ${k.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{k.l}</p>
            <p style={{ margin:0, fontSize:18, fontWeight:800, color:k.color }}>{k.v}</p>
          </div>
        ))}
      </div>

      {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div> : (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16 }}>
        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ค่าใช้จ่ายรายเดือน</h3>
          {!rep?.by_month.length ? empty :
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {rep.by_month.map(m=>(
                <div key={m.month}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                    <span style={{ color:'var(--color-text-tertiary)' }}>{m.month} <span style={{ color:'var(--color-dim)' }}>({m.count})</span></span>
                    <span style={{ fontFamily:'monospace', fontWeight:600 }}>{baht(m.total)}</span>
                  </div>
                  <div style={{ height:8, background:'var(--color-bg-inset)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Number(m.total)/maxMonth*100}%`, background:`linear-gradient(90deg,${ACCENT},#FFBD4D)`, borderRadius:4 }} />
                  </div>
                </div>
              ))}
            </div>}
        </div>

        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ตามหมวดค่าใช้จ่าย</h3>
          {!rep?.by_category.length ? empty :
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {rep.by_category.map(c=>(
                <div key={c.category} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--color-border-subtle)' }}>
                  <span>{c.category} <span style={{ color:'var(--color-dim)', fontSize:10 }}>{(Number(c.total)/catTotal*100).toFixed(1)}%</span></span>
                  <span style={{ fontFamily:'monospace', fontWeight:600, color: ACCENT }}>{baht(c.total)}</span>
                </div>
              ))}
            </div>}
        </div>

        <div style={card}>
          <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:800 }}>ผู้จำหน่ายยอดสูงสุด</h3>
          {!rep?.by_supplier.length ? empty :
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {rep.by_supplier.map((sp,i)=>(
                <div key={sp.supplier} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--color-border-subtle)' }}>
                  <span><span style={{ color:'var(--color-dim)', marginRight:8 }}>{i+1}</span>{sp.supplier}</span>
                  <span style={{ fontFamily:'monospace', fontWeight:600, color: ACCENT }}>{baht(sp.total)}</span>
                </div>
              ))}
            </div>}
        </div>
      </div>
      )}
    </div>
  )
}
