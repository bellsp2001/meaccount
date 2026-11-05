import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Alert {
  id: string; pattern: string; risk_level: string; risk_score: number
  title: string; description: string; resource_type: string; reference?: string
  amount?: number; status: string; detected_at: string; related_user_email?: string
}
interface RiskDashboard {
  open_alerts_count: number; critical_open_count: number; total_at_risk_amount: number
  alerts_by_pattern: Record<string, number>; alerts_by_status: Record<string, number>
  recent_alerts: Alert[]
}

const PATTERN_LABEL: Record<string, string> = {
  ghost_vendor: '👻 ผู้ขายผี', duplicate_payment: '🔁 จ่ายซ้ำ', round_tripping: '🔄 เงินหมุนวน',
  split_transaction: '✂️ แตกรายการ', off_hours_activity: '🌙 นอกเวลาทำการ', rapid_sequence: '⚡ รวดเร็วผิดปกติ',
  unusual_approver: '⚠️ ผู้อนุมัติผิดปกติ', new_vendor_large: '🆕 ผู้ขายใหม่ยอดสูง',
}
const RISK_COLOR: Record<string, string> = { critical: '#FF3B3B', high: '#FF6B6B', medium: '#F5A623', low: '#4FACFE' }
const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: 'เปิดอยู่', color: '#FF6B6B' }, investigating: { label: 'กำลังตรวจสอบ', color: '#F5A623' },
  resolved: { label: 'แก้ไขแล้ว', color: '#43E97B' }, dismissed: { label: 'ปิดเคส', color: '#3A4A60' },
}

export default function RiskDashboardPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'dashboard' | 'alerts' | 'scan'>('dashboard')
  const [filterStatus, setFilterStatus] = useState('all')
  const [scanFrom, setScanFrom] = useState(new Date(new Date().setDate(1)).toISOString().split('T')[0])
  const [scanTo, setScanTo] = useState(new Date().toISOString().split('T')[0])
  const [showAction, setShowAction] = useState<Alert | null>(null)
  const [actionNote, setActionNote] = useState('')

  const { data: dashboard } = useQuery<RiskDashboard>({
    queryKey: ['risk-dashboard'], enabled: tab === 'dashboard',
    queryFn: async () => (await api.get('/api/v1/fraud/dashboard')).data,
  })
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['fraud-alerts', filterStatus], enabled: tab === 'alerts',
    queryFn: async () => (await api.get(`/api/v1/fraud/alerts${filterStatus !== 'all' ? `?status=${filterStatus}` : ''}`)).data,
  })

  const scanM = useMutation({
    mutationFn: () => api.post('/api/v1/fraud/scan', { period_from: scanFrom, period_to: scanTo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['risk-dashboard'] }); qc.invalidateQueries({ queryKey: ['fraud-alerts'] }) },
  })
  const actionM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/api/v1/fraud/alerts/${id}/action`, { status, resolution_note: actionNote }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fraud-alerts'] }); qc.invalidateQueries({ queryKey: ['risk-dashboard'] }); setShowAction(null); setActionNote('') },
  })

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 460 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>AI Fraud Detection & Risk</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ตรวจจับความเสี่ยงและพฤติกรรมทุจริตแบบ Real-time</p>
      </div>

      <div style={{ display: 'flex', gap: 3, background: '#0D1018', borderRadius: 9, padding: 3, width: 'fit-content' }}>
        {[['dashboard', '📊 Risk Dashboard'], ['alerts', '🔔 Alerts'], ['scan', '🔍 สแกนใหม่']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as any)} style={{ background: tab === id ? '#FF6B6B' : 'transparent', color: tab === id ? '#07090E' : '#5A6A80', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {tab === 'dashboard' && dashboard && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {[
              { l: 'Alert เปิดอยู่', v: dashboard.open_alerts_count, color: '#FF6B6B' },
              { l: 'Critical', v: dashboard.critical_open_count, color: '#FF3B3B' },
              { l: 'มูลค่าเสี่ยงรวม', v: `฿${Number(dashboard.total_at_risk_amount).toLocaleString('th-TH')}`, color: '#F5A623' },
            ].map(s => (
              <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          {Object.keys(dashboard.alerts_by_pattern).length > 0 && (
            <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '20px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700 }}>รูปแบบความเสี่ยงที่พบ</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }}>
                {Object.entries(dashboard.alerts_by_pattern).map(([pattern, count]) => (
                  <div key={pattern} style={{ background: '#070A0F', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12 }}>{PATTERN_LABEL[pattern] || pattern}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#FF6B6B' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#4A5A70' }}>Alert ล่าสุด</p>
            {dashboard.recent_alerts.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', background: '#43E97B08', border: '1px solid #43E97B25', borderRadius: 14 }}>
                <p style={{ fontSize: 28 }}>✅</p><p style={{ color: '#43E97B', fontSize: 13 }}>ไม่พบความเสี่ยง</p>
              </div>
            ) : dashboard.recent_alerts.map(a => (
              <AlertCard key={a.id} alert={a} onAction={() => setShowAction(a)} />
            ))}
          </div>
        </>
      )}

      {/* ── ALERTS TAB ── */}
      {tab === 'alerts' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'open', 'investigating', 'resolved', 'dismissed'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={{ background: filterStatus === s ? '#FF6B6B' : '#0D1018', color: filterStatus === s ? '#07090E' : '#5A6A80', border: '1px solid #151C28', borderRadius: 20, padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {s === 'all' ? 'ทั้งหมด' : STATUS_META[s]?.label || s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#3A4A60' }}>ไม่พบ Alert</div>
            : alerts.map(a => <AlertCard key={a.id} alert={a} onAction={() => setShowAction(a)} />)}
          </div>
        </>
      )}

      {/* ── SCAN TAB ── */}
      {tab === 'scan' && (
        <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, padding: '24px', maxWidth: 480 }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>สแกนหาความเสี่ยงในช่วงเวลา</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div><label style={{ fontSize: 10, color: '#4A5A70', marginBottom: 6, display: 'block' }}>จาก</label><input type="date" value={scanFrom} onChange={e => setScanFrom(e.target.value)} style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE' }} /></div>
            <div><label style={{ fontSize: 10, color: '#4A5A70', marginBottom: 6, display: 'block' }}>ถึง</label><input type="date" value={scanTo} onChange={e => setScanTo(e.target.value)} style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE' }} /></div>
          </div>
          <div style={{ background: '#FF6B6B08', border: '1px solid #FF6B6B20', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 11, color: '#FF6B6B' }}>✦ ระบบจะตรวจ 6 รูปแบบ: ผู้ขายผี, จ่ายซ้ำ, แตกรายการ, นอกเวลาทำการ, ทำรายการเร็วผิดปกติ, ผู้ขายใหม่ยอดสูง</p>
          </div>
          <button onClick={() => scanM.mutate()} disabled={scanM.isPending} style={{ width: '100%', background: 'linear-gradient(135deg,#FF6B6B,#F5A623)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '12px', cursor: 'pointer', opacity: scanM.isPending ? 0.7 : 1 }}>
            {scanM.isPending ? '⏳ กำลังสแกน...' : '🔍 เริ่มสแกน'}
          </button>
          {scanM.isSuccess && (
            <div style={{ marginTop: 16, background: '#43E97B08', border: '1px solid #43E97B25', borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#43E97B' }}>✓ สแกนเสร็จสิ้น</p>
              <p style={{ margin: 0, fontSize: 11, color: '#8A9BB0' }}>ตรวจสอบ {scanM.data?.data.total_transactions_scanned} รายการ พบความเสี่ยง {scanM.data?.data.alerts_created} รายการ</p>
            </div>
          )}
        </div>
      )}

      {/* ACTION MODAL */}
      {showAction && (
        <div style={overlay} onClick={() => setShowAction(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{showAction.title}</h3>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#8A9BB0', lineHeight: 1.6 }}>{showAction.description}</p>
              <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3} placeholder="บันทึกผลการตรวจสอบ..."
                style={{ width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', resize: 'vertical', marginBottom: 16, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => actionM.mutate({ id: showAction.id, status: 'investigating' })} style={{ flex: 1, background: '#F5A62315', border: '1px solid #F5A62340', color: '#F5A623', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '9px', cursor: 'pointer' }}>กำลังตรวจสอบ</button>
                <button onClick={() => actionM.mutate({ id: showAction.id, status: 'resolved' })} style={{ flex: 1, background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '9px', cursor: 'pointer' }}>แก้ไขแล้ว</button>
                <button onClick={() => actionM.mutate({ id: showAction.id, status: 'dismissed' })} style={{ flex: 1, background: '#151C28', border: '1px solid #1E2A3A', color: '#6A7A90', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '9px', cursor: 'pointer' }}>ปิดเคส</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AlertCard({ alert: a, onAction }: { alert: Alert; onAction: () => void }) {
  const color = RISK_COLOR[a.risk_level]
  const sm = STATUS_META[a.status]
  return (
    <div style={{ background: '#0D1018', border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color, background: color + '18', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{a.risk_level}</span>
          <span style={{ fontSize: 10, color: '#4A5A70', background: '#151C28', padding: '2px 8px', borderRadius: 10 }}>{PATTERN_LABEL[a.pattern] || a.pattern}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: sm.color }}>{sm.label}</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>Score: {Number(a.risk_score).toFixed(0)}</span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>{a.title}</p>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8A9BB0', lineHeight: 1.6 }}>{a.description}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#3A4A60' }}>{new Date(a.detected_at).toLocaleString('th-TH')}</span>
        {(a.status === 'open' || a.status === 'investigating') && (
          <button onClick={onAction} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `1px solid ${color}40`, background: color + '12', color, cursor: 'pointer', fontWeight: 700 }}>ดำเนินการ</button>
        )}
      </div>
    </div>
  )
}
