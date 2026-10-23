import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Warehouse { id: string; code: string; name: string }
interface Shift { id: string; warehouse_id: string; status: string; opening_cash: number; sale_count?: number; total_sales?: number }
interface Product { id: string; sku: string; name: string; sale_price: number; qty_on_hand: number; unit: string }
interface CartLine { product: Product; quantity: number; discount_pct: number }

const fmtB = (n: number) => `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`

export default function POSTerminalPage() {
  const qc = useQueryClient()
  const [warehouseId, setWarehouseId] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [showCloseShift, setShowCloseShift] = useState(false)
  const [openingCash, setOpeningCash] = useState('0')
  const [closingCash, setClosingCash] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit_card' | 'promptpay' | 'bank_transfer'>('cash')
  const [receivedAmount, setReceivedAmount] = useState('')
  const [lastReceipt, setLastReceipt] = useState<any>(null)
  const [scanError, setScanError] = useState('')
  const barcodeRef = useRef<HTMLInputElement>(null)

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'], queryFn: async () => (await api.get('/api/v1/inventory/warehouses')).data,
  })

  const { data: openShift, refetch: refetchShift } = useQuery<Shift | null>({
    queryKey: ['pos-open-shift', warehouseId], enabled: !!warehouseId,
    queryFn: async () => (await api.get(`/api/v1/pos/shifts/open-for-warehouse/${warehouseId}`)).data,
  })

  useEffect(() => { if (warehouses.length && !warehouseId) setWarehouseId(warehouses[0].id) }, [warehouses])
  useEffect(() => { barcodeRef.current?.focus() }, [cart, openShift])

  const openShiftM = useMutation({
    mutationFn: () => api.post('/api/v1/pos/shifts/open', { warehouse_id: warehouseId, opening_cash: Number(openingCash) }),
    onSuccess: () => { refetchShift(); setShowOpenShift(false); setOpeningCash('0') },
  })
  const closeShiftM = useMutation({
    mutationFn: () => api.post(`/api/v1/pos/shifts/${openShift!.id}/close`, { closing_cash_counted: Number(closingCash) }),
    onSuccess: (res) => { refetchShift(); setShowCloseShift(false); setLastReceipt({ type: 'shift-close', data: res.data }) },
  })
  const checkoutM = useMutation({
    mutationFn: () => api.post('/api/v1/pos/sales', {
      shift_id: openShift!.id,
      items: cart.map(l => ({ product_id: l.product.id, quantity: l.quantity, discount_pct: l.discount_pct })),
      payments: [{ method: paymentMethod, amount: total }],
      vat_rate: 7,
    }),
    onSuccess: (res) => {
      setLastReceipt({ type: 'sale', data: res.data })
      setCart([]); setReceivedAmount('')
      qc.invalidateQueries({ queryKey: ['pos-open-shift'] })
    },
  })

  async function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    setScanError('')
    try {
      const { data } = await api.get(`/api/v1/pos/barcode/${encodeURIComponent(barcodeInput.trim())}`)
      addToCart({ id: data.product_id, sku: data.sku, name: data.name, sale_price: data.sale_price, qty_on_hand: data.qty_on_hand, unit: data.unit })
      setBarcodeInput('')
    } catch {
      setScanError(`ไม่พบสินค้า: ${barcodeInput}`)
      setBarcodeInput('')
    }
  }

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(l => l.product.id === product.id)
      if (existing) return prev.map(l => l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l)
      return [...prev, { product, quantity: 1, discount_pct: 0 }]
    })
  }
  function updateQty(productId: string, qty: number) {
    if (qty <= 0) { setCart(prev => prev.filter(l => l.product.id !== productId)); return }
    setCart(prev => prev.map(l => l.product.id === productId ? { ...l, quantity: qty } : l))
  }

  const subtotal = cart.reduce((s, l) => s + l.product.sale_price * l.quantity * (1 - l.discount_pct / 100), 0)
  const vat = subtotal * 0.07
  const total = subtotal + vat
  const change = paymentMethod === 'cash' && receivedAmount ? Math.max(0, Number(receivedAmount) - total) : 0

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }
  const modal: React.CSSProperties = { background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 16, width: '100%', maxWidth: 400 }

  if (!openShift) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: 20 }}>
        <p style={{ fontSize: 48 }}>🏪</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-secondary)' }}>ยังไม่มีกะการขายที่เปิดอยู่</p>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 9, padding: '10px 16px', fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button onClick={() => setShowOpenShift(true)} style={{ background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 14, border: 'none', borderRadius: 10, padding: '12px 28px', cursor: 'pointer' }}>
          ▶ เปิดกะการขาย
        </button>

        {showOpenShift && (
          <div style={overlay} onClick={() => setShowOpenShift(false)}>
            <div style={modal} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>เปิดกะการขาย</h3></div>
              <div style={{ padding: 24 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>เงินสดตั้งต้นในลิ้นชัก</label>
                <input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)}
                  style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 16, color: 'var(--color-text)', marginBottom: 16, boxSizing: 'border-box' }} />
                <button onClick={() => openShiftM.mutate()} disabled={openShiftM.isPending}
                  style={{ width: '100%', background: 'linear-gradient(135deg,#FF9E80,#F2714E)', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                  เริ่มขาย
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, height: 'calc(100vh - 100px)' }}>
      {/* Left: scan + cart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>🏪 POS Terminal</h2><p style={{ margin: 0, fontSize: 11, color: '#43E97B' }}>● กะเปิดอยู่ — ยอดขาย {openShift.sale_count || 0} รายการ</p></div>
          <button onClick={() => setShowCloseShift(true)} style={{ background: '#FF6B6B15', border: '1px solid #FF6B6B40', color: '#FF6B6B', fontWeight: 700, fontSize: 11, borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>ปิดกะ</button>
        </div>

        <form onSubmit={handleBarcodeSubmit}>
          <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
            placeholder="📷 สแกนบาร์โค้ด หรือพิมพ์ SKU แล้วกด Enter..." autoFocus
            style={{ width: '100%', background: 'var(--color-card)', border: '2px solid #F2714E40', borderRadius: 12, padding: '16px 20px', fontSize: 16, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }} />
        </form>
        {scanError && <p style={{ color: '#FF6B6B', fontSize: 12, margin: 0 }}>{scanError}</p>}

        <div style={{ flex: 1, background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 14, overflowY: 'auto', padding: cart.length ? 0 : 40 }}>
          {cart.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--color-dim)', fontSize: 13 }}>ตะกร้าว่าง — สแกนสินค้าเพื่อเริ่มขาย</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {cart.map(line => (
                  <tr key={line.product.id}>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{line.product.name}</p>
                      <p style={{ margin: 0, fontSize: 10, color: 'var(--color-muted)' }}>{fmtB(line.product.sale_price)} × {line.unit}</p>
                    </td>
                    <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => updateQty(line.product.id, line.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-inset)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>−</button>
                        <span style={{ width: 30, textAlign: 'center', fontSize: 13, fontFamily: 'monospace' }}>{line.quantity}</span>
                        <button onClick={() => updateQty(line.product.id, line.quantity + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-inset)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>+</button>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'right', fontSize: 13, fontFamily: 'monospace', fontWeight: 700 }}>
                      {fmtB(line.product.sale_price * line.quantity)}
                    </td>
                    <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <button onClick={() => updateQty(line.product.id, 0)} style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right: checkout panel */}
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700 }}>สรุปรายการ</p>
        <div style={{ flex: 1 }}>
          {[['ยอดรวม', subtotal], ['VAT 7%', vat]].map(([l, v]) => (
            <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <span>{l}</span><span style={{ fontFamily: 'monospace' }}>{fmtB(v as number)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px solid var(--color-border-strong)', marginTop: 8, fontSize: 20, fontWeight: 800 }}>
            <span>รวมทั้งสิ้น</span><span style={{ color: '#F2714E', fontFamily: 'monospace' }}>{fmtB(total)}</span>
          </div>

          <p style={{ margin: '16px 0 8px', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>วิธีชำระเงิน</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[['cash', '💵 เงินสด'], ['credit_card', '💳 บัตร'], ['promptpay', '📱 PromptPay'], ['bank_transfer', '🏦 โอน']].map(([v, l]) => (
              <button key={v} onClick={() => setPaymentMethod(v as any)}
                style={{ background: paymentMethod === v ? '#F2714E15' : 'var(--color-bg-inset)', border: `1px solid ${paymentMethod === v ? '#F2714E50' : 'var(--color-border)'}`, color: paymentMethod === v ? '#F2714E' : 'var(--color-text-secondary)', borderRadius: 8, padding: '8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>

          {paymentMethod === 'cash' && (
            <>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>รับเงินมา</label>
              <input type="number" value={receivedAmount} onChange={e => setReceivedAmount(e.target.value)} placeholder={total.toFixed(2)}
                style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 16, color: 'var(--color-text)', marginBottom: 8, boxSizing: 'border-box' }} />
              {receivedAmount && <p style={{ margin: 0, fontSize: 13, color: '#43E97B' }}>เงินทอน: {fmtB(change)}</p>}
            </>
          )}
        </div>

        <button onClick={() => checkoutM.mutate()} disabled={cart.length === 0 || checkoutM.isPending}
          style={{ width: '100%', background: cart.length ? 'linear-gradient(135deg,#FF9E80,#F2714E)' : 'var(--color-border)', color: cart.length ? 'var(--color-bg)' : 'var(--color-dim)', fontWeight: 800, fontSize: 15, border: 'none', borderRadius: 12, padding: '16px', cursor: cart.length ? 'pointer' : 'not-allowed', marginTop: 16 }}>
          {checkoutM.isPending ? '⏳ กำลังบันทึก...' : `✓ ชำระเงิน ${fmtB(total)}`}
        </button>
        {checkoutM.isError && <p style={{ color: '#FF6B6B', fontSize: 11, marginTop: 8, textAlign: 'center' }}>เกิดข้อผิดพลาด — ตรวจสอบสต็อกหรือยอดชำระ</p>}
      </div>

      {/* CLOSE SHIFT MODAL */}
      {showCloseShift && (
        <div style={overlay} onClick={() => setShowCloseShift(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>ปิดกะการขาย</h3></div>
            <div style={{ padding: 24 }}>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-secondary)' }}>นับเงินสดในลิ้นชักจริง แล้วกรอกยอดด้านล่าง</p>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>เงินสดที่นับได้จริง</label>
              <input type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)}
                style={{ width: '100%', background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 16, color: 'var(--color-text)', marginBottom: 16, boxSizing: 'border-box' }} />
              <button onClick={() => closeShiftM.mutate()} disabled={!closingCash || closeShiftM.isPending}
                style={{ width: '100%', background: '#FF6B6B', color: '#141018', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 9, padding: '11px', cursor: 'pointer' }}>
                ยืนยันปิดกะ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT / CLOSE SUMMARY */}
      {lastReceipt && (
        <div style={overlay} onClick={() => setLastReceipt(null)}>
          <div style={{ ...modal, maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, textAlign: 'center' }}>
              {lastReceipt.type === 'sale' ? (
                <>
                  <p style={{ fontSize: 36 }}>✅</p>
                  <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>ขายสำเร็จ</p>
                  <p style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'monospace', marginBottom: 16 }}>{lastReceipt.data.number}</p>
                  <p style={{ fontSize: 24, fontWeight: 800, color: '#F2714E' }}>{fmtB(lastReceipt.data.total)}</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 36 }}>🔒</p>
                  <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>ปิดกะเรียบร้อย</p>
                  <div style={{ textAlign: 'left', background: 'var(--color-bg-inset)', borderRadius: 8, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}><span>คาดว่าควรมี</span><span>{fmtB(lastReceipt.data.closing_cash_expected)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}><span>นับได้จริง</span><span>{fmtB(lastReceipt.data.closing_cash_counted)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, color: lastReceipt.data.cash_variance === 0 ? '#43E97B' : lastReceipt.data.cash_variance > 0 ? '#F5A623' : '#FF6B6B' }}>
                      <span>ส่วนต่าง</span><span>{lastReceipt.data.cash_variance >= 0 ? '+' : ''}{fmtB(lastReceipt.data.cash_variance)}</span>
                    </div>
                  </div>
                </>
              )}
              <button onClick={() => setLastReceipt(null)} style={{ marginTop: 16, background: 'var(--color-border)', color: 'var(--color-text-secondary)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontSize: 12 }}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
