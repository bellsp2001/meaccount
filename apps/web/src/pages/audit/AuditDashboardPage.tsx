import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Anomaly { severity: string; category: string; title: string; description: string; resource_type: string; reference?: string; amount?: number; date?: string; risk_score: number }
interface AnomalyScan { scan_date: string; period_from: string; period_to: string; total_scanned: number; anomalies_found: number; high_risk_count: number; medium_risk_count: number; low_risk_count: number; anomalies: Anomaly[] }
interface CheckItem { check_name: string; passed: boolean; detail: string; severity: string }
interface BalanceCheck { as_of_date: string; all_passed: boolean; checks: CheckItem[] }
interface DupGroup { resource_type: string; match_reason: string; items: any[]; confidence: number }
interface DupScan { total_found: number; groups: DupGroup[] }
interface AuditLog { id: string; user_email?: string; action: string; resource: string; resource_id?: string; ip_address?: string; created_at: string }

const SEVERITY_COLOR: Record<string, string> = { high: '#FF6B6B', medium: '#F5A623', low: '#4FACFE', info: '#43E97B' }
const CATEGORY_LABEL: Record<string, string> = { duplicate: 'รายการซ้ำ', unusual_amount: 'จำนวนผิดปกติ', round_number: 'เลขกลม', weekend_posting: 'ลงบัญชีวันหยุด', unbalanced: 'ไม่สมดุล' }

export default function AuditDashboardPage() {
  const [tab, setTab] = useState<'anomaly' | 'balance' | 'duplicate' | 'log'>('anomaly')
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const today = now.toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [asOf, setAsOf] = useState(today)

  const { data: anomalyScan, isLoading: loadingAnomaly } = useQuery<AnomalyScan>({
    queryKey: ['anomalies', dateFrom, dateTo], enabled: tab === 'anomaly',
    queryFn: async () => (await api.get(`/api/v1/audit/ai/anomalies?period_from=${dateFrom}&period_to=${dateTo}`)).data,
  })
  const { data: balanceCheck, isLoading: loadingBalance } = useQuery<BalanceCheck>({
    queryKey: ['balance-check', asOf], enabled: tab === 'balance',
    queryFn: async () => (await api.get(`/api/v1/audit/balance-check?as_of_date=${asOf}`)).data,
  })
  const { data: dupScan, isLoading: loadingDup } = useQuery<DupScan>({
    queryKey: ['duplicates'], enabled: tab === 'duplicate',
    queryFn: async () => (await api.get('/api/v1/audit/ai/duplicates')).data,
  })
  const { data: logs = [], isLoading: loadingLogs } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs'], enabled: tab === 'log',
    queryFn: async () => (await api.get('/api/v1/audit/logs?limit=100')).data,
  })

  const TABS = [
    { id: 'anomaly', label: '🔍 Anomaly Detection' }, { id: 'balance', label: '⚖ Balance Check' },
    { id: 'duplicate', label: '🔁 Duplicate Detection' }, { id: 'log', label: '📋 Audit Log' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>AI Audit & Compliance</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ตรวจสอบและป้องกันการทุจริต</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 3, background: '#0D1018', borderRadius: 9, padding: 3, width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ background: tab === t.id ? '#FF6B6B' : 'transparent', color: tab === t.id ? '#07090E' : '#5A6A80', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ANOMALY TAB ── */}
      {tab === 'anomaly' && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>จาก</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>
            <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>ถึง</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>
          </div>

          {loadingAnomaly ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังสแกน...</div>
          : anomalyScan && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
                {[
                  { l: 'สแกนแล้ว', v: anomalyScan.total_scanned, color: '#4FACFE' },
                  { l: 'พบผิดปกติ', v: anomalyScan.anomalies_found, color: '#F093FB' },
                  { l: 'ความเสี่ยงสูง', v: anomalyScan.high_risk_count, color: '#FF6B6B' },
                  { l: 'ความเสี่ยงปานกลาง', v: anomalyScan.medium_risk_count, color: '#F5A623' },
                  { l: 'ความเสี่ยงต่ำ', v: anomalyScan.low_risk_count, color: '#4FACFE' },
                ].map(s => (
                  <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '12px 14px' }}>
                    <p style={{ margin: '0 0 3px', fontSize: 9, color: '#4A5A70' }}>{s.l}</p>
                    <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.v}</p>
                  </div>
                ))}
              </div>

              {anomalyScan.anomalies.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', background: '#43E97B08', border: '1px solid #43E97B25', borderRadius: 14 }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>✅</p>
                  <p style={{ color: '#43E97B', fontSize: 13, fontWeight: 700 }}>ไม่พบรายการผิดปกติในช่วงเวลานี้</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {anomalyScan.anomalies.map((a, i) => (
                    <div key={i} style={{ background: '#0D1018', border: `1px solid ${SEVERITY_COLOR[a.severity]}30`, borderLeft: `3px solid ${SEVERITY_COLOR[a.severity]}`, borderRadius: 12, padding: '14px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: SEVERITY_COLOR[a.severity], background: SEVERITY_COLOR[a.severity] + '18', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{a.severity}</span>
                          <span style={{ fontSize: 10, color: '#4A5A70', background: '#151C28', padding: '2px 8px', borderRadius: 10 }}>{CATEGORY_LABEL[a.category] || a.category}</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: SEVERITY_COLOR[a.severity] }}>Risk: {a.risk_score.toFixed(0)}</span>
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>{a.title}</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#8A9BB0', lineHeight: 1.6 }}>{a.description}</p>
                      {a.reference && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#4FACFE', fontFamily: 'monospace' }}>อ้างอิง: {a.reference}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── BALANCE CHECK TAB ── */}
      {tab === 'balance' && (
        <>
          <div><label style={{ fontSize: 10, color: '#4A5A70', marginRight: 6 }}>ณ วันที่</label><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#DDE3EE' }} /></div>

          {loadingBalance ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังตรวจสอบ...</div>
          : balanceCheck && (
            <>
              <div style={{ background: balanceCheck.all_passed ? '#43E97B10' : '#FF6B6B10', border: `1px solid ${balanceCheck.all_passed ? '#43E97B30' : '#FF6B6B30'}`, borderRadius: 14, padding: '20px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 32, marginBottom: 8 }}>{balanceCheck.all_passed ? '✅' : '⚠️'}</p>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: balanceCheck.all_passed ? '#43E97B' : '#FF6B6B' }}>
                  {balanceCheck.all_passed ? 'ทุกการตรวจสอบผ่าน' : 'พบปัญหาที่ต้องแก้ไข'}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {balanceCheck.checks.map((c, i) => (
                  <div key={i} style={{ background: '#0D1018', border: `1px solid ${c.passed ? '#43E97B25' : SEVERITY_COLOR[c.severity] + '30'}`, borderRadius: 12, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 18 }}>{c.passed ? '✓' : '✗'}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: c.passed ? '#43E97B' : '#FF6B6B' }}>{c.check_name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#8A9BB0' }}>{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── DUPLICATE TAB ── */}
      {tab === 'duplicate' && (
        loadingDup ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังสแกน...</div>
        : dupScan && (
          dupScan.groups.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', background: '#43E97B08', border: '1px solid #43E97B25', borderRadius: 14 }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>✅</p>
              <p style={{ color: '#43E97B', fontSize: 13, fontWeight: 700 }}>ไม่พบรายการซ้ำ</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {dupScan.groups.map((g, i) => (
                <div key={i} style={{ background: '#0D1018', border: '1px solid #FF6B6B30', borderLeft: '3px solid #FF6B6B', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#FF6B6B', textTransform: 'uppercase' }}>{g.resource_type === 'invoice' ? '📄 Invoice ซ้ำ' : '📋 Bill ซ้ำ'}</span>
                    <span style={{ fontSize: 10, color: '#4A5A70' }}>Confidence: {Math.round(g.confidence * 100)}%</span>
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: '#8A9BB0' }}>{g.match_reason}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {g.items.map((item: any, j: number) => (
                      <div key={j} style={{ display: 'flex', justifyContent: 'space-between', background: '#070A0F', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                        <span style={{ fontFamily: 'monospace', color: '#4FACFE' }}>{item.number}</span>
                        <span style={{ color: '#6A7A90' }}>{item.date}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>฿{Number(item.total).toLocaleString('th-TH')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )
      )}

      {/* ── AUDIT LOG TAB ── */}
      {tab === 'log' && (
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
          {loadingLogs ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
          : logs.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>ยังไม่มี Log</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['เวลา', 'ผู้ใช้', 'Action', 'Resource', 'IP Address'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', borderBottom: '1px solid #151C28' }}>{h}</th>)}</tr></thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{new Date(log.created_at).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 12 }}>{log.user_email || '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#4FACFE', background: '#4FACFE15', padding: '2px 8px', borderRadius: 10 }}>{log.action}</span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#8A9BB0' }}>{log.resource}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#4A5A70', fontFamily: 'monospace' }}>{log.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
