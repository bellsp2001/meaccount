import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

interface Employee {
  id: string; employee_code: string; full_name: string; position?: string
  department?: string; start_date: string; status: string
  marital_status: string; num_children: number; base_salary: number
  bank_name?: string; bank_account?: string; email?: string; phone?: string; sso_enrolled: boolean
}

const schema = z.object({
  employee_code: z.string().min(1, 'ระบุรหัสพนักงาน'),
  full_name:     z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  national_id:   z.string().optional(),
  position:      z.string().optional(),
  department:    z.string().optional(),
  start_date:    z.string().min(1),
  marital_status:z.enum(['single', 'married']),
  num_children:  z.number().min(0).max(10),
  base_salary:   z.number().min(1, 'เงินเดือนต้องมากกว่า 0'),
  bank_name:     z.string().optional(),
  bank_account:  z.string().optional(),
  email:         z.string().email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
  phone:         z.string().optional(),
  sso_enrolled:  z.boolean(),
})
type EForm = z.infer<typeof schema>

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:     { label: 'ทำงานอยู่',   color: '#43E97B' },
  on_leave:   { label: 'ลาพัก',       color: '#F5A623' },
  terminated: { label: 'พ้นสภาพ',    color: '#FF6B6B' },
}

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function EmployeesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/v1/payroll/employees')).data,
  })

  const createM = useMutation({
    mutationFn: (d: EForm) => api.post('/api/v1/payroll/employees', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setShowCreate(false); reset() },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EForm>({
    resolver: zodResolver(schema),
    defaultValues: { marital_status: 'single', num_children: 0, sso_enrolled: true, start_date: new Date().toISOString().split('T')[0] },
  })

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_code.toLowerCase().includes(search.toLowerCase())
  )

  const totalPayroll = employees.filter(e => e.status === 'active').reduce((s, e) => s + Number(e.base_salary), 0)

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>พนักงาน</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>ทั้งหมด {employees.length} คน</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + เพิ่มพนักงาน
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
        {[
          { l: 'พนักงานทำงาน', v: employees.filter(e => e.status === 'active').length, color: '#43E97B' },
          { l: 'ค่าจ้างรวม/เดือน', v: `฿${totalPayroll.toLocaleString('th-TH')}`, color: '#4FACFE' },
          { l: 'เข้าประกันสังคม', v: employees.filter(e => e.sso_enrolled).length, color: '#F5A623' },
        ].map(s => (
          <div key={s.l} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, color: '#4A5A70' }}>{s.l}</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  ค้นหาชื่อหรือรหัสพนักงาน..."
        style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: '#DDE3EE', outline: 'none', width: '100%', boxSizing: 'border-box' }} />

      {/* Table */}
      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
        : filtered.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>ไม่พบพนักงาน</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['รหัส', 'ชื่อพนักงาน', 'ตำแหน่ง', 'แผนก', 'เงินเดือน', 'สถานะ'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #151C28' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => {
                const sm = STATUS_META[emp.status] || STATUS_META.active
                return (
                  <tr key={emp.id}>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontFamily: 'monospace', fontSize: 12, color: '#4FACFE' }}>{emp.employee_code}</td>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520' }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{emp.full_name}</p>
                      <p style={{ margin: 0, fontSize: 10, color: '#4A5A70' }}>{emp.marital_status === 'married' ? '💍 สมรส' : '👤 โสด'}{emp.num_children > 0 ? ` · บุตร ${emp.num_children} คน` : ''}</p>
                    </td>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#8A9BB0' }}>{emp.position || '—'}</td>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#8A9BB0' }}>{emp.department || '—'}</td>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#43E97B' }}>฿{Number(emp.base_salary).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color + '18', border: `1px solid ${sm.color}35`, padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #151C28' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>เพิ่มพนักงานใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><label style={lbl}>รหัสพนักงาน *</label><input {...register('employee_code')} placeholder="EMP001" style={inp} />{errors.employee_code && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.employee_code.message}</p>}</div>
                <div><label style={lbl}>ชื่อ-นามสกุล *</label><input {...register('full_name')} placeholder="สมชาย ใจดี" style={inp} />{errors.full_name && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.full_name.message}</p>}</div>
              </div>
              <div><label style={lbl}>เลขบัตรประชาชน</label><input {...register('national_id')} placeholder="1-2345-67890-12-3" style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>ตำแหน่ง</label><input {...register('position')} placeholder="Senior Developer" style={inp} /></div>
                <div><label style={lbl}>แผนก</label><input {...register('department')} placeholder="IT / Accounting" style={inp} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>วันเริ่มงาน</label><input {...register('start_date')} type="date" style={inp} /></div>
                <div><label style={lbl}>เงินเดือน (บาท) *</label><input {...register('base_salary', { valueAsNumber: true })} type="number" min="0" style={inp} />{errors.base_salary && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.base_salary.message}</p>}</div>
              </div>
              {/* Tax info */}
              <div style={{ borderTop: '1px solid #151C28', paddingTop: 14 }}>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#4A5A70' }}>ข้อมูลสำหรับคำนวณภาษี</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>สถานภาพสมรส</label>
                    <select {...register('marital_status')} style={{ ...inp, cursor: 'pointer' }}>
                      <option value="single">โสด</option>
                      <option value="married">สมรส</option>
                    </select>
                  </div>
                  <div><label style={lbl}>จำนวนบุตร</label><input {...register('num_children', { valueAsNumber: true })} type="number" min="0" max="10" style={inp} /></div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" {...register('sso_enrolled')} id="sso" style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="sso" style={{ fontSize: 12, color: '#8A9BB0', cursor: 'pointer' }}>เข้าประกันสังคม (หัก 5%, สูงสุด 750 บาท/เดือน)</label>
                </div>
              </div>
              {/* Bank */}
              <div style={{ borderTop: '1px solid #151C28', paddingTop: 14 }}>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#4A5A70' }}>ข้อมูลธนาคาร</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={lbl}>ธนาคาร</label><input {...register('bank_name')} placeholder="ธ.กสิกรไทย" style={inp} /></div>
                  <div><label style={lbl}>เลขบัญชี</label><input {...register('bank_account')} placeholder="123-4-56789-0" style={inp} /></div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>อีเมล</label><input {...register('email')} type="email" style={inp} />{errors.email && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.email.message}</p>}</div>
                <div><label style={lbl}>โทรศัพท์</label><input {...register('phone')} style={inp} /></div>
              </div>
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — รหัสพนักงานอาจซ้ำ</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid #1E2A3A', background: 'transparent', color: '#6A7A90', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer', opacity: createM.isPending ? 0.7 : 1 }}>
                  {createM.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
