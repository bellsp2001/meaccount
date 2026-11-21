import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import DocSearch from '@/components/doc/DocSearch'
import ColumnPicker from '@/components/doc/ColumnPicker'
import { useColumns } from '@/components/doc/columns'
import { matchesSearch } from '@/components/doc/search'

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

  const [search, setSearch] = useState('')
  const cols = useColumns('purchase-tax-invoices', [
    { id:'ref_number', label:'เลขที่ใบกำกับ (ผู้จำหน่าย)', required:true }, { id:'bill', label:'บิล' }, { id:'supplier', label:'ผู้จำหน่าย' },
    { id:'tax_id', label:'เลขผู้เสียภาษี' }, { id:'date', label:'วันที่' }, { id:'description', label:'คำอธิบาย', defaultHidden:true },
    { id:'subtotal', label:'ก่อน VAT' }, { id:'vat', label:'VAT' }, { id:'total', label:'รวม' },
  ])
  const shown = bills.filter(b => matchesSearch(search, b.ref_number, b.number, b.supplier?.name, b.supplier?.tax_id, b.description,
    b.subtotal, b.vat_amount, b.total, new Date(b.date).toLocaleDateString('th-TH')))
  const th: React.CSSProperties = { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:700, color:'var(--color-dim)', textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:'1px solid var(--color-border)' }
  const td: React.CSSProperties = { padding:'11px 12px', borderBottom:'1px solid var(--color-border-subtle)', fontSize:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>ใบกำกับภาษี (ภาษีซื้อ)</h2>
        <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--color-muted)' }}>ใบกำกับภาษีที่ได้รับจากผู้จำหน่าย — บิลที่ลงบัญชีแล้วและมี VAT ทั้งหมด {bills.length} ฉบับ</p>
      </div>

      <DocSearch value={search} onChange={setSearch} count={shown.length} total={bills.length} placeholder="ค้นหาเลขที่ใบกำกับ บิล ผู้จำหน่าย เลขผู้เสียภาษี หรือยอดเงิน">
        <ColumnPicker cols={cols} />
      </DocSearch>

      <div style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14, overflow:'auto' }}>
        {isLoading ? <div style={{ padding:48, textAlign:'center', color:'var(--color-dim)' }}>กำลังโหลด...</div>
        : bills.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ยังไม่มีใบกำกับภาษีซื้อ — บิลที่มี VAT จะแสดงที่นี่หลัง Post GL</div>
        : shown.length === 0 ? <div style={{ padding:56, textAlign:'center', color:'var(--color-dim)', fontSize:13 }}>ไม่พบใบกำกับภาษีที่ค้นหา</div>
        : (
          <table className="doc-list">
            <thead><tr>{cols.visible.map(c=><th key={c.id} style={th}>{c.label}</th>)}</tr></thead>
            <tbody>
              {shown.map(b=>(
                <tr key={b.id}>
                  <td style={{ ...td, fontFamily:'monospace', color: b.ref_number ? 'var(--color-text)' : '#FF6B6B' }}>{b.ref_number || 'ยังไม่ระบุ'}</td>
                  {cols.on('bill') && <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-accent-light)' }}>{b.number}</td>}
                  {cols.on('supplier') && <td className="doc-wrap" style={td}>{b.supplier?.name || '—'}</td>}
                  {cols.on('tax_id') && <td style={{ ...td, fontFamily:'monospace', fontSize:11, color:'var(--color-text-tertiary)' }}>{b.supplier?.tax_id || '—'}</td>}
                  {cols.on('date') && <td style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{new Date(b.date).toLocaleDateString('th-TH')}</td>}
                  {cols.on('description') && <td className="doc-wrap" style={{ ...td, fontSize:11, color:'var(--color-text-tertiary)' }}>{b.description || '—'}</td>}
                  {cols.on('subtotal') && <td style={{ ...td, fontFamily:'monospace' }}>{baht(b.subtotal)}</td>}
                  {cols.on('vat') && <td style={{ ...td, fontFamily:'monospace', color:'#F5A623' }}>{baht(b.vat_amount)}</td>}
                  {cols.on('total') && <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>{baht(b.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
