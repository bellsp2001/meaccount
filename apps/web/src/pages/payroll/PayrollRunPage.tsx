import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Employee { id: string; employee_code: string; full_name: string; base_salary: number; status: string }
interface Payslip {
  id: string; number: string; employee_id: string; employee?: Employee
  period_month: number; period_year: number; pay_date: string; status: string
  base_salary: number; gross_pay: number; sso_employee: number
  withholding_tax: number; total_deduction: number; net_pay: number; gl_posted: boolean
}

const MONTHS_TH = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Draft',      color: '#F5A623' },
  approved: { label: 'อนุมัติแล้ว', color: 'var(--color-accent-light)' },
  paid:     { label: 'จ่ายแล้ว',   color: '#43E97B' },
  cancelled:{ label: 'ยกเลิก',      color: '#FF6B6B' },
}

export default function PayrollRunPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [payDate, setPayDate] = useState(new Date(year, month, 0).toISOString().split('T')[0])
  const [showConfirm, setShowConfirm] = useState(false)
  const [viewSlip, setViewSlip] = useState<Payslip | null>(null)
  const [showTaxCheck, setShowTaxCheck] = useState<Payslip | null>(null)

  const { data: payslips = [], isLoading } = useQuery<Payslip[]>({
    queryKey: ['payslips', month, year],
    queryFn: async () => (await api.get(`/api/v1/payroll/payslips?period_month=${month}&period_year=${year}`)).data,
  })
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ['employees'], queryFn: async () => (await api.get('/api/v1/payroll/employees')).data })
  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: async () => (await api.get(`/api/v1/payroll/summary?year=${year}&month=${month}`)).data,
  })

  const runM = useMutation({
    mutationFn: () => api.post('/api/v1/payroll/run', { period_month: month, period_year: year, pay_date: payDate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payslips'] }); qc.invalidateQueries({ queryKey: ['payroll-summary'] }); setShowConfirm(false) },
  })
  const approveM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/payroll/payslips/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payslips'] }),
  })
  const postGLM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/payroll/payslips/${id}/post-gl`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payslips'] }); setViewSlip(null) },
  })

  const activeEmployees = employees.filter(e => e.status === 'active')
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 460 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ประมวลผลเงินเดือน</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Payroll Run — งวด {MONTHS_TH[month]} {year + 543}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 9, padding: '8px 12px', fontSize: 12, color: 'var(--color-text)', cursor: 'pointer' }}>
            {MONTHS_TH.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 9, padding: '8px 12px', fontSize: 12, color: 'var(--color-text)', cursor: 'pointer' }}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y + 543}</option>)}
          </select>
          <button onClick={() => setShowConfirm(true)} disabled={activeEmployees.length === 0}
            style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer', opacity: activeEmployees.length === 0 ? 0.5 : 1 }}>
            ▶ ประมวลผลเงินเดือน
          </button>
        </div>
      </div>

      {/* Summary KPI */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
          {[
            { l: 'พนักงาน', v: summary.employee_count, color: 'var(--color-accent-light)' },
            { l: 'เงินเดือนรวม', v: `฿${Number(summary.total_gross).toLocaleString('th-TH')}`, color: '#F2714E' },
            { l: 'จ่ายสุทธิ', v: `฿${Number(summary.total_net).toLocaleString('th-TH')}`, color: '#43E97B' },
            { l: 'ประกันสังคม (รวม)', v: `฿${(Number(summary.total_sso_employee) + Number(summary.total_sso_employer)).toLocaleString('th-TH')}`, color: '#F5A623' },
            { l: 'ภาษีหัก ณ ที่จ่าย', v: `฿${Number(summary.total_wht).toLocaleString('th-TH')}`, color: '#F093FB' },
          ].map(s => (
            <div key={s.l} style={{ background: 'var(--color-card)', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '12px 14px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 9, color: 'var(--color-muted)' }}>{s.l}</p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: s.color }}>{s.v}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        : payslips.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>💰</p>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีสลิปเงินเดือนสำหรับงวดนี้</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่สลิป', 'พนักงาน', 'เงินเดือน', 'ประกันสังคม', 'ภาษี', 'จ่ายสุทธิ', 'สถานะ', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payslips.map(ps => {
                const sm = STATUS_META[ps.status] || STATUS_META.draft
                const emp = employees.find(e => e.id === ps.employee_id)
                return (
                  <tr key={ps.id} onClick={() => setViewSlip(ps)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: 'monospace', fontSize: 11, color: 'var(--color-accent-light)' }}>{ps.number}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12 }}>{emp?.full_name || '—'}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace' }}>฿{Number(ps.gross_pay).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', color: '#F5A623' }}>-฿{Number(ps.sso_employee).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', color: '#F093FB' }}>-฿{Number(ps.withholding_tax).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#43E97B' }}>฿{Number(ps.net_pay).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color + '18', border: `1px solid ${sm.color}35`, padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {ps.status === 'draft' && <button onClick={() => approveM.mutate(ps.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #FFB59E40', background: '#FFB59E12', color: 'var(--color-accent-light)', cursor: 'pointer', fontWeight: 700 }}>อนุมัติ</button>}
                        {!ps.gl_posted && ps.status === 'approved' && <button onClick={() => postGLM.mutate(ps.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #F5A62340', background: '#F5A62312', color: '#F5A623', cursor: 'pointer', fontWeight: 700 }}>Post GL</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CONFIRM RUN MODAL */}
      {showConfirm && (
        <div style={overlay} onClick={() => setShowConfirm(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '28px', textAlign: 'center' }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>💰</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>ยืนยันการประมวลผลเงินเดือน</h3>
              <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>งวด {MONTHS_TH[month]} {year + 543}</p>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>พนักงาน {activeEmployees.length} คน</p>
              <div style={{ marginBottom: 20, textAlign: 'left' }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>วันที่จ่าย</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                  style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ background: '#F2714E08', border: '1px solid #F2714E20', borderRadius: 10, padding: '12px 16px', marginBottom: 20, textAlign: 'left' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#F2714E' }}>✦ ระบบจะคำนวณเงินเดือน, ประกันสังคม, และภาษีหัก ณ ที่จ่ายอัตโนมัติสำหรับทุกคน</p>
              </div>
              {runM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px', marginBottom: 16, textAlign: 'left' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — อาจมีสลิปงวดนี้อยู่แล้ว</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setShowConfirm(false)} style={{ padding: '10px 24px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={() => runM.mutate()} disabled={runM.isPending}
                  style={{ padding: '10px 24px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', cursor: 'pointer', fontWeight: 800, fontSize: 13, opacity: runM.isPending ? 0.7 : 1 }}>
                  {runM.isPending ? 'กำลังประมวลผล...' : '✓ ยืนยันประมวลผล'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PAYSLIP DETAIL MODAL */}
      {viewSlip && (
        <div style={overlay} onClick={() => setViewSlip(null)}>
          <div style={{ ...modal, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--color-accent-light)' }}>{viewSlip.number}</h3><p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>{employees.find(e => e.id === viewSlip.employee_id)?.full_name}</p></div>
              <button onClick={() => setViewSlip(null)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ margin: '0 0 12px', fontSize: 10, fontWeight: 700, color: '#43E97B', textTransform: 'uppercase' }}>รายรับ</p>
              {[
                ['เงินเดือนพื้นฐาน', viewSlip.base_salary],
                ['รวมรายรับ', viewSlip.gross_pay],
              ].map(([l, v], i) => (
                <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, fontWeight: i === 1 ? 700 : 400, borderTop: i === 1 ? '1px solid var(--color-border)' : 'none', marginTop: i === 1 ? 4 : 0 }}>
                  <span style={{ color: i === 1 ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{l}</span>
                  <span style={{ color: '#43E97B', fontFamily: 'monospace' }}>฿{Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
              <p style={{ margin: '18px 0 12px', fontSize: 10, fontWeight: 700, color: '#FF6B6B', textTransform: 'uppercase' }}>รายการหัก</p>
              {[
                ['ประกันสังคม (5%)', viewSlip.sso_employee],
                ['ภาษีหัก ณ ที่จ่าย', viewSlip.withholding_tax],
                ['รวมรายการหัก', viewSlip.total_deduction],
              ].map(([l, v], i) => (
                <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, fontWeight: i === 2 ? 700 : 400, borderTop: i === 2 ? '1px solid var(--color-border)' : 'none', marginTop: i === 2 ? 4 : 0 }}>
                  <span style={{ color: i === 2 ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{l}</span>
                  <span style={{ color: '#FF6B6B', fontFamily: 'monospace' }}>-฿{Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
              <div style={{ marginTop: 18, background: '#F2714E10', border: '1px solid #F2714E30', borderRadius: 10, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>รับสุทธิ</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#F2714E', fontFamily: 'monospace' }}>฿{Number(viewSlip.net_pay).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
              </div>
              {viewSlip.status === 'approved' && !viewSlip.gl_posted && (
                <button onClick={() => postGLM.mutate(viewSlip.id)} style={{ marginTop: 16, width: '100%', background: '#F5A623', color: '#141018', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                  ✓ Post GL & จ่ายเงิน
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
