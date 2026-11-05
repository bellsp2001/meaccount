import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Check { check_id: string; category: string; name: string; status: string; detail: string; blocking: boolean }
interface Report { scan_date: string; overall_status: string; total_checks: number; passed: number; failed: number; warnings: number; blocking_failures: number; checks: Check[] }

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  config: { label: 'Configuration', icon: '⚙️' }, database: { label: 'Database', icon: '🗄️' },
  security: { label: 'Security', icon: '🔐' }, dependencies: { label: 'Dependencies & Ops', icon: '📦' },
}
const STATUS_META: Record<string, { label: string; color: string }> = {
  pass: { label: 'ผ่าน', color: '#43E97B' }, fail: { label: 'ไม่ผ่าน', color: '#FF6B6B' }, warning: { label: 'คำเตือน', color: '#F5A623' },
}
const OVERALL_META: Record<string, { label: string; color: string; icon: string }> = {
  ready: { label: 'พร้อม Go-Live', color: '#43E97B', icon: '✅' },
  ready_with_warnings: { label: 'พร้อมแบบมีคำเตือน', color: '#F5A623', icon: '⚠️' },
  not_ready: { label: 'ยังไม่พร้อม Go-Live', color: '#FF6B6B', icon: '🛑' },
}

export default function GoLiveReadinessPage() {
  const { data: report, isLoading, refetch, isRefetching } = useQuery<Report>({
    queryKey: ['readiness'],
    queryFn: async () => (await api.get('/api/v1/ops/readiness')).data,
  })

  const grouped = report?.checks.reduce((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c)
    return acc
  }, {} as Record<string, Check[]>) || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Go-Live Readiness</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ตรวจสอบความพร้อมก่อนขึ้น Production</p>
        </div>
        <button onClick={() => refetch()} disabled={isRefetching} style={{ background: '#0D1018', border: '1px solid #1E2A3A', color: '#8A9BB0', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 18px', cursor: 'pointer' }}>
          {isRefetching ? '⏳ กำลังสแกน...' : '🔄 สแกนใหม่'}
        </button>
      </div>

      <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '12px 16px' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#F5A623', lineHeight: 1.6 }}>
          ⚠️ การสแกนนี้ตรวจได้เฉพาะสิ่งที่ verify จากโค้ด/config เท่านั้น <strong>ไม่ใช่การรับรองว่าระบบพร้อม 100%</strong> —
          รายการ Load Testing, Rollback Plan, On-call, Backup ต้องทำจริงกับ infrastructure จริงก่อน launch เสมอ
        </p>
      </div>

      {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังสแกน...</p>
      : report && (
        <>
          <div style={{ background: '#0D1018', border: `2px solid ${OVERALL_META[report.overall_status].color}40`, borderRadius: 16, padding: '28px', textAlign: 'center' }}>
            <p style={{ fontSize: 44, marginBottom: 8 }}>{OVERALL_META[report.overall_status].icon}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: OVERALL_META[report.overall_status].color }}>{OVERALL_META[report.overall_status].label}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#4A5A70' }}>สแกนเมื่อ {new Date(report.scan_date).toLocaleString('th-TH')}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
            {[
              { l: 'ทั้งหมด', v: report.total_checks, color: '#4FACFE' },
              { l: 'ผ่าน', v: report.passed, color: '#43E97B' },
              { l: 'ไม่ผ่าน (Blocking)', v: report.blocking_failures, color: '#FF6B6B' },
              { l: 'คำเตือน', v: report.warnings, color: '#F5A623' },
            ].map(s => (
              <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          {Object.entries(grouped).map(([category, checks]) => {
            const cm = CATEGORY_META[category] || { label: category, icon: '📄' }
            return (
              <div key={category}>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#8A9BB0' }}>{cm.icon} {cm.label}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {checks.map(c => {
                    const sm = STATUS_META[c.status]
                    return (
                      <div key={c.check_id} style={{ background: '#0D1018', border: `1px solid ${sm.color}25`, borderLeft: `3px solid ${sm.color}`, borderRadius: 10, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{c.check_id} — {c.name}</span>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {c.blocking && <span style={{ fontSize: 9, fontWeight: 700, color: '#FF6B6B', border: '1px solid #FF6B6B40', padding: '2px 6px', borderRadius: 8 }}>BLOCKING</span>}
                            <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                          </div>
                        </div>
                        <p style={{ margin: 0, fontSize: 11, color: '#6A7A90', lineHeight: 1.5 }}>{c.detail}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
