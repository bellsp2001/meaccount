import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

interface Product {
  id: string; sku: string; name: string; name_en?: string; unit: string
  cost_method: 'fifo' | 'avco'; sale_price: number; reorder_point: number
  reorder_qty: number; is_active: boolean; track_stock: boolean
  qty_on_hand: number; avg_cost: number; stock_value: number; is_low_stock: boolean
}

const schema = z.object({
  sku: z.string().min(1, 'ระบุ SKU'),
  name: z.string().min(2, 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'),
  name_en: z.string().optional(),
  unit: z.string().min(1),
  cost_method: z.enum(['fifo', 'avco']),
  sale_price: z.number().min(0),
  reorder_point: z.number().min(0),
  reorder_qty: z.number().min(0),
})
type PForm = z.infer<typeof schema>

const inp: React.CSSProperties = { width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }

export default function ProductsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [showForecast, setShowForecast] = useState<Product | null>(null)

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', search, lowStockOnly],
    queryFn: async () => (await api.get(`/api/v1/inventory/products?${search ? `search=${search}&` : ''}low_stock_only=${lowStockOnly}`)).data,
  })

  const createM = useMutation({
    mutationFn: (d: PForm) => api.post('/api/v1/inventory/products', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setShowCreate(false); reset() },
  })

  const { data: forecast } = useQuery({
    queryKey: ['forecast', showForecast?.id],
    queryFn: async () => (await api.get(`/api/v1/inventory/ai/forecast/${showForecast!.id}`)).data,
    enabled: !!showForecast,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PForm>({
    resolver: zodResolver(schema),
    defaultValues: { unit: 'ชิ้น', cost_method: 'fifo', sale_price: 0, reorder_point: 0, reorder_qty: 0 },
  })

  const totalValue = products.reduce((s, p) => s + Number(p.stock_value || 0), 0)
  const lowStockCount = products.filter(p => p.is_low_stock).length

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties  = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>สินค้าคงคลัง</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>ทั้งหมด {products.length} SKU</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>
          + เพิ่มสินค้า
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
        {[
          { l: 'มูลค่าสต็อกรวม', v: `฿${totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: '#43E97B' },
          { l: 'สินค้าใกล้หมด', v: lowStockCount, color: '#FF6B6B' },
          { l: 'SKU ทั้งหมด', v: products.length, color: 'var(--color-accent-light)' },
        ].map(s => (
          <div key={s.l} style={{ background: 'var(--color-card)', border: `1px solid ${s.color}20`, borderTop: `2px solid ${s.color}`, borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)' }}>{s.l}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  ค้นหาชื่อสินค้าหรือ SKU..."
          style={{ flex: 1, minWidth: 200, background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: 'var(--color-text)', outline: 'none' }} />
        <button onClick={() => setLowStockOnly(v => !v)}
          style={{ background: lowStockOnly ? '#FF6B6B15' : 'var(--color-card)', border: `1px solid ${lowStockOnly ? '#FF6B6B50' : 'var(--color-border)'}`, color: lowStockOnly ? '#FF6B6B' : 'var(--color-text-tertiary)', borderRadius: 9, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          ⚠ ใกล้หมดเท่านั้น
        </button>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-dim)' }}>กำลังโหลด...</div>
        : products.length === 0 ? <div style={{ padding: 52, textAlign: 'center', color: 'var(--color-dim)', fontSize: 13 }}>ยังไม่มีสินค้า</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['SKU', 'ชื่อสินค้า', 'คงเหลือ', 'ต้นทุนเฉลี่ย', 'มูลค่า', 'Cost Method', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: 'monospace', fontSize: 12, color: 'var(--color-accent-light)' }}>{p.sku}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{p.name}</p>
                    {p.is_low_stock && <span style={{ fontSize: 9, color: '#FF6B6B', fontWeight: 700 }}>⚠ ใกล้หมด</span>}
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: p.is_low_stock ? '#FF6B6B' : '#43E97B' }}>
                    {Number(p.qty_on_hand).toLocaleString('th-TH')} {p.unit}
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>฿{Number(p.avg_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#43E97B' }}>฿{Number(p.stock_value).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: p.cost_method === 'fifo' ? '#F5A623' : '#667EEA', background: p.cost_method === 'fifo' ? '#F5A62318' : '#667EEA18', border: `1px solid ${p.cost_method === 'fifo' ? '#F5A62335' : '#667EEA35'}`, padding: '2px 8px', borderRadius: 10 }}>
                      {p.cost_method.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <button onClick={() => setShowForecast(p)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #F2714E40', background: '#F2714E12', color: '#F2714E', cursor: 'pointer', fontWeight: 700 }}>🤖 พยากรณ์</button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>เพิ่มสินค้าใหม่</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createM.mutate(d))} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><label style={lbl}>SKU *</label><input {...register('sku')} placeholder="P001" style={inp} />{errors.sku && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.sku.message}</p>}</div>
                <div><label style={lbl}>ชื่อสินค้า *</label><input {...register('name')} placeholder="กระดาษ A4" style={inp} />{errors.name && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#FF6B6B' }}>{errors.name.message}</p>}</div>
              </div>
              <div><label style={lbl}>ชื่อ (อังกฤษ)</label><input {...register('name_en')} placeholder="A4 Paper" style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>หน่วยนับ</label><input {...register('unit')} placeholder="ชิ้น" style={inp} /></div>
                <div>
                  <label style={lbl}>วิธีคำนวณต้นทุน</label>
                  <select {...register('cost_method')} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="fifo">FIFO (เข้าก่อนออกก่อน)</option>
                    <option value="avco">AVCO (ต้นทุนเฉลี่ย)</option>
                  </select>
                </div>
              </div>
              <div><label style={lbl}>ราคาขาย (บาท)</label><input {...register('sale_price', { valueAsNumber: true })} type="number" min="0" step="0.01" style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>จุดสั่งซื้อ (Reorder Point)</label><input {...register('reorder_point', { valueAsNumber: true })} type="number" min="0" style={inp} /></div>
                <div><label style={lbl}>ปริมาณสั่งซื้อแนะนำ</label><input {...register('reorder_qty', { valueAsNumber: true })} type="number" min="0" style={inp} /></div>
              </div>
              {createM.isError && <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 8, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>เกิดข้อผิดพลาด — SKU อาจซ้ำ</p></div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>ยกเลิก</button>
                <button type="submit" disabled={createM.isPending} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '9px 20px', cursor: 'pointer', opacity: createM.isPending ? 0.7 : 1 }}>
                  {createM.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FORECAST MODAL */}
      {showForecast && (
        <div style={overlay} onClick={() => setShowForecast(null)}>
          <div style={{ ...modal, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>🤖</span>
                <div><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI พยากรณ์ความต้องการ</h3><p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)' }}>{showForecast.name}</p></div>
              </div>
              <button onClick={() => setShowForecast(null)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              {!forecast ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-dim)' }}>กำลังวิเคราะห์...</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: 'var(--color-bg-inset)', borderRadius: 10, padding: '14px' }}>
                      <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)' }}>สต็อกปัจจุบัน</p>
                      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#43E97B' }}>{Number(forecast.current_stock).toLocaleString('th-TH')}</p>
                    </div>
                    <div style={{ background: 'var(--color-bg-inset)', borderRadius: 10, padding: '14px' }}>
                      <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--color-muted)' }}>เบิกเฉลี่ย/วัน</p>
                      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-accent-light)' }}>{forecast.avg_daily_usage}</p>
                    </div>
                  </div>

                  {forecast.days_of_stock_left != null && (
                    <div style={{ background: forecast.days_of_stock_left <= 14 ? '#FF6B6B10' : '#43E97B10', border: `1px solid ${forecast.days_of_stock_left <= 14 ? '#FF6B6B30' : '#43E97B30'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: forecast.days_of_stock_left <= 14 ? '#FF6B6B' : '#43E97B' }}>
                        สต็อกจะหมดใน ~{forecast.days_of_stock_left} วัน
                      </p>
                    </div>
                  )}

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>คาดการณ์ความต้องการ</p>
                    {[['30 วัน', forecast.forecast_30d], ['60 วัน', forecast.forecast_60d], ['90 วัน', forecast.forecast_90d]].map(([label, val]) => (
                      <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
                        <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{Number(val).toLocaleString('th-TH')} หน่วย</span>
                      </div>
                    ))}
                  </div>

                  {forecast.reorder_recommended && (
                    <div style={{ background: '#F5A62310', border: '1px solid #F5A62330', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
                      <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#F5A623' }}>💡 แนะนำสั่งซื้อเพิ่ม</p>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#F5A623' }}>{Number(forecast.recommended_qty).toLocaleString('th-TH')} หน่วย</p>
                    </div>
                  )}

                  <div style={{ background: '#F2714E08', border: '1px solid #F2714E20', borderRadius: 10, padding: '12px 14px' }}>
                    <p style={{ margin: '0 0 4px', fontSize: 10, color: '#F2714E', fontWeight: 700 }}>✦ AI Confidence: {Math.round(forecast.confidence * 100)}%</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>{forecast.explanation}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
