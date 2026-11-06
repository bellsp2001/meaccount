import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface WHTCert {
  id: string; number: string; wht_type: string; payer_name: string
  payee_name: string; payee_tax_id?: string; income_type: string
  payment_date: string; gross_amount: number; wht_rate: number; wht_amount: number; status: string
}

const TYPE_LABEL: Record<string, string> = { pnd1: 'ภงด.1 (เงินเดือน)', pnd3: 'ภงด.3 (บุคคลธรรมดา)', pnd53: 'ภงด.53 (นิติบุคคล)' }
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#F5A623' }, issued: { label: 'ออกแล้ว', color: 'var(--color-accent-light)' }, filed: { label: 'ยื่นแล้ว', color: '#43E97B' },
}

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function WHTCertificatesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkMonth, setBulkMonth] = useState(new Date().getMonth() + 1)
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear())
  const [payerName, setPayerName] = useState('บริษัท มีบัญชี จำกัด')
  const [payerTaxId, setPayerTaxId] = useState('')

  const { data: certs = [], isLoading } = useQuery<WHTCert[]>({
    queryKey: ['wht-certs'],
    queryFn: async () => (await api.get('/api/v1/tax/wht-certificates')).data,
  })

  const [form, setForm] = useState({
    wht_type: 'pnd53', payer_name: 'บริษัท มีบัญชี จำกัด', payer_tax_id: '',
    payee_name: '', payee_tax_id: '', payee_address: '', income_type: '',
    payment_date: new Date().toISOString().split('T')[0], gross_amount: '', wht_rate: '3',
  })

  const createM = useMutation({
    mutationFn: () => api.post('/api/v1/tax/wht-certificates', { ...form, gross_amount: Number(form.gross_amount), wht_rate: Number(form.wht_rate) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wht-certs'] }); setShowCreate(false) },
  })
  const bulkM = useMutation({
    mutationFn: () => api.post('/api/v1/tax/wht-certificates/bulk-generate', { period_month: bulkMonth, period_year: bulkYear, payer_name: payerName, payer_tax_id: payerTaxId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wht-certs'] }); setShowBulk(false) },
  })
  const issueM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/tax/wht-certificates/${id}/issue`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wht-certs'] }),
  })

  const totalWHT = certs.reduce((s, c) => s + Number(c.wht_amount), 0)
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>หนังสือรับรองหัก ณ ที่จ่าย</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>ทั้งหมด {certs.length} ฉบับ · รวม ฿{totalWHT.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowBulk(true)} style={{ background: '#F2714E15', border: '1px solid #F2714E40', color: '#F2714E', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
            🤖 สร้างจาก Bills อัตโนมัติ
          </button>
          <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
            + สร้างหนังสือรับรอง
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        : certs.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีหนังสือรับรอง</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่', 'ประเภท', 'ผู้รับเงิน', 'ประเภทเงินได้', 'วันที่จ่าย', 'เงินได้', 'อัตรา', 'ภาษีหัก', 'สถานะ', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {certs.map(c => {
                const sm = STATUS_META[c.status]
                return (
                  <tr key={c.id}>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: 'monospace', fontSize: 11, color: 'var(--color-accent-light)' }}>{c.number}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-secondary)' }}>{TYPE_LABEL[c.wht_type]}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12 }}>{c.payee_name}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-secondary)' }}>{c.income_type}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-tertiary)' }}>{new Date(c.payment_date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace' }}>฿{Number(c.gross_amount).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12 }}>{c.wht_rate}%</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#F5A623' }}>฿{Number(c.wht_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, background: sm.color + '18', border: `1px solid ${sm.color}35`, padding: '2px 8px', borderRadius: 10 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      {c.status === 'draft' && <button onClick={() => issueM.mutate(c.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #FFB59E40', background: '#FFB59E12', color: 'var(--color-accent-light)', cursor: 'pointer', fontWeight: 700 }}>ออกหนังสือ</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* BULK GENERATE MODAL */}
      {showBulk && (
        <div style={overlay} onClick={() => setShowBulk(false)}>
          <div style={{ ...modal, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ fontSize: 20 }}>🤖</span><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>สร้างอัตโนมัติจาก Bills</h3></div>
              <button onClick={() => setShowBulk(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>เดือน</label><select value={bulkMonth} onChange={e => setBulkMonth(Number(e.target.value))} style={{ ...inp, cursor: 'pointer' }}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></div>
                <div><label style={lbl}>ปี</label><input type="number" value={bulkYear} onChange={e => setBulkYear(Number(e.target.value))} style={inp} /></div>
              </div>
              <div><label style={lbl}>ชื่อบริษัท (ผู้จ่ายเงิน)</label><input value={payerName} onChange={e => setPayerName(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>เลขผู้เสียภาษี (บริษัท)</label><input value={payerTaxId} onChange={e => setPayerTaxId(e.target.value)} placeholder="0105555000000" style={inp} /></div>
              <div style={{ background: '#F2714E08', border: '1px solid #F2714E20', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#F2714E' }}>✦ ระบบจะดึง Bills ที่มีภาษีหัก ณ ที่จ่ายในงวดนี้มาสร้างหนังสือรับรองให้อัตโนมัติ</p>
              </div>
              {bulkM.isSuccess && <div style={{ background: '#43E97B10', border: '1px solid #43E97B30', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#43E97B' }}>✓ สร้างสำเร็จ {bulkM.data?.data?.length || 0} ฉบับ</p></div>}
              <button onClick={() => bulkM.mutate()} disabled={bulkM.isPending}
                style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer', opacity: bulkM.isPending ? 0.7 : 1 }}>
                {bulkM.isPending ? 'กำลังสร้าง...' : '🤖 สร้างอัตโนมัติ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE SINGLE MODAL */}
      {showCreate && (
        <div style={overlay} onClick={() => setShowCreate(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>สร้างหนังสือรับรองใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>ประเภทแบบ</label>
                <select value={form.wht_type} onChange={e => setForm({ ...form, wht_type: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="pnd1">ภงด.1 — เงินเดือน</option>
                  <option value="pnd3">ภงด.3 — บุคคลธรรมดา</option>
                  <option value="pnd53">ภงด.53 — นิติบุคคล</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>ชื่อผู้จ่ายเงิน</label><input value={form.payer_name} onChange={e => setForm({ ...form, payer_name: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>เลขผู้เสียภาษี (ผู้จ่าย)</label><input value={form.payer_tax_id} onChange={e => setForm({ ...form, payer_tax_id: e.target.value })} style={inp} /></div>
              </div>
              <div><label style={lbl}>ชื่อผู้รับเงิน *</label><input value={form.payee_name} onChange={e => setForm({ ...form, payee_name: e.target.value })} style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>เลขผู้เสียภาษี (ผู้รับ)</label><input value={form.payee_tax_id} onChange={e => setForm({ ...form, payee_tax_id: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>วันที่จ่ายเงิน</label><input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} style={inp} /></div>
              </div>
              <div><label style={lbl}>ประเภทเงินได้ *</label><input value={form.income_type} onChange={e => setForm({ ...form, income_type: e.target.value })} placeholder="ค่าบริการ, ค่าเช่า, ค่าจ้าง..." style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>จำนวนเงินได้ (บาท) *</label><input type="number" value={form.gross_amount} onChange={e => setForm({ ...form, gross_amount: e.target.value })} style={inp} /></div>
                <div>
                  <label style={lbl}>อัตราหัก (%)</label>
                  <select value={form.wht_rate} onChange={e => setForm({ ...form, wht_rate: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="1">1% (ขนส่ง)</option><option value="2">2%</option><option value="3">3% (บริการ)</option><option value="5">5% (ค่าเช่า)</option>
                  </select>
                </div>
              </div>
              {form.gross_amount && (
                <div style={{ background: '#F5A62310', border: '1px solid #F5A62330', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>ภาษีหัก ณ ที่จ่าย</p>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#F5A623' }}>฿{(Number(form.gross_amount) * Number(form.wht_rate) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
                </div>
              )}
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreate(false)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={() => createM.mutate()} disabled={createM.isPending || !form.payee_name || !form.income_type || !form.gross_amount}
                  style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '9px 22px', cursor: 'pointer', opacity: createM.isPending ? 0.7 : 1 }}>
                  {createM.isPending ? 'กำลังบันทึก...' : 'สร้างหนังสือรับรอง'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
