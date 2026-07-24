import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import api from '@/lib/api'

interface ForecastPoint { date: string; predicted: number; lower_bound: number; upper_bound: number }
interface CashFlowForecast { method: string; current_balance: number; trend_direction: string; trend_slope_per_day: number; forecast: ForecastPoint[]; confidence: number; warning?: string }
interface RevenueForecast { monthly_avg: number; monthly_growth_rate_pct?: number; next_month_forecast: number; next_3_months_forecast: { month: string; forecast: number }[]; confidence: number; explanation: string }
interface ExpenseItem { category: string; trend: string; change_pct?: number; current_month: number; avg_past_months: number; flag?: string }
interface ExpenseTrends { items: ExpenseItem[]; total_current: number; total_change_pct?: number }
interface BenchmarkMetric { metric: string; company_value?: number; industry_avg: number; industry_range: string; assessment: string }
interface Benchmark { industry: string; metrics: BenchmarkMetric[]; summary: string }

const tooltipStyle = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 8, color: '#DDE3EE', fontSize: 11 }
const fmtB = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const TREND_COLOR: Record<string, string> = { increasing: '#FF6B6B', decreasing: '#43E97B', stable: '#4FACFE' }
const ASSESSMENT_META: Record<string, { label: string; color: string }> = {
  above_average: { label: 'ดีกว่าค่าเฉลี่ย', color: '#43E97B' }, average: { label: 'ใกล้เคียงค่าเฉลี่ย', color: '#F5A623' }, below_average: { label: 'ต่ำกว่าค่าเฉลี่ย', color: '#FF6B6B' },
}

export default function PredictiveAnalyticsPage() {
  const [tab, setTab] = useState<'cashflow' | 'revenue' | 'expense' | 'benchmark'>('cashflow')
  const [industry, setIndustry] = useState('general')

  const { data: cashFlow } = useQuery<CashFlowForecast>({
    queryKey: ['cf-forecast'], enabled: tab === 'cashflow',
    queryFn: async () => (await api.get('/api/v1/analytics/cash-flow-forecast')).data,
  })
  const { data: revenue } = useQuery<RevenueForecast>({
    queryKey: ['rev-forecast'], enabled: tab === 'revenue',
    queryFn: async () => (await api.get('/api/v1/analytics/revenue-forecast')).data,
  })
  const { data: expenseTrends } = useQuery<ExpenseTrends>({
    queryKey: ['expense-trends'], enabled: tab === 'expense',
    queryFn: async () => (await api.get('/api/v1/analytics/expense-trends')).data,
  })
  const { data: benchmark } = useQuery<Benchmark>({
    queryKey: ['benchmark', industry], enabled: tab === 'benchmark',
    queryFn: async () => (await api.get(`/api/v1/analytics/industry-benchmark?industry=${industry}`)).data,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Predictive Analytics & BI</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>พยากรณ์กระแสเงินสด รายได้ และเปรียบเทียบอุตสาหกรรม</p>
      </div>

      <div style={{ display: 'flex', gap: 3, background: '#0D1018', borderRadius: 9, padding: 3, width: 'fit-content' }}>
        {[['cashflow', '💰 Cash Flow'], ['revenue', '📈 Revenue'], ['expense', '📊 Expense Trends'], ['benchmark', '🏆 Benchmark']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as any)} style={{ background: tab === id ? '#00D4AA' : 'transparent', color: tab === id ? '#07090E' : '#5A6A80', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* ── CASH FLOW FORECAST ── */}
      {tab === 'cashflow' && cashFlow && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {[
              { l: 'ยอดปัจจุบัน', v: fmtB(cashFlow.current_balance), color: '#4FACFE' },
              { l: 'แนวโน้ม', v: cashFlow.trend_direction === 'increasing' ? '📈 เพิ่มขึ้น' : cashFlow.trend_direction === 'decreasing' ? '📉 ลดลง' : '➡️ คงที่', color: TREND_COLOR[cashFlow.trend_direction] },
              { l: 'อัตราเปลี่ยนแปลง/วัน', v: fmtB(cashFlow.trend_slope_per_day), color: '#F5A623' },
              { l: 'Confidence', v: `${(cashFlow.confidence * 100).toFixed(0)}%`, color: '#43E97B' },
            ].map(s => (
              <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          {cashFlow.warning && (
            <div style={{ background: '#FF6B6B10', border: '1px solid #FF6B6B30', borderRadius: 10, padding: '12px 16px' }}>
              <p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>{cashFlow.warning}</p>
            </div>
          )}

          {cashFlow.forecast.length > 0 && (
            <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>พยากรณ์กระแสเงินสด ({cashFlow.forecast.length} วันข้างหน้า)</p>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={cashFlow.forecast}>
                  <defs>
                    <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00D4AA" stopOpacity={0.3} /><stop offset="95%" stopColor="#00D4AA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151C28" />
                  <XAxis dataKey="date" tick={{ fill: '#4A5A70', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => new Date(v).getDate().toString()} />
                  <YAxis tick={{ fill: '#4A5A70', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtB(v), '']} labelFormatter={l => new Date(l).toLocaleDateString('th-TH')} />
                  <ReferenceLine y={0} stroke="#FF6B6B" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="upper_bound" stroke="none" fill="#00D4AA10" />
                  <Area type="monotone" dataKey="predicted" stroke="#00D4AA" strokeWidth={2} fill="url(#predGrad)" />
                  <Area type="monotone" dataKey="lower_bound" stroke="none" fill="#00D4AA05" />
                </AreaChart>
              </ResponsiveContainer>
              <p style={{ margin: '10px 0 0', fontSize: 10, color: '#3A4A60', textAlign: 'center' }}>วิธี: Linear Regression พร้อม 95% Confidence Interval — ไม่ใช่การรับประกัน เป็นการประมาณการจากแนวโน้มในอดีต</p>
            </div>
          )}
        </>
      )}

      {/* ── REVENUE FORECAST ── */}
      {tab === 'revenue' && revenue && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {[
              { l: 'เฉลี่ยรายเดือน', v: fmtB(revenue.monthly_avg), color: '#4FACFE' },
              { l: 'อัตราเติบโต/เดือน', v: revenue.monthly_growth_rate_pct != null ? `${revenue.monthly_growth_rate_pct >= 0 ? '+' : ''}${revenue.monthly_growth_rate_pct.toFixed(1)}%` : '—', color: (revenue.monthly_growth_rate_pct || 0) >= 0 ? '#43E97B' : '#FF6B6B' },
              { l: 'คาดการณ์เดือนหน้า', v: fmtB(revenue.next_month_forecast), color: '#00D4AA' },
              { l: 'Confidence', v: `${(revenue.confidence * 100).toFixed(0)}%`, color: '#F5A623' },
            ].map(s => (
              <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          <div style={{ background: '#00D4AA08', border: '1px solid #00D4AA20', borderRadius: 10, padding: '12px 16px' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#8A9BB0' }}>{revenue.explanation}</p>
          </div>

          {revenue.next_3_months_forecast.length > 0 && (
            <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>คาดการณ์ 3 เดือนข้างหน้า</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                {revenue.next_3_months_forecast.map(m => (
                  <div key={m.month} style={{ background: '#070A0F', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 6px', fontSize: 11, color: '#4A5A70' }}>{m.month}</p>
                    <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#00D4AA' }}>{fmtB(m.forecast)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── EXPENSE TRENDS ── */}
      {tab === 'expense' && expenseTrends && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '18px 22px', display: 'flex', justifyContent: 'space-between' }}>
            <div><p style={{ margin: '0 0 4px', fontSize: 11, color: '#4A5A70' }}>ค่าใช้จ่ายเดือนนี้รวม</p><p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#F093FB' }}>{fmtB(expenseTrends.total_current)}</p></div>
            {expenseTrends.total_change_pct != null && (
              <div style={{ textAlign: 'right' }}><p style={{ margin: '0 0 4px', fontSize: 11, color: '#4A5A70' }}>เทียบค่าเฉลี่ย</p><p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: expenseTrends.total_change_pct >= 0 ? '#FF6B6B' : '#43E97B' }}>{expenseTrends.total_change_pct >= 0 ? '+' : ''}{expenseTrends.total_change_pct.toFixed(1)}%</p></div>
            )}
          </div>
          {expenseTrends.items.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#3A4A60' }}>ยังไม่มีข้อมูลค่าใช้จ่ายเพียงพอ</div>
          ) : expenseTrends.items.map(item => (
            <div key={item.category} style={{ background: '#0D1018', border: `1px solid ${item.flag ? '#FF6B6B40' : '#151C28'}`, borderLeft: `3px solid ${TREND_COLOR[item.trend]}`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700 }}>{item.category}</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#4A5A70' }}>เดือนนี้ {fmtB(item.current_month)} · เฉลี่ยเก่า {fmtB(item.avg_past_months)}</p>
                </div>
                {item.change_pct != null && (
                  <span style={{ fontSize: 14, fontWeight: 800, color: TREND_COLOR[item.trend] }}>{item.change_pct >= 0 ? '+' : ''}{item.change_pct.toFixed(0)}%</span>
                )}
              </div>
              {item.flag && <p style={{ margin: '8px 0 0', fontSize: 11, color: '#FF6B6B' }}>{item.flag}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── INDUSTRY BENCHMARK ── */}
      {tab === 'benchmark' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['general', 'ทั่วไป'], ['retail', 'ค้าปลีก'], ['services', 'บริการ']].map(([v, l]) => (
              <button key={v} onClick={() => setIndustry(v)} style={{ background: industry === v ? '#00D4AA' : '#0D1018', color: industry === v ? '#07090E' : '#5A6A80', border: '1px solid #151C28', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          {benchmark && (
            <>
              <div style={{ background: '#00D4AA08', border: '1px solid #00D4AA20', borderRadius: 10, padding: '14px 18px' }}>
                <p style={{ margin: 0, fontSize: 13, color: '#8A9BB0' }}>{benchmark.summary}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {benchmark.metrics.map(m => {
                  const am = ASSESSMENT_META[m.assessment]
                  return (
                    <div key={m.metric} style={{ background: '#0D1018', border: `1px solid ${am.color}25`, borderRadius: 12, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{m.metric}</p>
                        <span style={{ fontSize: 10, fontWeight: 700, color: am.color, background: am.color + '18', padding: '3px 10px', borderRadius: 10 }}>{am.label}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 24 }}>
                        <div><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>บริษัทของคุณ</p><p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: am.color }}>{m.company_value != null ? m.company_value.toFixed(1) : '—'}</p></div>
                        <div><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>ค่าเฉลี่ยอุตสาหกรรม</p><p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#8A9BB0' }}>{m.industry_avg}</p></div>
                        <div><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>ช่วงปกติ</p><p style={{ margin: 0, fontSize: 13, color: '#6A7A90', paddingTop: 3 }}>{m.industry_range}</p></div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: 0, fontSize: 10, color: '#2A3A50', textAlign: 'center' }}>* ค่าเฉลี่ยอุตสาหกรรมเป็นข้อมูลอ้างอิงทั่วไปสำหรับ SME ไทย ไม่ใช่ข้อมูลสถิติทางการ</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
