import type { UseFormRegisterReturn } from 'react-hook-form'
import type { VatCode } from './vat'
import SearchSelect from '@/components/ui/SearchSelect'

// VAT column of a document item table: picks the line's ประเภทภาษี (VAT).
export default function VatSelect({ field, codes, value, style }: {
  field: UseFormRegisterReturn
  codes: VatCode[]
  value?: string
  style?: React.CSSProperties
}) {
  return (
    <SearchSelect {...field} style={{ ...style, cursor:'pointer' }} aria-label="ภาษีมูลค่าเพิ่มของรายการ">
      <option value="">ไม่มี VAT</option>
      {codes.filter(c => c.is_active || c.id === value).map(c => (
        <option key={c.id} value={c.id}>{c.code} · {Number(c.rate)}%{c.is_active ? '' : ' (ปิดใช้งาน)'}</option>
      ))}
    </SearchSelect>
  )
}
