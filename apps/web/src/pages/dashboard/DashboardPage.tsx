import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────
interface KPI {
  revenue:       { amount: number; change_pct?: number; period: string }
  expense:       { amount: number; change_pct?: number; period: string }
  gross_profit:  { amount: number; period: string }
  cash_balance:  { amount: number }
  ar_outstanding:{ amount: number; overdue: number }
  ap_outstanding:{ amount: number; overdue: number }
  pending_approvals: number
  overdue_invoices:  number
}
interface ChartRow { month_th: string; revenue: number; expense: number; profit: number }
interface Alert    { type: string; icon: string; title: string; detail: string; module: string }
interface ExpBreak { name: string; amount: number }

// ── Helpers ───────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtB = (n: number) => `฿${fmt(n)}`

const CHART_COLORS = ['#00D4AA','#4FACFE','#F093FB','#F5A623','#43E97B','#FA709A','#667EEA','#FED330']
const ALERT_COLORS: Record<string, string> = { warning: '#F5A623', info: '#4FACFE', danger: '#FF6B6B', success: '#43E97B' }

function KPICard({ label, value, sub, color, icon, change }: { label: string; value: string; sub?: string; color: string; icon: string; change?: number | null }) {
  return (
    <div style={{ background: '#0D1018', border: `1px solid ${color}20`, borderTop: `3px solid ${color}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 11, color: '#4A5A70', fontWeight: 600 }}>{label}</p>
        <span style={{ fontSize: 18, color }}>{icon}</span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color, lineHeight: 1.2 }}>{value}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {sub && <p style={{ margin: 0, fontSize: 10, color: '#3A4A60' }}>{sub}</p>}
        {change != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: change >= 0 ? '#43E97B' : '#FF6B6B' }}>
            {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
          </span>
        )}
      </div>
    </div>
  )
}

const tooltipStyle = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 8, color: '#DDE3EE', fontSize: 11 }

export default function DashboardPage() {
  const { user } = useAuthStore()

  const { data: kpi } = useQuery<KPI>({ queryKey: ['kpi'], queryFn: async () => (await api.get('/api/v1/dashboard/kpi')).data, refetchInterval: 60000 })
  const { data: revenueChart = [] } = useQuery<ChartRow[]>({ queryKey: ['chart-rev'], queryFn: async () => (await api.get('/api/v1/dashboard/charts/revenue-expense?months=6')).data })
  const { data: expBreak = [] } = useQuery<ExpBreak[]>({ queryKey: ['chart-exp'], queryFn: async () => (await api.get('/api/v1/dashboard/charts/expense-breakdown')).data })
  const { data: alerts = [] } = useQuery<Alert[]>({ queryKey: ['alerts'], queryFn: async () => (await api.get('/api/v1/dashboard/alerts')).data, refetchInterval: 30000 })

  const totalExpPie = expBreak.reduce((s, e) => s + e.amount, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Welcome banner */}
      <div style={{ background: 'linear-gradient(135deg,#00D4AA12,#4FACFE08)', border: '1px solid #00D4AA20', borderRadius: 16, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>
            สวัสดี, {user?.full_name?.split(' ')[0]} 👋
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#5A6A80' }}>
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {alerts.length > 0 && (
            <div style={{ background: '#FF6B6B15', border: '1px solid #FF6B6B35', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>🔔</span>
              <span style={{ fontSize: 12, color: '#FF6B6B', fontWeight: 700 }}>{alerts.length} การแจ้งเตือน</span>
            </div>
          )}
          <div style={{ background: '#00D4AA15', border: '1px solid #00D4AA30', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>🤖</span>
            <span style={{ fontSize: 11, color: '#00D4AA', fontWeight: 600 }}>AI ออนไลน์</span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((alert, i) => (
            <div key={i} style={{ background: `${ALERT_COLORS[alert.type]}10`, border: `1px solid ${ALERT_COLORS[alert.type]}30`, borderLeft: `3px solid ${ALERT_COLORS[alert.type]}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 18 }}>{alert.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: ALERT_COLORS[alert.type] }}>{alert.title}</p>
                <p style={{ margin: 0, fontSize: 11, color: '#5A6A80' }}>{alert.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 14 }}>
        {kpi ? (
          <>
            <KPICard label="รายได้เดือนนี้"    value={fmtB(kpi.revenue.amount)}       color="#00D4AA" icon="⬆" change={kpi.revenue.change_pct} sub={kpi.revenue.period} />
            <KPICard label="ค่าใช้จ่ายเดือนนี้" value={fmtB(kpi.expense.amount)}      color="#F093FB" icon="⬇" change={kpi.expense.change_pct} sub={kpi.expense.period} />
            <KPICard label="กำไรขั้นต้น"        value={fmtB(kpi.gross_profit.amount)}  color={kpi.gross_profit.amount >= 0 ? "#43E97B" : "#FF6B6B"} icon="◈" sub={kpi.gross_profit.period} />
            <KPICard label="เงินสด/ธนาคาร"      value={fmtB(kpi.cash_balance.amount)}  color="#4FACFE" icon="🏦" />
            <KPICard label="ลูกหนี้ค้างชำระ"    value={fmtB(kpi.ar_outstanding.amount)} color="#F5A623" icon="📄" sub={kpi.ar_outstanding.overdue > 0 ? `เกินกำหนด ฿${fmt(kpi.ar_outstanding.overdue)}` : undefined} />
            <KPICard label="เจ้าหนี้ค้างจ่าย"   value={fmtB(kpi.ap_outstanding.amount)} color="#FA709A" icon="💸" sub={kpi.ap_outstanding.overdue > 0 ? `เกินกำหนด ฿${fmt(kpi.ap_outstanding.overdue)}` : undefined} />
          </>
        ) : (
          Array(6).fill(0).map((_, i) => (
            <div key={i} style={{ background: '#0D1018', borderRadius: 14, height: 100, border: '1px solid #151C28', animation: 'pulse 1.5s infinite' }} />
          ))
        )}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Revenue/Expense chart */}
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>รายได้และค่าใช้จ่าย (6 เดือน)</p>
          {revenueChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenueChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00D4AA" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00D4AA" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F093FB" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F093FB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#151C28" />
                <XAxis dataKey="month_th" tick={{ fill: '#4A5A70', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#4A5A70', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtB(v), '']} />
                <Legend formatter={v => v === 'revenue' ? 'รายได้' : v === 'expense' ? 'ค่าใช้จ่าย' : 'กำไร'} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="revenue" stroke="#00D4AA" strokeWidth={2} fill="url(#revGrad)" name="revenue" />
                <Area type="monotone" dataKey="expense" stroke="#F093FB" strokeWidth={2} fill="url(#expGrad)" name="expense" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3A4A60', fontSize: 13 }}>
              ยังไม่มีข้อมูล — รันคำสั่ง seed เพื่อดูกราฟตัวอย่าง
            </div>
          )}
        </div>

        {/* Expense breakdown pie */}
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>ค่าใช้จ่ายตามหมวด</p>
          {expBreak.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={expBreak} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="amount" stroke="none">
                    {expBreak.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtB(v), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {expBreak.slice(0, 4).map((e, i) => (
                  <div key={e.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: CHART_COLORS[i], display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: '#6A7A80', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: CHART_COLORS[i] }}>{totalExpPie > 0 ? Math.round(e.amount / totalExpPie * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3A4A60', fontSize: 12, textAlign: 'center' }}>
              ยังไม่มีข้อมูล<br />ค่าใช้จ่ายเดือนนี้
            </div>
          )}
        </div>
      </div>

      {/* Quick stats row */}
      {kpi && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
          {[
            { label: 'Bills รออนุมัติ', value: kpi.pending_approvals, color: '#4FACFE', path: '/ap', icon: '📋' },
            { label: 'Invoice เกินกำหนด', value: kpi.overdue_invoices, color: '#FF6B6B', path: '/ar', icon: '⚠' },
          ].map(item => (
            <a key={item.label} href={item.path} style={{ background: '#0D1018', border: `1px solid ${item.color}20`, borderRadius: 12, padding: '14px 16px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color 0.15s' }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 800, color: item.value > 0 ? item.color : '#3A4A60' }}>{item.value}</p>
                <p style={{ margin: 0, fontSize: 11, color: '#4A5A70' }}>{item.label}</p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
