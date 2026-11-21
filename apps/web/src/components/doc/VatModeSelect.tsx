import type { UseFormRegisterReturn } from 'react-hook-form'
import SearchSelect from '@/components/ui/SearchSelect'

// Header field of a document: are the line prices VAT-exclusive (แยก VAT) or VAT-inclusive (รวม VAT)?
export default function VatModeSelect({ field, labelStyle, style }: {
  field: UseFormRegisterReturn
  labelStyle?: React.CSSProperties
  style?: React.CSSProperties
}) {
  return (
    <div>
      <label style={labelStyle}>ราคาสินค้า</label>
      <SearchSelect {...field} style={{ ...style, cursor:'pointer' }}>
        <option value="exclusive">แยก VAT</option>
        <option value="inclusive">รวม VAT</option>
      </SearchSelect>
    </div>
  )
}
