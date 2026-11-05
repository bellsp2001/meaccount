import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface MatchRecord {
  id: string; po_id?: string; bill_id?: string; match_status: string
  po_amount?: number; receipt_amount?: number; invoice_amount?: number
  quantity_discrepancy: boolean; price_discrepancy: boolean
  discrepancy_notes?: string; resolved: boolean
}

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'รอตรวจสอบ', color: '#F5A623', icon: '⏳' },
  matched: { label: 'ตรงกันทั้งหมด', color: '#43E97B', icon: '✅' },
  discrepancy: { label: 'พบความคลาดเคลื่อน', color: '#FF6B6B', icon: '⚠️' },
  unmatched: { label: 'ไม่พบ PO', color: '#8A9BB0', icon: '❓' },
}

export default function ThreeWayMatchPage() {
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState('all')
  const [billIdInput, setBillIdInput] = useState('')
  const [showResolve, setShowResolve] = useState<MatchRecord | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  const { data: records = [], isLoading } = useQuery<MatchRecord[]>({
    queryKey: ['match-records', filterStatus],
    queryFn: async () => (await api.get(`/api/v1/documents/match/records${filterStatus !== 'all' ? `?status=${filterStatus}` : ''}`)).data,
  })

  const runM = useMutation({
    mutationFn: (billId: string) => api.post('/api/v1/documents/match/run', { bill_id: billId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['match-records'] }); setBillIdInput('') },
  })
  const resolveM = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/api/v1/documents/match/${id}/resolve`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['match-records'] }); setShowResolve(null); setResolveNote('') },
  })

  const discrepancyCount = records.filter(r => r.match_status === 'discrepancy' && !r.resolved).length

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 440 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>3-Way Match</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>จับคู่ PO ↔ ใบรับสินค้า ↔ ใบแจ้งหนี้</p>
      </div>

      {/* Run new match */}
      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '18px 22px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={billIdInput} onChange={e => setBillIdInput(e.target.value)} placeholder="วาง Bill ID เพื่อตรวจสอบ 3-Way Match..."
          style={{ flex: 1, minWidth: 240, background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none' }} />
        <button onClick={() => runM.mutate(billIdInput)} disabled={!billIdInput || runM.isPending}
          style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px 18px', cursor: 'pointer', opacity: !billIdInput ? 0.5 : 1 }}>
          {runM.isPending ? '⏳' : '🔍'} ตรวจสอบ
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <button key={key} onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
            style={{ background: filterStatus === key ? meta.color + '12' : '#0D1018', border: `1px solid ${filterStatus === key ? meta.color + '50' : '#151C28'}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
            <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: meta.color }}>{records.filter(r => r.match_status === key).length}</p>
            <p style={{ margin: 0, fontSize: 11, color: '#5A6A80' }}>{meta.icon} {meta.label}</p>
          </button>
        ))}
      </div>

      {discrepancyCount > 0 && (
        <div style={{ background: '#FF6B6B10', border: '1px solid #FF6B6B30', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>⚠️ พบความคลาดเคลื่อนที่ยังไม่แก้ไข {discrepancyCount} รายการ ควรตรวจสอบก่อนอนุมัติจ่ายเงิน</p>
        </div>
      )}

      {/* Records list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังโหลด...</p>
        : records.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#0D1018', border: '1px solid #151C28', borderRadius: 14 }}>
            <p style={{ color: '#3A4A60', fontSize: 13 }}>ยังไม่มีรายการจับคู่</p>
          </div>
        ) : records.map(r => {
          const sm = STATUS_META[r.match_status]
          return (
            <div key={r.id} style={{ background: '#0D1018', border: `1px solid ${sm.color}30`, borderLeft: `3px solid ${sm.color}`, borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: sm.color }}>{sm.icon} {sm.label}</span>
                {r.resolved && <span style={{ fontSize: 10, color: '#43E97B', fontWeight: 700 }}>✓ แก้ไขแล้ว</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: r.discrepancy_notes ? 12 : 0 }}>
                {[['PO', r.po_amount, '#4FACFE'], ['รับสินค้า', r.receipt_amount, '#F5A623'], ['Invoice', r.invoice_amount, '#F093FB']].map(([label, val, color]) => (
                  <div key={label as string} style={{ background: '#070A0F', borderRadius: 8, padding: '10px 12px' }}>
                    <p style={{ margin: '0 0 3px', fontSize: 9, color: '#4A5A70' }}>{label}</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: val != null ? color as string : '#3A4A60' }}>{val != null ? `฿${Number(val).toLocaleString('th-TH')}` : '—'}</p>
                  </div>
                ))}
              </div>
              {r.discrepancy_notes && (
                <p style={{ margin: 0, fontSize: 11, color: '#FF6B6B', lineHeight: 1.6 }}>{r.discrepancy_notes}</p>
              )}
              {r.match_status === 'discrepancy' && !r.resolved && (
                <button onClick={() => setShowResolve(r)} style={{ marginTop: 12, background: '#F5A62315', border: '1px solid #F5A62340', color: '#F5A623', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                  บันทึกการแก้ไข
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* RESOLVE MODAL */}
      {showResolve && (
        <div style={overlay} onClick={() => setShowResolve(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>บันทึกการแก้ไขความคลาดเคลื่อน</h3>
            </div>
            <div style={{ padding: 24 }}>
              <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)} rows={4} placeholder="อธิบายสาเหตุและการแก้ไข..."
                style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', resize: 'vertical', marginBottom: 16, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowResolve(null)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid #1E2A3A', background: 'transparent', color: '#6A7A90', cursor: 'pointer', fontSize: 12 }}>ยกเลิก</button>
                <button onClick={() => resolveM.mutate({ id: showResolve.id, note: resolveNote })} disabled={!resolveNote || resolveM.isPending}
                  style={{ background: '#43E97B', color: '#07090E', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer' }}>
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
