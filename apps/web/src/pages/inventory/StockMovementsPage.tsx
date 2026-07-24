import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Product   { id: string; sku: string; name: string; unit: string; qty_on_hand: number }
interface Warehouse  { id: string; code: string; name: string }
interface Movement {
  id: string; number: string; product_id: string; warehouse_id: string
  movement_type: string; date: string; quantity: number
  unit_cost?: number; total_cost?: number; reference?: string; note?: string; gl_posted: boolean
}

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  receive:    { label: 'รับเข้า',       color: '#43E97B', icon: '⬇' },
  issue:      { label: 'จ่ายออก',       color: '#F093FB', icon: '⬆' },
  adjust_in:  { label: 'ปรับปรุงเพิ่ม', color: '#4FACFE', icon: '＋' },
  adjust_out: { label: 'ปรับปรุงลด',   color: '#FF6B6B', icon: '－' },
  transfer:   { label: 'โอนย้าย',       color: '#F5A623', icon: '⇄' },
}

const inp: React.CSSProperties = { width: '100%', background: '#070A0F', border: '1px solid #151C28', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function StockMovementsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'receive' | 'issue' | 'adjust'>('receive')
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState('all')

  const { data: movements = [], isLoading } = useQuery<Movement[]>({
    queryKey: ['movements'],
    queryFn: async () => (await api.get('/api/v1/inventory/movements')).data,
  })
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/v1/inventory/products')).data })
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['warehouses'], queryFn: async () => (await api.get('/api/v1/inventory/warehouses')).data })

  const [form, setForm] = useState({
    product_id: '', warehouse_id: '', date: new Date().toISOString().split('T')[0],
    quantity: '', unit_cost: '', direction: 'in', note: '', reference: '',
  })

  const receiveM = useMutation({
    mutationFn: () => api.post('/api/v1/inventory/movements/receive', {
      product_id: form.product_id, warehouse_id: form.warehouse_id, date: form.date,
      quantity: Number(form.quantity), unit_cost: Number(form.unit_cost), reference: form.reference,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['products'] }); setShowForm(false); resetForm() },
  })
  const issueM = useMutation({
    mutationFn: () => api.post('/api/v1/inventory/movements/issue', {
      product_id: form.product_id, warehouse_id: form.warehouse_id, date: form.date,
      quantity: Number(form.quantity), reference: form.reference,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['products'] }); setShowForm(false); resetForm() },
  })
  const adjustM = useMutation({
    mutationFn: () => api.post('/api/v1/inventory/movements/adjust', {
      product_id: form.product_id, warehouse_id: form.warehouse_id, date: form.date,
      quantity: Number(form.quantity), direction: form.direction,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : undefined, note: form.note,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['products'] }); setShowForm(false); resetForm() },
  })
  const postGLM = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/inventory/movements/${id}/post-gl`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movements'] }),
  })

  function resetForm() {
    setForm({ product_id: '', warehouse_id: '', date: new Date().toISOString().split('T')[0], quantity: '', unit_cost: '', direction: 'in', note: '', reference: '' })
  }

  function handleSubmit() {
    if (tab === 'receive') receiveM.mutate()
    else if (tab === 'issue') issueM.mutate()
    else adjustM.mutate()
  }

  const selectedProduct = products.find(p => p.id === form.product_id)
  const filtered = filterType === 'all' ? movements : movements.filter(m => m.movement_type === filterType)
  const isPending = receiveM.isPending || issueM.isPending || adjustM.isPending
  const isError   = receiveM.isError || issueM.isError || adjustM.isError

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 16, width: '100%', maxWidth: 480 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>รับ / จ่ายสินค้า</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4A5A70' }}>Stock Movements — ทั้งหมด {movements.length} รายการ</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setTab('receive'); setShowForm(true) }} style={{ background: '#43E97B15', border: '1px solid #43E97B40', color: '#43E97B', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>⬇ รับสินค้า</button>
          <button onClick={() => { setTab('issue'); setShowForm(true) }} style={{ background: '#F093FB15', border: '1px solid #F093FB40', color: '#F093FB', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>⬆ จ่ายสินค้า</button>
          <button onClick={() => { setTab('adjust'); setShowForm(true) }} style={{ background: '#4FACFE15', border: '1px solid #4FACFE40', color: '#4FACFE', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>⚙ ปรับปรุง</button>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['all', ...Object.keys(TYPE_META)].map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            style={{ background: filterType === t ? (t === 'all' ? '#00D4AA' : TYPE_META[t].color) : '#0D1018', color: filterType === t ? '#07090E' : '#5A6A80', border: `1px solid ${filterType === t ? 'transparent' : '#151C28'}`, borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {t === 'all' ? 'ทั้งหมด' : TYPE_META[t].label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#0D1018', border: '1px solid #151C28', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#3A4A60' }}>กำลังโหลด...</div>
        : filtered.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: '#3A4A60', fontSize: 13 }}>ยังไม่มีรายการเคลื่อนไหว</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['เลขที่', 'ประเภท', 'สินค้า', 'วันที่', 'จำนวน', 'ต้นทุน', 'มูลค่ารวม', 'GL', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#3A4A60', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #151C28' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const meta = TYPE_META[m.movement_type]
                const product = products.find(p => p.id === m.product_id)
                return (
                  <tr key={m.id}>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontFamily: 'monospace', fontSize: 11, color: '#4FACFE' }}>{m.number}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.color + '18', border: `1px solid ${meta.color}35`, padding: '2px 8px', borderRadius: 10 }}>{meta.icon} {meta.label}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontSize: 12 }}>{product?.name || '—'}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontSize: 11, color: '#6A7A90' }}>{new Date(m.date).toLocaleDateString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{Number(m.quantity).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontSize: 11, fontFamily: 'monospace', color: '#8A9BB0' }}>{m.unit_cost ? `฿${Number(m.unit_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: meta.color }}>{m.total_cost ? `฿${Number(m.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520' }}>
                      {m.gl_posted ? <span style={{ fontSize: 10, color: '#43E97B' }}>✓</span> : <span style={{ fontSize: 10, color: '#3A4A60' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: '1px solid #0F1520' }}>
                      {!m.gl_posted && ['issue', 'adjust_out'].includes(m.movement_type) && (
                        <button onClick={() => postGLM.mutate(m.id)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #F5A62340', background: '#F5A62312', color: '#F5A623', cursor: 'pointer', fontWeight: 700 }}>Post GL</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* FORM MODAL */}
      {showForm && (
        <div style={overlay} onClick={() => setShowForm(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #151C28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                {tab === 'receive' ? '⬇ รับสินค้าเข้าคลัง' : tab === 'issue' ? '⬆ จ่ายสินค้าออก' : '⚙ ปรับปรุงสต็อก'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>สินค้า</label>
                <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- เลือกสินค้า --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name} (คงเหลือ {Number(p.qty_on_hand).toLocaleString('th-TH')} {p.unit})</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>คลังสินค้า</label>
                <select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">-- เลือกคลัง --</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: tab === 'receive' ? '1fr 1fr' : '1fr', gap: 12 }}>
                <div><label style={lbl}>วันที่</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></div>
                {tab === 'receive' && <div><label style={lbl}>ราคาต่อหน่วย</label><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} style={inp} /></div>}
              </div>
              {tab === 'adjust' && (
                <div>
                  <label style={lbl}>ทิศทางการปรับปรุง</label>
                  <select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="in">เพิ่มสต็อก (พบสินค้าเกิน)</option>
                    <option value="out">ลดสต็อก (สินค้าเสียหาย/สูญหาย)</option>
                  </select>
                </div>
              )}
              <div>
                <label style={lbl}>จำนวน{selectedProduct ? ` (${selectedProduct.unit})` : ''}</label>
                <input type="number" min="0" step="0.01" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} style={{ ...inp, fontSize: 16, fontWeight: 700, padding: '11px 14px' }} />
              </div>
              {tab === 'adjust' && form.direction === 'in' && (
                <div><label style={lbl}>ราคาต่อหน่วย (ไม่บังคับ — ใช้ต้นทุนเฉลี่ยถ้าไม่ระบุ)</label><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} style={inp} /></div>
              )}
              {tab !== 'adjust' && <div><label style={lbl}>เลขที่อ้างอิง</label><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="PO/SO Number" style={inp} /></div>}
              {tab === 'adjust' && <div><label style={lbl}>เหตุผล *</label><textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2} placeholder="ระบุเหตุผลการปรับปรุง" style={{ ...inp, resize: 'vertical' }} /></div>}

              {isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — ตรวจสอบจำนวนสต็อกคงเหลือ</p></div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button onClick={() => setShowForm(false)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid #1E2A3A', background: 'transparent', color: '#6A7A90', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={handleSubmit} disabled={isPending || !form.product_id || !form.warehouse_id || !form.quantity}
                  style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '9px 22px', cursor: 'pointer', opacity: isPending ? 0.7 : 1 }}>
                  {isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
