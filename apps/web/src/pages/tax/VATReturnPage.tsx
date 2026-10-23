import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface VATReturn {
  id: string; period_month: number; period_year: number; status: string
  sales_amount: number; output_vat: number; purchase_amount: number
  input_vat: number; net_vat: number; submitted_date?: string
  due_date?: string; xml_generated: boolean
}

const MONTHS_TH = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#F5A623' }, submitted: { label: 'ยื่นแล้ว', color: 'var(--color-accent-light)' }, accepted: { label: 'อนุมัติ', color: '#43E97B' },
}

export default function VATReturnPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [showGenerate, setShowGenerate] = useState(false)
  const [genMonth, setGenMonth] = useState(now.getMonth() + 1)
  const [genYear, setGenYear] = useState(now.getFullYear())
  const [viewVR, setViewVR] = useState<VATReturn | null>(null)
  const [checkResult, setCheckResult] = useState<any>(null)
  const [checking, setChecking] = useState(false)

  const { data: returns = [], isLoading } = useQuery<VATReturn[]>({
    queryKey: ['vat-returns'],
    queryFn: async () => (await api.get('/api/v1/tax/vat-returns')).data,
  })

  const genM = useMutation({
    mutationFn: () => api.post('/api/v1/tax/vat-returns/generate', { period_month: genMonth, period_year: genYear }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vat-returns'] }); setShowGenerate(false) },
  })
  const submitM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/tax/vat-returns/${id}/submit`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vat-returns'] }); setViewVR(null) },
  })

  async function handleCheck() {
    setChecking(true); setCheckResult(null)
    try {
      const { data } = await api.get(`/api/v1/tax/ai/check-vat?period_month=${genMonth}&period_year=${genYear}`)
      setCheckResult(data)
    } finally { setChecking(false) }
  }

  async function handleExportXML(vr: VATReturn) {
    const { data } = await api.get(`/api/v1/tax/vat-returns/${vr.id}/xml`, { responseType: 'text' })
    const blob = new Blob([data], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `PP30-${vr.period_year}${String(vr.period_month).padStart(2, '0')}.xml`
    a.click()
    URL.revokeObjectURL(url)
    qc.invalidateQueries({ queryKey: ['vat-returns'] })
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 460 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ภาษีมูลค่าเพิ่ม (ภ.พ.30)</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>VAT Return — ทั้งหมด {returns.length} งวด</p>
        </div>
        <button onClick={() => setShowGenerate(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + คำนวณ ภ.พ.30
        </button>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        : returns.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>🧾</p>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีรายการ ภ.พ.30</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['งวด', 'ยอดขาย', 'VAT ขาย', 'ยอดซื้อ', 'VAT ซื้อ', 'ภาษีสุทธิ', 'ครบกำหนด', 'สถานะ'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {returns.map(vr => {
                const sm = STATUS_META[vr.status]
                return (
                  <tr key={vr.id} onClick={() => setViewVR(vr)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontWeight: 600 }}>{MONTHS_TH[vr.period_month]} {vr.period_year + 543}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace' }}>฿{Number(vr.sales_amount).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', color: '#43E97B' }}>฿{Number(vr.output_vat).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace' }}>฿{Number(vr.purchase_amount).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', color: '#F093FB' }}>฿{Number(vr.input_vat).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: Number(vr.net_vat) >= 0 ? '#FF6B6B' : '#43E97B' }}>
                      {Number(vr.net_vat) >= 0 ? `ต้องจ่าย ฿${Number(vr.net_vat).toLocaleString('th-TH')}` : `ขอคืน ฿${Math.abs(Number(vr.net_vat)).toLocaleString('th-TH')}`}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-tertiary)' }}>{vr.due_date ? new Date(vr.due_date).toLocaleDateString('th-TH') : '—'}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color + '18', border: `1px solid ${sm.color}35`, padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* GENERATE MODAL */}
      {showGenerate && (
        <div style={overlay} onClick={() => setShowGenerate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>คำนวณ ภ.พ.30</h3>
              <button onClick={() => setShowGenerate(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>เดือน</label>
                  <select value={genMonth} onChange={e => setGenMonth(Number(e.target.value))} style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', cursor: 'pointer' }}>
                    {MONTHS_TH.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>ปี</label>
                  <select value={genYear} onChange={e => setGenYear(Number(e.target.value))} style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', cursor: 'pointer' }}>
                    {[genYear - 1, genYear, genYear + 1].map(y => <option key={y} value={y}>{y + 543}</option>)}
                  </select>
                </div>
              </div>

              {/* AI Check */}
              <button onClick={handleCheck} disabled={checking}
                style={{ background: '#F2714E15', border: '1px solid #F2714E40', color: '#F2714E', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                {checking ? '⏳ กำลังตรวจสอบ...' : '🤖 ตรวจสอบก่อนคำนวณ'}
              </button>

              {checkResult && (
                <div style={{ background: checkResult.is_correct ? '#43E97B10' : '#F5A62310', border: `1px solid ${checkResult.is_correct ? '#43E97B30' : '#F5A62330'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: checkResult.is_correct ? '#43E97B' : '#F5A623' }}>
                    {checkResult.is_correct ? '✓ ข้อมูลครบถ้วนพร้อมยื่น' : '⚠ พบข้อควรตรวจสอบ'}
                  </p>
                  {checkResult.issues?.map((issue: string, i: number) => (
                    <p key={i} style={{ margin: '4px 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>• {issue}</p>
                  ))}
                </div>
              )}

              {genM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — อาจมีรายการงวดนี้แล้ว</p></div>}

              <button onClick={() => genM.mutate()} disabled={genM.isPending}
                style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer', opacity: genM.isPending ? 0.7 : 1 }}>
                {genM.isPending ? 'กำลังคำนวณ...' : '✓ คำนวณ ภ.พ.30'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAIL MODAL */}
      {viewVR && (
        <div style={overlay} onClick={() => setViewVR(null)}>
          <div style={{ ...modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>ภ.พ.30 — {MONTHS_TH[viewVR.period_month]} {viewVR.period_year + 543}</h3>
              <button onClick={() => setViewVR(null)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: '#43E97B', textTransform: 'uppercase' }}>ภาษีขาย</p>
                {[['ยอดขาย', viewVR.sales_amount], ['VAT ขาย (7%)', viewVR.output_vat]].map(([l, v]) => (
                  <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{l}</span><span style={{ fontFamily: 'monospace' }}>฿{Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: '#F093FB', textTransform: 'uppercase' }}>ภาษีซื้อ</p>
                {[['ยอดซื้อ', viewVR.purchase_amount], ['VAT ซื้อ (7%)', viewVR.input_vat]].map(([l, v]) => (
                  <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{l}</span><span style={{ fontFamily: 'monospace' }}>฿{Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: Number(viewVR.net_vat) >= 0 ? '#FF6B6B10' : '#43E97B10', border: `1px solid ${Number(viewVR.net_vat) >= 0 ? '#FF6B6B30' : '#43E97B30'}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>{Number(viewVR.net_vat) >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ขอคืนได้'}</p>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: Number(viewVR.net_vat) >= 0 ? '#FF6B6B' : '#43E97B' }}>
                  ฿{Math.abs(Number(viewVR.net_vat)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => handleExportXML(viewVR)}
                  style={{ flex: 1, background: '#FFB59E15', border: '1px solid #FFB59E40', color: 'var(--color-accent-light)', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                  📥 Export XML
                </button>
                {viewVR.status === 'draft' && (
                  <button onClick={() => submitM.mutate(viewVR.id)} disabled={submitM.isPending}
                    style={{ flex: 1, background: '#43E97B', color: '#141018', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '10px', cursor: 'pointer' }}>
                    ✓ ยื่นแบบ
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
