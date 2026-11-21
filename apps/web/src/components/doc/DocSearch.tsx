import type { ReactNode } from 'react'

// Search box above a document list. Filtering happens in the page (see matchesSearch).
// `children` (e.g. the column picker) sit at the right end of the row.
export default function DocSearch({ value, onChange, placeholder = 'ค้นหาเลขที่ ชื่อ หรือยอดเงิน', count, total, children }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  count?: number      // rows shown after filtering
  total?: number      // rows before filtering
  children?: ReactNode
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
      <div style={{ position:'relative', flex:'1 1 260px', maxWidth:380 }}>
        <span aria-hidden style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'var(--color-dim)', pointerEvents:'none' }}>🔍</span>
        <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label="ค้นหาเอกสาร"
          style={{ width:'100%', boxSizing:'border-box', background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:10,
                   padding:'9px 12px 9px 34px', fontSize:12, color:'var(--color-text)', outline:'none' }} />
      </div>
      {value.trim() && count !== undefined && total !== undefined &&
        <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>พบ {count} จาก {total} รายการ</span>}
      {children && <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>{children}</div>}
    </div>
  )
}
