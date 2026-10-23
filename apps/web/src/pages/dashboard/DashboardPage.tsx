import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
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

// ── Palette (tavola "Sales Reports" — navy + soft coral) ──────
const CORAL = '#E8926F'
const CORAL_LT = '#F4B49C'
const SLATE = '#8893A8'
const GREEN = '#5BC98C'
const RED   = '#FF6B6B'
const MIX = ['#E8926F', '#5B8DEF', '#5BC98C', '#C58AF0', '#F2C14E', '#5BC0D4', '#F2849E']

// ── Helpers ───────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtB = (n: number) => `฿${fmt(n)}`

function downloadCSV(rows: ChartRow[]) {
  const head = 'เดือน,รายได้,ค่าใช้จ่าย,กำไร'
  const body = rows.map(r => `${r.month_th},${r.revenue},${r.expense},${r.profit}`).join('\n')
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'revenue-expense.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── Reusable bits ─────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 20, backdropFilter: 'blur(var(--glass-blur)) saturate(170%)', WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(170%)', boxShadow: 'var(--shadow-card)', ...style }}>
      {children}
    </div>
  )
}

function ChangeBadge({ pct, big }: { pct?: number | null; big?: boolean }) {
  if (pct == null) return null
  const up = pct >= 0
  const c = up ? GREEN : RED
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c, fontSize: big ? 11.5 : 10, fontWeight: 700, borderRadius: 999, padding: big ? '3px 9px' : '2px 7px' }}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%{big && <span style={{ color: 'var(--color-muted)', fontWeight: 500 }}>vs เดือนก่อน</span>}
    </span>
  )
}

function HeroStat({ icon, value, label, pct, accent }: { icon: string; value: string; label: string; pct?: number | null; accent?: boolean }) {
  return (
    <div className="glass" style={{ display: 'inline-flex', alignItems: 'center', gap: 11, borderRadius: 15, padding: '9px 15px 9px 10px', boxShadow: 'var(--shadow-card)' }}>
      <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 15, background: accent ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'var(--color-bg-inset)', border: accent ? '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)' : '1px solid var(--color-border-subtle)' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em', lineHeight: 1.05, color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}>{value}</span>
          <ChangeBadge pct={pct} />
        </div>
        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--color-card-solid)', border: '1px solid var(--color-border-strong)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-pop)', minWidth: 150 }}>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, fontSize: 11, marginBottom: 3 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--color-text-secondary)' }}>
            <i style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} /> {p.dataKey === 'revenue' ? 'รายได้' : p.dataKey === 'expense' ? 'ค่าใช้จ่าย' : 'กำไร'}
          </span>
          <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{fmtB(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{children}</p>
      {action}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore()
  const [months, setMonths] = useState(6)

  const { data: kpi } = useQuery<KPI>({ queryKey: ['kpi'], queryFn: async () => (await api.get('/api/v1/dashboard/kpi')).data, refetchInterval: 60000 })
  const { data: chart = [] } = useQuery<ChartRow[]>({ queryKey: ['chart-rev', months], queryFn: async () => (await api.get(`/api/v1/dashboard/charts/revenue-expense?months=${months}`)).data })
  const { data: expBreak = [] } = useQuery<ExpBreak[]>({ queryKey: ['chart-exp'], queryFn: async () => (await api.get('/api/v1/dashboard/charts/expense-breakdown')).data })
  const { data: alerts = [] } = useQuery<Alert[]>({ queryKey: ['alerts'], queryFn: async () => (await api.get('/api/v1/dashboard/alerts')).data, refetchInterval: 30000 })

  const totalExp = expBreak.reduce((s, e) => s + e.amount, 0)
  const topExp = [...expBreak].sort((a, b) => b.amount - a.amount).slice(0, 6)
  const maxExp = Math.max(1, ...topExp.map(e => e.amount))
  const avgRev = chart.length ? chart.reduce((s, r) => s + r.revenue, 0) / chart.length : 0
  const bestRev = Math.max(0, ...chart.map(r => r.revenue))
  const grossMargin = kpi && kpi.revenue.amount > 0 ? (kpi.gross_profit.amount / kpi.revenue.amount) * 100 : 0
  const expRatio = kpi && kpi.revenue.amount > 0 ? (kpi.expense.amount / kpi.revenue.amount) * 100 : 0
  const onTarget = grossMargin >= 20

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header — title · stat chips · range toggle ───── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: '0 0 3px', fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              สวัสดี, {user?.full_name?.split(' ')[0] ?? ''} 👋
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {kpi && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <HeroStat icon="💰" value={fmtB(kpi.revenue.amount)} label="รายได้เดือนนี้" pct={kpi.revenue.change_pct} accent />
              <HeroStat icon="◈" value={fmtB(kpi.gross_profit.amount)} label="กำไรขั้นต้น" />
              <HeroStat icon="🏦" value={fmtB(kpi.cash_balance.amount)} label="เงินสด/ธนาคาร" />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {alerts.length > 0 && <span className="pill" style={{ color: CORAL, borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>🔔 {alerts.length}</span>}
          <div className="seg">
            {[6, 12].map(m => <button key={m} data-active={months === m} onClick={() => setMonths(m)}>{m} เดือน</button>)}
          </div>
        </div>
      </div>

      {/* ── Row A — Revenue · Channel(expense) mix ───────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.9fr) minmax(0,1fr)', gap: 16 }}>
        {/* Revenue card */}
        <Card style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>รายได้ &amp; ค่าใช้จ่าย <span style={{ color: 'var(--color-dim)', fontWeight: 500 }}>· {months} เดือน · {chart.length} จุดข้อมูล</span></p>
            <button onClick={() => downloadCSV(chart)} disabled={!chart.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border-subtle)', borderRadius: 9, padding: '6px 12px', cursor: chart.length ? 'pointer' : 'not-allowed' }}>⤓ Export CSV</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', margin: '14px 0 2px' }}>
            <span style={{ fontSize: 36, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', lineHeight: 1 }}>{kpi ? fmtB(kpi.revenue.amount) : '—'}</span>
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>รายได้เดือนนี้</span>
            <ChangeBadge pct={kpi?.revenue.change_pct} big />
          </div>

          {/* mini stat boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, margin: '14px 0 6px' }}>
            {[
              { l: 'เดือนที่สูงสุด', v: fmtB(bestRev) },
              { l: 'เฉลี่ย/เดือน', v: fmtB(avgRev) },
              { l: 'กำไรขั้นต้น', v: kpi ? fmtB(kpi.gross_profit.amount) : '—' },
            ].map(b => (
              <div key={b.l} style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border-subtle)', borderRadius: 13, padding: '11px 13px' }}>
                <p style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{b.v}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--color-muted)' }}>{b.l}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, margin: '8px 0 2px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 999, background: CORAL }} /> รายได้</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 0, borderTop: `2px dashed ${SLATE}` }} /> ค่าใช้จ่าย</span>
          </div>

          {chart.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={chart} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="coralGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORAL_LT} stopOpacity={0.38} />
                    <stop offset="100%" stopColor={CORAL} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month_th" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} axisLine={false} tickLine={false} dy={6} />
                <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={38} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(232,146,111,0.55)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke={CORAL} strokeWidth={2.5} fill="url(#coralGrad)" dot={false} activeDot={{ r: 4.5, fill: CORAL, stroke: 'var(--color-card-solid)', strokeWidth: 2 }} />
                <Area type="monotone" dataKey="expense" stroke={SLATE} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 4.5, fill: SLATE, stroke: 'var(--color-card-solid)', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีข้อมูล — รัน seed เพื่อดูกราฟตัวอย่าง</div>
          )}
        </Card>

        {/* Channel mix → expense breakdown donut */}
        <Card>
          <SectionTitle>สัดส่วนค่าใช้จ่าย</SectionTitle>
          {expBreak.length > 0 ? (
            <>
              <div style={{ position: 'relative', height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={topExp} dataKey="amount" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
                      {topExp.map((_, i) => <Cell key={i} fill={MIX[i % MIX.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{fmtB(totalExp)}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--color-muted)' }}>รวมค่าใช้จ่าย</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {topExp.map((e, i) => (
                  <div key={e.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        <i style={{ width: 8, height: 8, borderRadius: 2, background: MIX[i % MIX.length], flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{fmtB(e.amount)}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: 'var(--color-bg-inset)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${totalExp > 0 ? (e.amount / totalExp) * 100 : 0}%`, background: MIX[i % MIX.length], borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-dim)', fontSize: 12 }}>ยังไม่มีข้อมูลค่าใช้จ่าย</div>
          )}
        </Card>
      </div>

      {/* ── Row B — monthly heatmap · financial-ratio ────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.9fr) minmax(0,1fr)', gap: 16 }}>
        <Card>
          <SectionTitle>ความเข้มรายเดือน</SectionTitle>
          {chart.length > 0 ? <Heatmap rows={chart} /> : <div style={{ height: 150, display: 'grid', placeItems: 'center', color: 'var(--color-dim)', fontSize: 12 }}>ยังไม่มีข้อมูล</div>}
        </Card>

        {/* Prime-cost-style ratio card */}
        <Card>
          <SectionTitle action={<span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: onTarget ? GREEN : CORAL, background: `color-mix(in srgb, ${onTarget ? GREEN : CORAL} 15%, transparent)` }}>{onTarget ? 'ถึงเป้า' : 'ต่ำกว่าเป้า'}</span>}>อัตรากำไรขั้นต้น</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 40, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', lineHeight: 1, color: onTarget ? GREEN : 'var(--color-text)' }}>{grossMargin.toFixed(1)}%</span>
            <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>ของรายได้</span>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 14 }}>
            <span><b style={{ color: SLATE }}>{expRatio.toFixed(1)}%</b> ค่าใช้จ่าย</span>
            <span><b style={{ color: onTarget ? GREEN : CORAL }}>{grossMargin.toFixed(1)}%</b> กำไร</span>
          </div>
          {chart.length > 0 && (
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <YAxis hide domain={['auto', 'auto']} />
                <XAxis dataKey="month_th" tick={{ fill: 'var(--color-muted)', fontSize: 9 }} axisLine={false} tickLine={false} dy={4} interval="preserveStartEnd" />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(91,201,140,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="profit" stroke={GREEN} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: GREEN }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── Row C — top expense categories · to-do ───────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
        <Card>
          <SectionTitle>ค่าใช้จ่ายสูงสุดตามหมวด</SectionTitle>
          {topExp.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {topExp.map((e, i) => (
                <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: MIX[i % MIX.length], background: `color-mix(in srgb, ${MIX[i % MIX.length]} 16%, transparent)` }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>{fmtB(e.amount)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--color-bg-inset)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(e.amount / maxExp) * 100}%`, borderRadius: 999, background: `linear-gradient(90deg, ${MIX[i % MIX.length]}, color-mix(in srgb, ${MIX[i % MIX.length]} 55%, white))`, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ height: 150, display: 'grid', placeItems: 'center', color: 'var(--color-dim)', fontSize: 12 }}>ยังไม่มีข้อมูล</div>
          )}
        </Card>

        <Card>
          <SectionTitle>รายการที่ต้องทำ</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {kpi && (
              <>
                <a href="/ap" style={listRow}>
                  <span style={{ fontSize: 18 }}>📋</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-secondary)' }}>Bills รออนุมัติ</span>
                  <span style={{ ...countPill, color: kpi.pending_approvals > 0 ? CORAL : 'var(--color-dim)' }}>{kpi.pending_approvals}</span>
                </a>
                <a href="/ar" style={listRow}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-secondary)' }}>Invoice เกินกำหนด</span>
                  <span style={{ ...countPill, color: kpi.overdue_invoices > 0 ? RED : 'var(--color-dim)' }}>{kpi.overdue_invoices}</span>
                </a>
              </>
            )}
            {alerts.map((a, i) => (
              <div key={i} style={{ ...listRow, cursor: 'default' }}>
                <span style={{ fontSize: 18 }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{a.title}</p>
                  <p style={{ margin: 0, fontSize: 10, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</p>
                </div>
              </div>
            ))}
            {kpi && alerts.length === 0 && kpi.pending_approvals === 0 && kpi.overdue_invoices === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-dim)', textAlign: 'center', padding: '20px 0' }}>ไม่มีรายการค้าง 🎉</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

// Monthly intensity heatmap — real data: rows = metrics, cols = months.
function Heatmap({ rows }: { rows: ChartRow[] }) {
  const metrics: { key: keyof ChartRow; label: string; color: string }[] = [
    { key: 'revenue', label: 'รายได้', color: CORAL },
    { key: 'expense', label: 'ค่าใช้จ่าย', color: SLATE },
    { key: 'profit', label: 'กำไร', color: GREEN },
  ]
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 420 }}>
        {metrics.map(m => {
          const vals = rows.map(r => Math.abs(Number(r[m.key]) || 0))
          const max = Math.max(1, ...vals)
          return (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 66, flexShrink: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{m.label}</span>
              <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                {rows.map((r, i) => {
                  const v = Math.abs(Number(r[m.key]) || 0)
                  const intensity = 0.12 + 0.88 * (v / max)
                  return (
                    <div key={i} title={`${r.month_th}: ${fmtB(Number(r[m.key]) || 0)}`} style={{
                      flex: 1, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center',
                      background: `color-mix(in srgb, ${m.color} ${Math.round(intensity * 100)}%, transparent)`,
                      border: '1px solid var(--color-border-subtle)',
                    }} />
                  )
                })}
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ width: 66, flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 6, flex: 1 }}>
            {rows.map((r, i) => <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: 'var(--color-muted)' }}>{r.month_th}</span>)}
          </div>
        </div>
      </div>
    </div>
  )
}

const listRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
  background: 'var(--color-bg-inset)', border: '1px solid var(--color-border-subtle)',
  borderRadius: 12, padding: '11px 13px', color: 'inherit',
}
const countPill: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)', minWidth: 24, textAlign: 'right',
}
