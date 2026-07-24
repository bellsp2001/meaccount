import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Control { control_id: string; category: string; name: string; status: string; detail: string; is_automated: boolean }
interface ScanResult { scan_date: string; total_controls: number; automated_pass: number; automated_fail: number; manual_review_count: number; controls: Control[] }

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  access_control: { label: 'การควบคุมการเข้าถึง', icon: '🔐' },
  encryption: { label: 'การเข้ารหัส', icon: '🔒' },
  audit_logging: { label: 'บันทึกตรวจสอบ', icon: '📋' },
  data_rights: { label: 'สิทธิเจ้าของข้อมูล (PDPA)', icon: '⚖️' },
}
const STATUS_META: Record<string, { label: string; color: string }> = {
  pass: { label: 'ผ่าน', color: '#43E97B' }, fail: { label: 'ไม่ผ่าน', color: '#FF6B6B' },
  manual_review_required: { label: 'ต้องตรวจสอบด้วยตนเอง', color: '#F5A623' },
}

export default function ComplianceDashboardPage() {
  const { data: scan, isLoading } = useQuery<ScanResult>({
    queryKey: ['compliance-scan'],
    queryFn: async () => (await api.get('/api/v1/security/compliance-scan')).data,
  })

  const grouped = scan?.controls.reduce((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c)
    return acc
  }, {} as Record<string, Control[]>) || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Compliance Scanner</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ตรวจสอบ Technical Control ตามแนวทาง SOC2 / PDPA</p>
      </div>

      <div style={{ background: '#F5A62308', border: '1px solid #F5A62325', borderRadius: 10, padding: '14px 18px' }}>
        <p style={{ margin: 0, fontSize: 12, color: '#F5A623', lineHeight: 1.6 }}>
          ⚠️ <strong>สำคัญ:</strong> เครื่องมือนี้ตรวจสอบเฉพาะ technical control ที่ตรวจจากโค้ดได้เท่านั้น — ไม่ใช่ใบรับรอง SOC2 หรือคำยืนยันความสอดคล้อง PDPA ทางกฎหมาย
          รายการที่ระบุ "ต้องตรวจสอบด้วยตนเอง" ต้องอาศัยผู้ตรวจสอบ/ที่ปรึกษากฎหมายที่มีใบอนุญาตในการยืนยัน
        </p>
      </div>

      {isLoading ? <p style={{ color: '#3A4A60' }}>กำลังสแกน...</p>
      : scan && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
            {[
              { l: 'Control ทั้งหมด', v: scan.total_controls, color: '#4FACFE' },
              { l: 'ผ่านอัตโนมัติ', v: scan.automated_pass, color: '#43E97B' },
              { l: 'ไม่ผ่าน', v: scan.automated_fail, color: '#FF6B6B' },
              { l: 'ต้องตรวจสอบเอง', v: scan.manual_review_count, color: '#F5A623' },
            ].map(s => (
              <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.v}</p>
              </div>
            ))}
          </div>

          {Object.entries(grouped).map(([category, controls]) => {
            const cm = CATEGORY_META[category] || { label: category, icon: '📄' }
            return (
              <div key={category}>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#8A9BB0' }}>{cm.icon} {cm.label}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {controls.map(c => {
                    const sm = STATUS_META[c.status]
                    return (
                      <div key={c.control_id} style={{ background: '#0D1018', border: `1px solid ${sm.color}25`, borderLeft: `3px solid ${sm.color}`, borderRadius: 10, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{c.control_id} — {c.name}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, background: sm.color + '18', padding: '2px 8px', borderRadius: 10, flexShrink: 0, marginLeft: 8 }}>{sm.label}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 11, color: '#6A7A90', lineHeight: 1.5 }}>{c.detail}</p>
                        {!c.is_automated && (
                          <p style={{ margin: '6px 0 0', fontSize: 9, color: '#3A4A60', fontStyle: 'italic' }}>* กระบวนการองค์กร — ไม่ใช่สิ่งที่ตรวจจากโค้ดได้</p>
                        )}
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
