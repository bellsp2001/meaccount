import type { ReactNode } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import SearchSelect from '@/components/ui/SearchSelect'

// Totals-box rows for a document's bill discount (ส่วนลดท้ายบิล / ส่วนลดเงินสด): รวมเป็นเงิน (what
// the discount comes off), then the discount entered in baht or %, before or after VAT.
// `children` are the box's ยอดก่อน VAT / VAT rows: a before-VAT discount shows above them, an
// after-VAT one below them. In a read-only document with no discount, only the children show.
export default function BillDiscountRow({ valueField, typeField, timingField, afterVat, base, discount, readOnly, hasDiscount, inputStyle, children }: {
  valueField: UseFormRegisterReturn
  typeField: UseFormRegisterReturn
  timingField: UseFormRegisterReturn
  afterVat: boolean
  base: number
  discount: number
  readOnly: boolean
  hasDiscount: boolean
  inputStyle: React.CSSProperties
  children: ReactNode
}) {
  if (readOnly && !hasDiscount) return <>{children}</>
  const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const row: React.CSSProperties = { display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, padding:'4px 0', fontSize:12 }
  const small: React.CSSProperties = { ...inputStyle, padding:'4px 8px', fontSize:12 }
  const rows = (
    <>
      <div style={row}>
        <span style={{ color:'var(--color-text-tertiary)' }}>รวมเป็นเงิน</span>
        <span style={{ color:'var(--color-text)' }}>{baht(base)}</span>
      </div>
      <div style={row}>
        <span style={{ color:'var(--color-text-tertiary)', whiteSpace:'nowrap' }}>ส่วนลดท้ายบิล</span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input {...valueField} type="number" min="0" step="0.01" aria-label="ส่วนลดท้ายบิล"
            style={{ ...small, width:84, textAlign:'right' }} />
          <SearchSelect {...typeField} aria-label="หน่วยส่วนลด" style={{ ...small, width:62 }}>
            <option value="amount">฿</option>
            <option value="pct">%</option>
          </SearchSelect>
          <SearchSelect {...timingField} aria-label="ส่วนลดก่อนหรือหลัง VAT" style={{ ...small, width:96 }}>
            <option value="before">ก่อน VAT</option>
            <option value="after">หลัง VAT</option>
          </SearchSelect>
        </span>
      </div>
      {discount > 0 && (
        <div style={{ ...row, paddingTop:0 }}>
          <span />
          <span style={{ color:'#FF6B6B' }}>-{baht(discount)}</span>
        </div>
      )}
    </>
  )
  return afterVat ? <>{children}{rows}</> : <>{rows}{children}</>
}
