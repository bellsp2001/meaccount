import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth'

interface Employee { id: string; employee_code: string; full_name: string }
interface LeaveType { id: string; code: string; name: string; is_paid: boolean; default_days_per_year: number }
interface Balance { leave_type_id: string; leave_type_name: string; entitled_days: number; used_days: number; carried_over: number; remaining_days: number }
interface LeaveRequest { id: string; leave_type_name: string; start_date: string; end_date: string; days_requested: number; status: string; reason?: string; rejection_reason?: string }

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'รอดำเนินการ', color: '#F5A623' }, approved: { label: 'อนุมัติแล้ว', color: '#43E97B' },
  rejected: { label: 'ปฏิเสธ', color: '#FF6B6B' }, cancelled: { label: 'ยกเลิก', color: 'var(--color-dim)' },
}

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }

export default function MyLeavePage() {
  const qc = useQueryClient()
  const currentYear = new Date().getFullYear()
  const [showRequest, setShowRequest] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [form, setForm] = useState({ leave_type_id: '', start_date: '', end_date: '', days_requested: '1', reason: '' })

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'], queryFn: async () => (await api.get('/api/v1/payroll/employees')).data,
  })
  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['leave-types'], queryFn: async () => (await api.get('/api/v1/leave/types')).data,
  })
  const { data: balances = [] } = useQuery<Balance[]>({
    queryKey: ['leave-balances', employeeId, currentYear], enabled: !!employeeId,
    queryFn: async () => (await api.get(`/api/v1/leave/balances/${employeeId}?year=${currentYear}`)).data,
  })
  const { data: requests = [] } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests', employeeId], enabled: !!employeeId,
    queryFn: async () => (await api.get(`/api/v1/leave/requests?employee_id=${employeeId}`)).data,
  })

  const requestM = useMutation({
    mutationFn: () => api.post('/api/v1/leave/requests', { employee_id: employeeId, ...form, days_requested: Number(form.days_requested) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-requests'] }); setShowRequest(false); setForm({ leave_type_id: '', start_date: '', end_date: '', days_requested: '1', reason: '' }) },
  })
  const cancelM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/leave/requests/${id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-requests'] }); qc.invalidateQueries({ queryKey: ['leave-balances'] }) },
  })

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 460 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>วันลาของฉัน</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>ปี {currentYear + 543}</p>
        </div>
        <button onClick={() => setShowRequest(true)} disabled={!employeeId}
          style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer', opacity: !employeeId ? 0.5 : 1 }}>
          + ขอลา
        </button>
      </div>

      <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={{ ...inp, maxWidth: 320, cursor: 'pointer' }}>
        <option value="">-- เลือกพนักงาน --</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} — {e.full_name}</option>)}
      </select>

      {employeeId && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {balances.map(b => (
              <div key={b.leave_type_id} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderTop: '2px solid #F2714E', borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--color-muted)' }}>{b.leave_type_name}</p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#F2714E' }}>{b.remaining_days}</p>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--color-dim)' }}>จาก {b.entitled_days + b.carried_over} วัน (ใช้ไป {b.used_days})</p>
              </div>
            ))}
            {balances.length === 0 && (
              <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: 'var(--color-dim)', fontSize: 12 }}>
                ยังไม่มีข้อมูลวันลาปีนี้ — ให้ HR/Accountant ตั้งค่า "เริ่มต้นวันลา" ก่อน
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>ประวัติการขอลา</p>
            {requests.length === 0 ? <p style={{ color: 'var(--color-dim)', fontSize: 12 }}>ยังไม่มีประวัติ</p>
            : requests.map(r => {
              const sm = STATUS_META[r.status]
              return (
                <div key={r.id} style={{ background: 'var(--color-card)', border: `1px solid ${sm.color}25`, borderLeft: `3px solid ${sm.color}`, borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{r.leave_type_name}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{r.start_date} ถึง {r.end_date} · {r.days_requested} วัน</p>
                  {r.reason && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-muted)' }}>เหตุผล: {r.reason}</p>}
                  {r.rejection_reason && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#FF6B6B' }}>ปฏิเสธ: {r.rejection_reason}</p>}
                  {(r.status === 'pending' || r.status === 'approved') && (
                    <button onClick={() => cancelM.mutate(r.id)} style={{ marginTop: 8, fontSize: 10, background: 'var(--color-border)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-secondary)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>ยกเลิกคำขอ</button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {showRequest && (
        <div style={overlay} onClick={() => setShowRequest(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>ขอลา</h3></div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>ประเภทการลา</label>
                <select value={form.leave_type_id} onChange={e => setForm({ ...form, leave_type_id: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- เลือกประเภท --</option>
                  {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name} {!t.is_paid && '(ไม่รับค่าจ้าง)'}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>วันเริ่มลา</label><input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>วันสิ้นสุด</label><input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} style={inp} /></div>
              </div>
              <div><label style={lbl}>จำนวนวัน</label><input type="number" step="0.5" value={form.days_requested} onChange={e => setForm({ ...form, days_requested: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>เหตุผล</label><textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
              {requestM.isError && <p style={{ color: '#FF6B6B', fontSize: 11 }}>เกิดข้อผิดพลาด — วันลาอาจไม่พอ หรือซ้อนทับกับคำขออื่น</p>}
              <button onClick={() => requestM.mutate()} disabled={!form.leave_type_id || !form.start_date || !form.end_date || requestM.isPending}
                style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                {requestM.isPending ? 'กำลังส่ง...' : 'ส่งคำขอ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
