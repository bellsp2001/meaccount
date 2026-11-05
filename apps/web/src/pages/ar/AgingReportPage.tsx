import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface AgingBucket { count: number; total: number; items: { number: string; customer: string; due_date: string; balance_due: number }[] }
interface AgingReport { as_of: string; current: AgingBucket; '1_30': AgingBucket; '31_60': AgingBucket; '61_90': AgingBucket; over_90: AgingBucket; grand_total: number }

const BUCKETS: { key: keyof AgingReport; label: string; color: string; desc: string }[] = [
  { key: 'current', label: 'ยังไม่ถึงกำหนด', color: '#43E97B', desc: 'Not yet due' },
  { key: '1_30',    label: '1–30 วัน',        color: '#F5A623', desc: 'Overdue 1-30 days' },
  { key: '31_60',   label: '31–60 วัน',       color: '#F093FB', desc: 'Overdue 31-60 days' },
  { key: '61_90',   label: '61–90 วัน',       color: '#FF6B6B', desc: 'Overdue 61-90 days' },
  { key: 'over_90', label: 'เกิน 90 วัน',     color: '#CC2222', desc: 'Overdue >90 days (Bad debt risk)' },
]

export default function AgingReportPage() {
  const { data, isLoading } = useQuery<AgingReport>({
    queryKey: ['aging'],
    queryFn: async () => (await api.get('/api/v1/ar/reports/aging')).data,
  })

  const grandTotal = data?.grand_total || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>รายงานอายุหนี้</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>
          Aging Report — ณ วันที่ {data?.as_of ? new Date(data.as_of).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
      ) : !data ? null : (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
            {BUCKETS.map(b => {
              const bucket = data[b.key] as AgingBucket
              const pct = grandTotal > 0 ? (bucket.total / grandTotal) * 100 : 0
              return (
                <div key={b.key} style={{ background: '#0D1018', border: `1px solid ${b.color}25`, borderTop: `3px solid ${b.color}`, borderRadius: 12, padding: '16px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70', fontWeight: 600 }}>{b.label}</p>
                  <p style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: b.color }}>
                    ฿{Number(bucket.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </p>
                  <div style={{ height: 4, background: '#151C28', borderRadius: 99 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: b.color, borderRadius: 99, transition: 'width 0.6s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: '#4A5A70' }}>{bucket.count} ราย</span>
                    <span style={{ fontSize: 10, color: b.color, fontWeight: 700 }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              )
            })}
            {/* Grand total */}
            <div style={{ background: '#00D4AA10', border: '1px solid #00D4AA30', borderTop: '3px solid #00D4AA', borderRadius: 12, padding: '16px' }}>
              <p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70', fontWeight: 600 }}>รวมทั้งหมด</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#00D4AA' }}>
                ฿{Number(grandTotal).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Stacked bar */}
          {grandTotal > 0 && (
            <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px 24px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: '#4A5A70', textTransform: 'uppercase', letterSpacing: '0.1em' }}>สัดส่วนอายุหนี้</p>
              <div style={{ display: 'flex', height: 20, borderRadius: 10, overflow: 'hidden', gap: 2 }}>
                {BUCKETS.map(b => {
                  const bucket = data[b.key] as AgingBucket
                  const pct = (bucket.total / grandTotal) * 100
                  return pct > 0 ? (
                    <div key={b.key} style={{ flex: pct, background: b.color, minWidth: 2, transition: 'flex 0.6s' }} title={`${b.label}: ฿${Number(bucket.total).toLocaleString('th-TH')}`} />
                  ) : null
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                {BUCKETS.map(b => (
                  <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: '#6A7A90' }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detail tables per bucket */}
          {BUCKETS.map(b => {
            const bucket = data[b.key] as AgingBucket
            if (!bucket.items?.length) return null
            return (
              <div key={b.key} style={{ background: '#0D1018', border: `1px solid ${b.color}25`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: b.color }}>{b.label}</span>
                    <span style={{ fontSize: 11, color: '#4A5A70' }}>{bucket.count} ราย</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: b.color, fontFamily: 'monospace' }}>
                    ฿{Number(bucket.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['เลขที่ Invoice', 'ลูกค้า', 'ครบกำหนด', 'ยอดค้างชำระ'].map(h => (
                        <th key={h} style={{ padding: '8px 16px', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #0F1520', textAlign: h === 'ยอดค้างชำระ' ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.items.map((item, i) => (
                      <tr key={i}>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid #0A0E16', fontFamily: 'monospace', fontSize: 12, color: '#4FACFE' }}>{item.number}</td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid #0A0E16', fontSize: 12 }}>{item.customer}</td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid #0A0E16', fontSize: 11, color: '#6A7A90' }}>{new Date(item.due_date).toLocaleDateString('th-TH')}</td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid #0A0E16', textAlign: 'right', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: b.color }}>
                          ฿{Number(item.balance_due).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}

          {grandTotal === 0 && (
            <div style={{ padding: 56, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>
              <p style={{ fontSize: 40, marginBottom: 12 }}>✅</p>
              ไม่มียอดค้างชำระ — ลูกหนี้ทั้งหมดชำระครบแล้ว
            </div>
          )}
        </>
      )}
    </div>
  )
}
