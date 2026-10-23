import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Entry { employee_name: string; leave_type_name: string; start_date: string; end_date: string; days_requested: number }

export default function TeamCalendarPage() {
  const now = new Date()
  const [monthStart] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0])
  const [monthEnd] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0])
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(monthEnd)

  const { data, isLoading } = useQuery<{ entries: Entry[] }>({
    queryKey: ['team-calendar', dateFrom, dateTo],
    queryFn: async () => (await api.get(`/api/v1/leave/calendar?period_from=${dateFrom}&period_to=${dateTo}`)).data,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ปฏิทินทีม</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>ใครลาวันไหนบ้าง (เฉพาะที่อนุมัติแล้ว)</p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--color-text)' }} />
        <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>ถึง</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--color-text)' }} />
      </div>

      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <p style={{ padding: 40, color: 'var(--color-dim)' }}>กำลังโหลด...</p>
        : !data?.entries.length ? (
          <div style={{ padding: 52, textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 8 }}>📅</p>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>ไม่มีใครลาในช่วงนี้</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['พนักงาน', 'ประเภทการลา', 'ช่วงวันที่', 'จำนวนวัน'].map(h => <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={i}>
                  <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontWeight: 600 }}>{e.employee_name}</td>
                  <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12 }}>
                    <span style={{ background: '#FFB59E15', color: 'var(--color-accent-light)', padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{e.leave_type_name}</span>
                  </td>
                  <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{e.start_date} — {e.end_date}</td>
                  <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#F2714E' }}>{e.days_requested} วัน</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
