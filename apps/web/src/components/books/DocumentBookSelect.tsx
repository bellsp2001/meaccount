import { useQuery } from '@tanstack/react-query'
import type { UseFormRegisterReturn } from 'react-hook-form'
import api from '@/lib/api'
import { JOURNAL_TYPE_META, type JournalType } from '@/config/journals'

export interface BookOption {
  id: string; code: string; name: string; journal_type: JournalType; is_active: boolean
  account: { code: string; name: string } | null
  counter_account: { code: string; name: string } | null
  tax_code: { code: string; name: string; kind: 'vat' | 'wht'; rate: number } | null
}

/** Active สมุดบันทึก for one side, shared by the picker and the form that reacts to a pick. */
export function useDocumentBooks(side: 'income' | 'expense') {
  return useQuery<BookOption[]>({
    queryKey: ['document-books', side],
    queryFn: async () => (await api.get('/api/v1/document-books/', { params: { side } })).data,
    select: books => books.filter(b => b.is_active),
  })
}

/**
 * Picker for the สมุดบันทึก a new invoice/bill posts through, with a one-line summary of where the
 * selected book sends the amounts. `field` is react-hook-form's register('book_id', { onChange }).
 */
export function DocumentBookSelect({ side, field, value, inputStyle, labelStyle }: {
  side: 'income' | 'expense'
  field: UseFormRegisterReturn
  value?: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const { data: books = [] } = useDocumentBooks(side)
  const picked = books.find(b => b.id === value)
  const fallback = side === 'income' ? 'ลูกหนี้ / รายได้จากการขาย (ค่าเริ่มต้น)' : 'ตามหมวดหมู่ / เจ้าหนี้ (ค่าเริ่มต้น)'

  return (
    <div>
      <label style={labelStyle}>สมุดบันทึก</label>
      <select {...field} style={{ ...inputStyle, cursor: 'pointer' }}>
        <option value="">— ไม่ระบุ: {fallback} —</option>
        {books.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
      </select>
      {picked ? (
        <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.5 }}>
          ลง{JOURNAL_TYPE_META[picked.journal_type].full}
          {' · '}{side === 'income' ? 'Cr' : 'Dr'} {picked.account ? `${picked.account.code} ${picked.account.name}` : '—'}
          {' · '}{side === 'income' ? 'Dr' : 'Cr'} {picked.counter_account ? `${picked.counter_account.code} ${picked.counter_account.name}` : (side === 'income' ? 'ลูกหนี้ (ค่าเริ่มต้น)' : 'เจ้าหนี้ (ค่าเริ่มต้น)')}
          {picked.tax_code && <> · {picked.tax_code.code}</>}
        </p>
      ) : books.length === 0 ? (
        <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-dim)' }}>
          ยังไม่มีสมุดบันทึก{side === 'income' ? 'รายได้' : 'ค่าใช้จ่าย'} — สร้างได้ที่เมนู {side === 'income' ? 'การขาย/รายได้' : 'รายจ่าย/ค่าใช้จ่าย'} › สมุดบันทึก
        </p>
      ) : null}
    </div>
  )
}
