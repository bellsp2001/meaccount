import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Company { id: string; code: string; name: string }
interface ConsolidatedPL {
  companies_included: string[]; consolidated_revenue: number; consolidated_expense: number
  consolidated_net_profit: number; eliminations: number
  per_company: { company: string; revenue: number; expense: number; net_profit: number }[]
}

const fmtB = (n: number) => `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`

export default function ConsolidatedPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/api/v1/companies/')).data,
  })

  const { data: consolidated, isLoading, refetch } = useQuery<ConsolidatedPL>({
    queryKey: ['consolidated-pl', selectedIds, dateFrom, dateTo],
    enabled: selectedIds.length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams()
      selectedIds.forEach(id => params.append('company_ids', id))
      params.append('period_from', dateFrom)
      params.append('period_to', dateTo)
      return (await api.get(`/api/v1/companies/consolidated/profit-loss?${params}`)).data
    },
  })

  function toggle(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>งบการเงินรวม</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Consolidated Financial Statements พร้อม Elimination อัตโนมัติ</p>
      </div>

      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, padding: '20px 24px' }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: 'var(--color-muted)' }}>เลือกบริษัทที่ต้องการรวมงบ (อย่างน้อย 2 บริษัท)</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {companies.map(co => (
            <button key={co.id} onClick={() => toggle(co.id)}
              style={{ background: selectedIds.includes(co.id) ? '#F2714E15' : 'var(--color-bg-inset)', border: `1px solid ${selectedIds.includes(co.id) ? '#F2714E50' : 'var(--color-border)'}`, color: selectedIds.includes(co.id) ? '#F2714E' : 'var(--color-text-secondary)', borderRadius: 20, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {selectedIds.includes(co.id) ? '✓ ' : ''}{co.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--color-text)' }} />
          <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>ถึง</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--color-text)' }} />
        </div>
      </div>

      {selectedIds.length < 2 && (
        <div style={{ padding: 32, textAlign: 'center', background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 14 }}>
          <p style={{ color: '#F5A623', fontSize: 12 }}>เลือกอย่างน้อย 2 บริษัทเพื่อดูงบการเงินรวม</p>
        </div>
      )}

      {isLoading && selectedIds.length >= 2 && <p style={{ color: 'var(--color-dim)' }}>กำลังคำนวณ...</p>}

      {consolidated && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {[
              { l: 'รายได้รวม (หลังตัด)', v: fmtB(consolidated.consolidated_revenue), color: '#43E97B' },
              { l: 'ค่าใช้จ่ายรวม (หลังตัด)', v: fmtB(consolidated.consolidated_expense), color: '#F093FB' },
              { l: 'กำไรสุทธิรวม', v: fmtB(consolidated.consolidated_net_profit), color: consolidated.consolidated_net_profit >= 0 ? '#F2714E' : '#FF6B6B' },
              { l: 'ยอดตัดรายการระหว่างกัน', v: fmtB(consolidated.eliminations), color: '#F5A623' },
            ].map(s => (
              <div key={s.l} style={{ background: 'var(--color-card)', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          {consolidated.eliminations > 0 && (
            <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '12px 16px' }}>
              <p style={{ margin: 0, fontSize: 11, color: '#F5A623' }}>
                ✦ ระบบตัดรายการระหว่างบริษัทในเครือมูลค่า {fmtB(consolidated.eliminations)} ออกจากงบรวมโดยอัตโนมัติ เพื่อไม่ให้เกิดการนับซ้ำ
              </p>
            </div>
          )}

          <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['บริษัท', 'รายได้', 'ค่าใช้จ่าย', 'กำไรสุทธิ'].map(h => <th key={h} style={{ padding: '10px 16px', textAlign: h === 'บริษัท' ? 'left' : 'right', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {consolidated.per_company.map(pc => (
                  <tr key={pc.company}>
                    <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontWeight: 600 }}>{pc.company}</td>
                    <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', textAlign: 'right', color: '#43E97B' }}>{fmtB(pc.revenue)}</td>
                    <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', textAlign: 'right', color: '#F093FB' }}>{fmtB(pc.expense)}</td>
                    <td style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: pc.net_profit >= 0 ? '#43E97B' : '#FF6B6B' }}>{fmtB(pc.net_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
