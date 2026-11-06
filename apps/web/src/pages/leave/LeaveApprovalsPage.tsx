import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface LeaveRequest { id: string; employee_name: string; leave_type_name: string; start_date: string; end_date: string; days_requested: number; status: string; reason?: string }

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'รอดำเนินการ', color: '#F5A623' }, approved: { label: 'อนุมัติแล้ว', color: '#43E97B' },
  rejected: { label: 'ปฏิเสธ', color: '#FF6B6B' }, cancelled: { label: 'ยกเลิก', color: 'var(--color-dim)' },
}

export default function LeaveApprovalsPage() {
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState('pending')
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: requests = [], isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['all-leave-requests', filterStatus],
    queryFn: async () => (await api.get(`/api/v1/leave/requests${filterStatus !== 'all' ? `?status=${filterStatus}` : ''}`)).data,
  })

  const processM = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) =>
      api.post(`/api/v1/leave/requests/${id}/process`, { approve, rejection_reason: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-leave-requests'] }); setRejecting(null); setRejectReason('') },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>อนุมัติวันลา</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>คำขอลาของทีม</p>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            style={{ background: filterStatus === s ? '#F2714E' : 'var(--color-card)', color: filterStatus === s ? 'var(--color-bg)' : 'var(--color-text-tertiary)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {s === 'all' ? 'ทั้งหมด' : STATUS_META[s]?.label || s}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading ? <p style={{ color: 'var(--color-dim)' }}>กำลังโหลด...</p>
        : requests.length === 0 ? <p style={{ color: 'var(--color-dim)', textAlign: 'center', padding: 40 }}>ไม่มีคำขอ</p>
        : requests.map(r => {
          const sm = STATUS_META[r.status]
          return (
            <div key={r.id} style={{ background: 'var(--color-card)', border: `1px solid ${sm.color}25`, borderLeft: `3px solid ${sm.color}`, borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{r.employee_name}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.leave_type_name} — {r.start_date} ถึง {r.end_date} ({r.days_requested} วัน)</p>
              {r.reason && <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--color-muted)' }}>เหตุผล: {r.reason}</p>}
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => processM.mutate({ id: r.id, approve: true })} style={{ background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}>✓ อนุมัติ</button>
                  <button onClick={() => setRejecting(r)} style={{ background: '#FF6B6B15', border: '1px solid #FF6B6B40', color: '#FF6B6B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}>✕ ปฏิเสธ</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {rejecting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setRejecting(null)}>
          <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>ระบุเหตุผลการปฏิเสธ</h3></div>
            <div style={{ padding: 24 }}>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', resize: 'vertical', marginBottom: 16, boxSizing: 'border-box' }} />
              <button onClick={() => processM.mutate({ id: rejecting.id, approve: false, reason: rejectReason })} disabled={!rejectReason}
                style={{ width: '100%', background: '#FF6B6B', color: '#141018', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                ยืนยันการปฏิเสธ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
