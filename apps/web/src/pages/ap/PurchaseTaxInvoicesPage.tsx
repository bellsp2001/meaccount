import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

// ใบกำกับภาษีซื้อ — posted bills that carry input VAT. The supplier's own tax-invoice
// number is the bill's reference number.
interface Bill {
  id: string; number: string; ref_number?: string; supplier?: { name: string; tax_id?: string }
  date: string; description: string; subtotal: number; vat_amount: number; total: number; status: string
}

const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH',{minimumFractionDigits:2})}`

export default function PurchaseTaxInvoicesPage() {
  const { data: bills = [], isLoading } = useQuery<Bill[]>({
    queryKey: ['purchase-tax-invoices'],
    queryFn: async () => (await api.get('/api/v1/ap/tax-invoices')).data,
  })

  const now = new Date()
  const thisMonth = bills.filter(b => { const d = new Date(b.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
  const sum = (bs: Bill[], k: 'vat_amount' | 'subtotal') => bs.reduce((s, b) => s + Number(b[k]), 0)
  const missingRef = bills.filter(b => !b.ref_number).length
  const th: React.CSSProperties = { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }
  const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบกำกับภาษี (ภาษีซื้อ)</h2>
        <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>ใบกำกับภาษีที่ได้รับจากผู้จำหน่าย — บิลที่ลงบัญชีแล้วและมี VAT ทั้งหมด {bills.length} ฉบับ</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12 }}>
        {[
          { l:'ภาษีซื้อเดือนนี้', v: baht(sum(thisMonth, 'vat_amount')), color:'#F5A623' },
          { l:'มูลค่าซื้อเดือนนี้ (ก่อน VAT)', v: baht(sum(thisMonth, 'subtotal')), color:'var(--color-accent-light)' },
          { l:'ภาษีซื้อทั้งหมด', v: baht(sum(bills, 'vat_amount')), color:'#43E97B' },
          { l:'ยังไม่ระบุเลขที่ใบกำกับ', v: missingRef, color: missingRef ? '#FF6B6B' : 'var(--color-dim)' },
        ].map(k=>(
          <div key={k.l} style={{ background:'var(--color-card)', border:`1px solid ${k.color}20`, borderTop:`2px solid ${k.color}`, borderRadius:12, padding:'14px 16px' }}>
            <p style={{ margin:'0 0 4px', fontSize:10, color:'var(--color-muted)' }}>{k.l}</p>
            <p style={{ margin:0, fontSize:20, fontWeight:800, color:k.color }}>{k.v}</p>
          </div>
        ))}
      </div>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : bills.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีใบกำกับภาษีซื้อ — บิลที่มี VAT จะแสดงที่นี่หลัง Post GL</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['เลขที่ใบกำกับ (ผู้จำหน่าย)','บิล','ผู้จำหน่าย','เลขผู้เสียภาษี','วันที่','ก่อน VAT','VAT','รวม'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {bills.map(b=>(
                <tr key={b.id}>
                  <td style={{ ...td, fontFamily:'monospace', color: b.ref_number ? 'var(--color-text)' : '#FF6B6B' }}>{b.ref_number || 'ยังไม่ระบุ'}</td>
                  <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-accent-light)' }}>{b.number}</td>
                  <td style={td}>{b.supplier?.name || '—'}</td>
                  <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-text-tertiary)' }}>{b.supplier?.tax_id || '—'}</td>
                  <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(b.date).toLocaleDateString('th-TH')}</td>
                  <td style={{ ...td, fontFamily:'monospace' }}>{baht(b.subtotal)}</td>
                  <td style={{ ...td, fontFamily:'monospace', color:'#F5A623' }}>{baht(b.vat_amount)}</td>
                  <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>{baht(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
