import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────
interface LineItem { account_code: string; account_name: string; amount?: number; balance?: number }
interface Section { label: string; items: LineItem[]; total: number }
interface PL { period_from: string; period_to: string; revenue: Section; cogs: Section; gross_profit: number; expenses: Section; net_profit: number }
interface BS { as_of_date: string; current_assets: Section; non_current_assets: Section; total_assets: number; current_liabilities: Section; non_current_liabilities: Section; total_liabilities: number; equity: Section; total_liab_equity: number; is_balanced: boolean }
interface CF { period_from: string; period_to: string; operating: { label: string; amount: number }[]; operating_total: number; investing: { label: string; amount: number }[]; investing_total: number; financing: { label: string; amount: number }[]; financing_total: number; net_change: number; beginning_cash: number; ending_cash: number }
interface Ratios { current_ratio?: number; quick_ratio?: number; gross_margin_pct?: number; net_margin_pct?: number; debt_to_equity?: number; return_on_equity?: number; explanation: string }

const fmt = (n: number) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })
const fmtB = (n: number) => `฿${fmt(n)}`

function SectionTable({ section, valueKey = 'amount' }: { section: Section; valueKey?: 'amount' | 'balance' }) {
  return (
    <div style={{ marginBottom: 4 }}>
      {section.items.length === 0 ? (
        <p style={{ margin: '6px 0', fontSize: 11, color: '#3A4A60', fontStyle: 'italic' }}>ไม่มีรายการ</p>
      ) : section.items.map(item => (
        <div key={item.account_code} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
          <span style={{ color: '#8A9BB0' }}><span style={{ color: '#3A4A60', fontFamily: 'monospace', marginRight: 8 }}>{item.account_code}</span>{item.account_name}</span>
          <span style={{ fontFamily: 'monospace', color: '#DDE3EE' }}>{fmtB((item as any)[valueKey] || 0)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #1E2A3A', marginTop: 4, fontSize: 12, fontWeight: 700 }}>
        <span>รวม{section.label}</span>
        <span style={{ fontFamily: 'monospace', color: '#00D4AA' }}>{fmtB(section.total)}</span>
      </div>
    </div>
  )
}

export default function FinancialStatementsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'pl' | 'bs' | 'cf' | 'ratio' | 'close'>('pl')
  const today = new Date().toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [asOf, setAsOf] = useState(today)
  const [showInsight, setShowInsight] = useState(false)
  const [closeMonth, setCloseMonth] = useState(new Date().getMonth() + 1)
  const [closeYear, setCloseYear] = useState(new Date().getFullYear())

  const { data: pl } = useQuery<PL>({
    queryKey: ['pl', dateFrom, dateTo], enabled: tab === 'pl',
    queryFn: async () => (await api.get(`/api/v1/reports/profit-loss?period_from=${dateFrom}&period_to=${dateTo}`)).data,
  })
  const { data: bs } = useQuery<BS>({
    queryKey: ['bs', asOf], enabled: tab === 'bs',
    queryFn: async () => (await api.get(`/api/v1/reports/balance-sheet?as_of_date=${asOf}`)).data,
  })
  const { data: cf } = useQuery<CF>({
    queryKey: ['cf', dateFrom, dateTo], enabled: tab === 'cf',
    queryFn: async () => (await api.get(`/api/v1/reports/cash-flow?period_from=${dateFrom}&period_to=${dateTo}`)).data,
  })
  const { data: ratios } = useQuery<Ratios>({
    queryKey: ['ratios', asOf], enabled: tab === 'ratio',
    queryFn: async () => (await api.get(`/api/v1/reports/ratios?as_of_date=${asOf}`)).data,
  })
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods'], enabled: tab === 'close',
    queryFn: async () => (await api.get('/api/v1/reports/periods')).data,
  })
  const { data: insight } = useQuery({
    queryKey: ['insight', dateFrom, dateTo], enabled: showInsight,
    queryFn: async () => (await api.get(`/api/v1/reports/ai/insight?period_from=${dateFrom}&period_to=${dateTo}`)).data,
  })

  const closeM = useMutation({
    mutationFn: () => api.post('/api/v1/reports/periods/close', { period_month: closeMonth, period_year: closeYear }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['periods'] }),
  })

  const TABS = [
    { id: 'pl', label: 'งบกำไรขาดทุน' }, { id: 'bs', label: 'งบดุล' },
    { id: 'cf', label: 'งบกระแสเงินสด' }, { id: 'ratio', label: 'อัตราส่วนการเงิน' }, { id: 'close', label: 'ปิดบัญชี' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>งบการเงิน</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>Financial Statements</p>
        </div>
        {['pl', 'cf'].includes(tab) && (
          <button onClick={() => setShowInsight(true)} style={{ background: '#00D4AA15', border: '1px solid #00D4AA40', color: '#00D4AA', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
            🤖 AI วิเคราะห์งบการเงิน
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 3, background: '#0D1018', borderRadius: 9, padding: 3, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ background: tab === t.id ? '#00D4AA' : 'transparent', color: tab === t.id ? '#07090E' : '#5A6A80', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date controls */}
      {tab !== 'close' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {['pl', 'cf'].includes(tab) ? (
            <>
              <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>จาก</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>
              <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>ถึง</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>
            </>
          ) : (
            <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>ณ วันที่</label><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>
          )}
        </div>
      )}

      {/* ── P&L TAB ── */}
      {tab === 'pl' && pl && (
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '24px 28px', maxWidth: 560 }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, textAlign: 'center' }}>งบกำไรขาดทุน</p>
          <p style={{ margin: '0 0 20px', fontSize: 11, color: '#4A5A70', textAlign: 'center' }}>{pl.period_from} ถึง {pl.period_to}</p>
          <SectionTable section={pl.revenue} />
          <SectionTable section={pl.cogs} />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #00D4AA30', marginTop: 8, fontSize: 13, fontWeight: 800 }}>
            <span>กำไรขั้นต้น</span><span style={{ fontFamily: 'monospace', color: pl.gross_profit >= 0 ? '#43E97B' : '#FF6B6B' }}>{fmtB(pl.gross_profit)}</span>
          </div>
          <div style={{ marginTop: 12 }}><SectionTable section={pl.expenses} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: pl.net_profit >= 0 ? '#43E97B10' : '#FF6B6B10', border: `1px solid ${pl.net_profit >= 0 ? '#43E97B30' : '#FF6B6B30'}`, borderRadius: 10, marginTop: 12, fontSize: 15, fontWeight: 800 }}>
            <span>กำไร(ขาดทุน)สุทธิ</span><span style={{ fontFamily: 'monospace', color: pl.net_profit >= 0 ? '#43E97B' : '#FF6B6B' }}>{fmtB(pl.net_profit)}</span>
          </div>
        </div>
      )}

      {/* ── BALANCE SHEET TAB ── */}
      {tab === 'bs' && bs && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 900 }}>
          <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '24px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: '#4FACFE' }}>สินทรัพย์</p>
            <p style={{ margin: '0 0 16px', fontSize: 10, color: '#4A5A70' }}>ณ วันที่ {bs.as_of_date}</p>
            <SectionTable section={bs.current_assets} valueKey="balance" />
            <div style={{ marginTop: 10 }}><SectionTable section={bs.non_current_assets} valueKey="balance" /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid #4FACFE30', marginTop: 8, fontSize: 14, fontWeight: 800 }}>
              <span>รวมสินทรัพย์</span><span style={{ fontFamily: 'monospace', color: '#4FACFE' }}>{fmtB(bs.total_assets)}</span>
            </div>
          </div>
          <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '24px' }}>
            <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 800, color: '#F093FB' }}>หนี้สินและส่วนของผู้ถือหุ้น</p>
            <SectionTable section={bs.current_liabilities} valueKey="balance" />
            <div style={{ marginTop: 10 }}><SectionTable section={bs.non_current_liabilities} valueKey="balance" /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, fontWeight: 700, color: '#F093FB' }}>
              <span>รวมหนี้สิน</span><span style={{ fontFamily: 'monospace' }}>{fmtB(bs.total_liabilities)}</span>
            </div>
            <div style={{ marginTop: 14 }}><SectionTable section={bs.equity} valueKey="balance" /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid #F093FB30', marginTop: 8, fontSize: 14, fontWeight: 800 }}>
              <span>รวมหนี้สิน+ทุน</span><span style={{ fontFamily: 'monospace', color: '#F093FB' }}>{fmtB(bs.total_liab_equity)}</span>
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1', background: bs.is_balanced ? '#43E97B10' : '#FF6B6B10', border: `1px solid ${bs.is_balanced ? '#43E97B30' : '#FF6B6B30'}`, borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: bs.is_balanced ? '#43E97B' : '#FF6B6B' }}>
              {bs.is_balanced ? '✓ งบดุลสมดุล (สินทรัพย์ = หนี้สิน + ทุน)' : '⚠ งบดุลไม่สมดุล — กรุณาตรวจสอบรายการบัญชี'}
            </p>
          </div>
        </div>
      )}

      {/* ── CASH FLOW TAB ── */}
      {tab === 'cf' && cf && (
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '24px 28px', maxWidth: 560 }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, textAlign: 'center' }}>งบกระแสเงินสด</p>
          <p style={{ margin: '0 0 20px', fontSize: 11, color: '#4A5A70', textAlign: 'center' }}>{cf.period_from} ถึง {cf.period_to}</p>
          {[
            { label: 'กิจกรรมดำเนินงาน', items: cf.operating, total: cf.operating_total, color: '#43E97B' },
            { label: 'กิจกรรมลงทุน', items: cf.investing, total: cf.investing_total, color: '#4FACFE' },
            { label: 'กิจกรรมจัดหาเงิน', items: cf.financing, total: cf.financing_total, color: '#F5A623' },
          ].map(section => (
            <div key={section.label} style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: section.color, textTransform: 'uppercase' }}>{section.label}</p>
              {section.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: '#8A9BB0' }}>{item.label}</span>
                  <span style={{ fontFamily: 'monospace', color: item.amount >= 0 ? '#43E97B' : '#FF6B6B' }}>{item.amount >= 0 ? '+' : ''}{fmtB(item.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #151C28', marginTop: 4, fontSize: 12, fontWeight: 700 }}>
                <span>รวม{section.label}</span><span style={{ fontFamily: 'monospace', color: section.color }}>{fmtB(section.total)}</span>
              </div>
            </div>
          ))}
          <div style={{ background: '#00D4AA10', border: '1px solid #00D4AA30', borderRadius: 10, padding: '14px 16px' }}>
            {[['เงินสดต้นงวด', cf.beginning_cash], ['เปลี่ยนแปลงสุทธิ', cf.net_change], ['เงินสดปลายงวด', cf.ending_cash]].map(([l, v], i) => (
              <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: i === 2 ? 14 : 12, fontWeight: i === 2 ? 800 : 600 }}>
                <span>{l}</span><span style={{ fontFamily: 'monospace', color: '#00D4AA' }}>{fmtB(v as number)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── RATIOS TAB ── */}
      {tab === 'ratio' && ratios && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14, maxWidth: 800 }}>
          {[
            { l: 'Current Ratio', v: ratios.current_ratio, suffix: '', good: (n: number) => n >= 1.5, desc: 'สภาพคล่องระยะสั้น' },
            { l: 'Quick Ratio', v: ratios.quick_ratio, suffix: '', good: (n: number) => n >= 1, desc: 'สภาพคล่องเร็ว' },
            { l: 'Gross Margin', v: ratios.gross_margin_pct, suffix: '%', good: (n: number) => n >= 20, desc: 'อัตรากำไรขั้นต้น' },
            { l: 'Net Margin', v: ratios.net_margin_pct, suffix: '%', good: (n: number) => n >= 10, desc: 'อัตรากำไรสุทธิ' },
            { l: 'Debt to Equity', v: ratios.debt_to_equity, suffix: '', good: (n: number) => n <= 1.5, desc: 'หนี้สินต่อทุน' },
            { l: 'ROE', v: ratios.return_on_equity, suffix: '%', good: (n: number) => n >= 10, desc: 'ผลตอบแทนต่อทุน' },
          ].map(r => {
            const val = r.v
            const isGood = val != null ? r.good(val) : null
            return (
              <div key={r.l} style={{ background: '#0D1018', border: `1px solid ${isGood === true ? '#43E97B30' : isGood === false ? '#FF6B6B30' : '#151C28'}`, borderRadius: 12, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: '#4A5A70' }}>{r.l}</p>
                <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: isGood === true ? '#43E97B' : isGood === false ? '#FF6B6B' : '#DDE3EE' }}>
                  {val != null ? `${val.toFixed(2)}${r.suffix}` : '—'}
                </p>
                <p style={{ margin: 0, fontSize: 10, color: '#3A4A60' }}>{r.desc}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* ── PERIOD CLOSE TAB ── */}
      {tab === 'close' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
          <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px 24px' }}>
            <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>ปิดบัญชีประจำงวด</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#4A5A70', marginBottom: 6 }}>เดือน</label>
                <select value={closeMonth} onChange={e => setCloseMonth(Number(e.target.value))} style={{ background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DDE3EE', cursor: 'pointer' }}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#4A5A70', marginBottom: 6 }}>ปี</label>
                <input type="number" value={closeYear} onChange={e => setCloseYear(Number(e.target.value))} style={{ background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DDE3EE', width: 90 }} />
              </div>
              <button onClick={() => closeM.mutate()} disabled={closeM.isPending}
                style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer', opacity: closeM.isPending ? 0.7 : 1 }}>
                {closeM.isPending ? 'กำลังปิดงวด...' : '🔒 ปิดงวดบัญชี'}
              </button>
            </div>
            {closeM.isError && <p style={{ margin: '10px 0 0', fontSize: 11, color: '#FF6B6B' }}>⚠ ไม่สามารถปิดงวดได้ — มี Journal ที่ยัง Draft อยู่ หรืองวดนี้ถูกปิดแล้ว</p>}
            {closeM.isSuccess && <p style={{ margin: '10px 0 0', fontSize: 11, color: '#43E97B' }}>✓ ปิดงวดสำเร็จ</p>}
          </div>

          <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['งวด', 'วันเริ่ม', 'วันสิ้นสุด', 'สถานะ', 'วันที่ปิด'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28' }}>{h}</th>)}</tr></thead>
              <tbody>
                {periods.length === 0 ? <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>ยังไม่มีงวดที่ปิด</td></tr>
                : periods.map((p: any) => (
                  <tr key={p.id}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, fontWeight: 600 }}>{p.period_month}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{p.start_date}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{p.end_date}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: p.status === 'closed' ? '#43E97B' : '#F5A623', background: p.status === 'closed' ? '#43E97B18' : '#F5A62318', padding: '2px 8px', borderRadius: 10 }}>
                        {p.status === 'closed' ? '🔒 ปิดแล้ว' : 'เปิดอยู่'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{p.closed_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI INSIGHT MODAL */}
      {showInsight && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setShowInsight(false)}>
          <div style={{ background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ fontSize: 20 }}>🤖</span><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI วิเคราะห์งบการเงิน</h3></div>
              <button onClick={() => setShowInsight(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              {!insight ? <div style={{ textAlign: 'center', padding: 40, color: '#3A4A60' }}>กำลังวิเคราะห์...</div> : (
                <>
                  <div style={{ background: '#00D4AA08', border: '1px solid #00D4AA25', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#DDE3EE', lineHeight: 1.6 }}>{insight.summary}</p>
                  </div>
                  {insight.key_observations?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#4FACFE', textTransform: 'uppercase' }}>ข้อสังเกต</p>
                      {insight.key_observations.map((o: string, i: number) => <p key={i} style={{ margin: '4px 0', fontSize: 12, color: '#8A9BB0' }}>• {o}</p>)}
                    </div>
                  )}
                  {insight.risks?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#FF6B6B', textTransform: 'uppercase' }}>ความเสี่ยง</p>
                      {insight.risks.map((r: string, i: number) => <p key={i} style={{ margin: '4px 0', fontSize: 12, color: '#8A9BB0' }}>⚠ {r}</p>)}
                    </div>
                  )}
                  {insight.recommendations?.length > 0 && (
                    <div>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#43E97B', textTransform: 'uppercase' }}>คำแนะนำ</p>
                      {insight.recommendations.map((r: string, i: number) => <p key={i} style={{ margin: '4px 0', fontSize: 12, color: '#8A9BB0' }}>✓ {r}</p>)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
