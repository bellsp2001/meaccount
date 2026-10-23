import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Company { id: string; code: string; name: string; name_en?: string; tax_id?: string; is_active: boolean; parent_company_id?: string }

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function CompaniesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', name_en: '', tax_id: '', address: '' })

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/api/v1/companies/')).data,
  })

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/companies/', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); setShowCreate(false); setForm({ code: '', name: '', name_en: '', tax_id: '', address: '' }) },
  })

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 480 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>บริษัทในเครือ</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>Multi-Company — {companies.length} บริษัท</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + เพิ่มบริษัท
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
        {isLoading ? <p style={{ color: 'var(--color-dim)' }}>กำลังโหลด...</p>
        : companies.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 48, textAlign: 'center', background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14 }}>
            <p style={{ color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีบริษัทในระบบ</p>
          </div>
        ) : companies.map(co => (
          <div key={co.id} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-accent-light)', background: '#FFB59E15', padding: '2px 8px', borderRadius: 10 }}>{co.code}</span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: co.is_active ? '#43E97B' : '#FF6B6B' }} />
            </div>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{co.name}</p>
            {co.name_en && <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-muted)' }}>{co.name_en}</p>}
            {co.tax_id && <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>เลขภาษี: {co.tax_id}</p>}
          </div>
        ))}
      </div>

      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>เพิ่มบริษัทใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><label style={lbl}>รหัสบริษัท *</label><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="CO-01" style={inp} /></div>
                <div><label style={lbl}>ชื่อบริษัท *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="บริษัท ตัวอย่าง จำกัด" style={inp} /></div>
              </div>
              <div><label style={lbl}>ชื่อ (อังกฤษ)</label><input value={form.name_en} onChange={e => setForm({ ...form, name_en: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>เลขผู้เสียภาษี</label><input value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>ที่อยู่</label><textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — รหัสบริษัทอาจซ้ำ</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreate(false)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 12 }}>ยกเลิก</button>
                <button onClick={() => createM.mutate()} disabled={!form.code || !form.name || createM.isPending}
                  style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 12, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer' }}>
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
