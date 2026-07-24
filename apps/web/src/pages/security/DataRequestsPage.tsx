import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface DSR { id: string; subject_type: string; subject_id: string; request_type: string; status: string; rejection_reason?: string; created_at: string }

const TYPE_META: Record<string, { label: string; icon: string }> = {
  access: { label: 'ขอเข้าถึงข้อมูล', icon: '👁️' }, export: { label: 'ขอโอนย้ายข้อมูล', icon: '📤' },
  delete: { label: 'ขอลบข้อมูล', icon: '🗑️' }, rectify: { label: 'ขอแก้ไขข้อมูล', icon: '✏️' },
}
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'รอดำเนินการ', color: '#F5A623' }, completed: { label: 'เสร็จสิ้น', color: '#43E97B' },
  rejected: { label: 'ปฏิเสธ', color: '#FF6B6B' }, processing: { label: 'กำลังดำเนินการ', color: '#4FACFE' },
}

export default function DataRequestsPage() {
  const qc = useQueryClient()
  const [processing, setProcessing] = useState<DSR | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: dsrs = [], isLoading } = useQuery<DSR[]>({
    queryKey: ['dsrs'],
    queryFn: async () => (await api.get('/api/v1/security/dsr')).data,
  })

  const processM = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) =>
      api.post(`/api/v1/security/dsr/${id}/process`, { approve, rejection_reason: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dsrs'] }); setProcessing(null); setRejectReason('') },
  })

  const pendingCount = dsrs.filter(d => d.status === 'pending').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Data Subject Requests</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>คำขอใช้สิทธิตาม PDPA — {pendingCount} รายการรอดำเนินการ</p>
      </div>

      {pendingCount > 0 && (
        <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 11, color: '#F5A623' }}>⏰ PDPA กำหนดให้ตอบสนองคำขอภายในระยะเวลาที่เหมาะสม (โดยทั่วไปตีความ 30 วัน)</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังโหลด...</p>
        : dsrs.length === 0 ? <p style={{ color: '#3A4A60', textAlign: 'center', padding: 40 }}>ยังไม่มีคำขอ</p>
        : dsrs.map(dsr => {
          const tm = TYPE_META[dsr.request_type]
          const sm = STATUS_META[dsr.status]
          return (
            <div key={dsr.id} style={{ background: '#0D1018', border: `1px solid ${sm.color}25`, borderLeft: `3px solid ${sm.color}`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{tm.icon} {tm.label}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: '#6A7A90' }}>ประเภท: {dsr.subject_type} · ID: {dsr.subject_id.slice(0, 8)}...</p>
              <p style={{ margin: 0, fontSize: 10, color: '#4A5A70' }}>{new Date(dsr.created_at).toLocaleString('th-TH')}</p>
              {dsr.rejection_reason && <p style={{ margin: '8px 0 0', fontSize: 11, color: '#FF6B6B' }}>เหตุผล: {dsr.rejection_reason}</p>}
              {dsr.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => processM.mutate({ id: dsr.id, approve: true })} style={{ background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>✓ อนุมัติ</button>
                  <button onClick={() => setProcessing(dsr)} style={{ background: '#FF6B6B15', border: '1px solid #FF6B6B40', color: '#FF6B6B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>✕ ปฏิเสธ</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {processing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setProcessing(null)}>
          <div style={{ background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28' }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>ระบุเหตุผลการปฏิเสธ</h3></div>
            <div style={{ padding: 24 }}>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="เช่น ไม่สามารถยืนยันตัวตนได้"
                style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', resize: 'vertical', marginBottom: 16, boxSizing: 'border-box' }} />
              <button onClick={() => processM.mutate({ id: processing.id, approve: false, reason: rejectReason })} disabled={!rejectReason}
                style={{ width: '100%', background: '#FF6B6B', color: '#07090E', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                ยืนยันการปฏิเสธ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
