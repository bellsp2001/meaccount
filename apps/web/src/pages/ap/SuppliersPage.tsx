import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

interface Supplier {
  id: string; code: string; name: string; name_en?: string; tax_id?: string
  address?: string; phone?: string; email?: string; contact_name?: string
  payment_terms: number; bank_name?: string; bank_account?: string
  bank_branch?: string; wht_type?: string; is_active: boolean
}

const schema = z.object({
  code:          z.string().min(1, 'ระบุรหัสผู้จำหน่าย'),
  name:          z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  name_en:       z.string().optional(),
  tax_id:        z.string().optional(),
  branch_code:   z.string().optional(),
  address:       z.string().optional(),
  phone:         z.string().optional(),
  email:         z.string().email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
  contact_name:  z.string().optional(),
  payment_terms: z.number().min(0).max(365),
  bank_name:     z.string().optional(),
  bank_account:  z.string().optional(),
  bank_branch:   z.string().optional(),
  wht_type:      z.string().optional(),
})
type SForm = z.infer<typeof schema>

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function SuppliersPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [search, setSearch] = useState('')

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/api/v1/ap/suppliers')).data,
  })

  const createM = useMutation({
    mutationFn: (d: SForm) => api.post('/api/v1/ap/suppliers', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setShowCreate(false); reset() },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SForm>({
    resolver: zodResolver(schema),
    defaultValues: { payment_terms: 30, branch_code: '00000' },
  })

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.toLowerCase().includes(search.toLowerCase()) ||
    (s.tax_id || '').includes(search)
  )

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties   = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>รายชื่อผู้จำหน่าย</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>Suppliers — ทั้งหมด {suppliers.length} ราย</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + เพิ่มผู้จำหน่าย
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
        {[
          { label: 'ผู้จำหน่ายทั้งหมด', value: suppliers.length,                                    color: '#F093FB' },
          { label: 'Active',            value: suppliers.filter(s => s.is_active).length,           color: '#43E97B' },
          { label: 'มีข้อมูลธนาคาร',   value: suppliers.filter(s => s.bank_account).length,        color: '#4FACFE' },
          { label: 'มีการหัก WHT',     value: suppliers.filter(s => s.wht_type).length,            color: '#F5A623' },
        ].map(s => (
          <div key={s.label} style={{ background: '#0D1018', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '12px 14px' }}>
            <p style={{ margin: '0 0 3px', fontSize: 10, color: '#4A5A70' }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  ค้นหาชื่อ, รหัส, เลขผู้เสียภาษี..."
        style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: '#DDE3EE', outline: 'none', width: '100%', boxSizing: 'border-box' }} />

      {/* Selected detail */}
      {selected && (
        <div style={{ background: '#F093FB10', border: '1px solid #F093FB30', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>{selected.name}</p>
              <p style={{ margin: 0, fontSize: 12, color: '#5A6A80' }}>รหัส: {selected.code}{selected.tax_id ? ` · เลขภาษี: ${selected.tax_id}` : ''}</p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>เครดิต</p><p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{selected.payment_terms} วัน</p></div>
              {selected.bank_account && <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>บัญชีธนาคาร</p><p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{selected.bank_name} {selected.bank_account}</p></div>}
              {selected.wht_type && <div style={{ textAlign: 'center' }}><p style={{ margin: '0 0 2px', fontSize: 10, color: '#4A5A70' }}>WHT</p><p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#F5A623' }}>{selected.wht_type}</p></div>}
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          {selected.address && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#5A6A80' }}>📍 {selected.address}</p>}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
        : filtered.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>ไม่พบผู้จำหน่าย</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['รหัส', 'ชื่อผู้จำหน่าย', 'เลขผู้เสียภาษี', 'ติดต่อ', 'เครดิต', 'ธนาคาร', 'WHT'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #151C28' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontFamily: 'monospace', fontSize: 12, color: '#F093FB' }}>{s.code}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{s.name}</p>
                    {s.name_en && <p style={{ margin: 0, fontSize: 11, color: '#4A5A70' }}>{s.name_en}</p>}
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#6A7A90', fontFamily: 'monospace' }}>{s.tax_id || '—'}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>
                    {s.contact_name && <p style={{ margin: 0 }}>{s.contact_name}</p>}
                    {s.phone && <p style={{ margin: 0 }}>{s.phone}</p>}
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 12, color: '#F5A623' }}>{s.payment_terms} วัน</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#4A5A70' }}>
                    {s.bank_account ? <span style={{ color: '#4FACFE' }}>{s.bank_name}</span> : '—'}
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #0F1520', fontSize: 11 }}>
                    {s.wht_type ? <span style={{ color: '#F5A623', fontWeight: 700 }}>{s.wht_type}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #151C28' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>เพิ่มผู้จำหน่ายใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><label style={lbl}>รหัส *</label><input {...register('code')} placeholder="S001" style={inp} />{errors.code && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.code.message}</p>}</div>
                <div><label style={lbl}>ชื่อ (ไทย) *</label><input {...register('name')} placeholder="บริษัท ซัพพลายเออร์ จำกัด" style={inp} />{errors.name && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.name.message}</p>}</div>
              </div>
              <div><label style={lbl}>ชื่อ (อังกฤษ)</label><input {...register('name_en')} placeholder="Supplier Co., Ltd." style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>เลขประจำตัวผู้เสียภาษี</label><input {...register('tax_id')} placeholder="0105555000001" style={inp} /></div>
                <div><label style={lbl}>รหัสสาขา</label><input {...register('branch_code')} placeholder="00000" style={inp} /></div>
              </div>
              <div><label style={lbl}>ที่อยู่</label><textarea {...register('address')} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>โทรศัพท์</label><input {...register('phone')} placeholder="02-XXX-XXXX" style={inp} /></div>
                <div><label style={lbl}>อีเมล</label><input {...register('email')} type="email" placeholder="ap@supplier.com" style={inp} />{errors.email && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.email.message}</p>}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>ชื่อผู้ติดต่อ</label><input {...register('contact_name')} style={inp} /></div>
                <div><label style={lbl}>เครดิต (วัน)</label><input {...register('payment_terms', { valueAsNumber: true })} type="number" min="0" placeholder="30" style={inp} /></div>
              </div>
              {/* Bank */}
              <div style={{ borderTop: '1px solid #151C28', paddingTop: 14 }}>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#4A5A70' }}>ข้อมูลธนาคาร (สำหรับโอนเงิน)</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={lbl}>ธนาคาร</label><input {...register('bank_name')} placeholder="ธ.กรุงเทพ" style={inp} /></div>
                  <div><label style={lbl}>เลขบัญชี</label><input {...register('bank_account')} placeholder="123-4-56789-0" style={inp} /></div>
                </div>
                <div style={{ marginTop: 12 }}><label style={lbl}>สาขา</label><input {...register('bank_branch')} placeholder="สาขาสยาม" style={inp} /></div>
              </div>
              <div>
                <label style={lbl}>ประเภทภาษีหัก ณ ที่จ่าย</label>
                <select {...register('wht_type')} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">ไม่หัก ณ ที่จ่าย</option>
                  <option value="3%">3% (บริการ)</option>
                  <option value="5%">5% (ค่าเช่า)</option>
                  <option value="1%">1% (ขนส่ง)</option>
                </select>
              </div>
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — รหัสอาจซ้ำ</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
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
