import { useQuery } from '@tanstack/react-query'
import type { UseFormRegisterReturn } from 'react-hook-form'
import api from '@/lib/api'
import { JOURNAL_TYPE_META, type JournalType } from '@/config/journals'
import SearchSelect from '@/components/ui/SearchSelect'

export interface BookOption {
  id: string; code: string; name: string; journal_type: JournalType; is_active: boolean
  account: { code: string; name: string } | null
  counter_account: { code: string; name: string } | null
  tax_code_id?: string | null
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
 * Picker for the สมุดบันทึก a document posts through, with a one-line summary of where the
 * selected book sends the amounts. `field` is react-hook-form's register('book_id', { onChange }).
 * A document can be saved as a draft without one, but confirming it (posting to GL) needs a book.
 * `current` is the document's saved book, listed even if it has since been deactivated.
 */
export function DocumentBookSelect({ side, field, value, inputStyle, labelStyle, current }: {
  side: 'income' | 'expense'
  field: UseFormRegisterReturn
  value?: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  current?: { id?: string; code: string; name: string } | null
}) {
  const { data: books = [] } = useDocumentBooks(side)
  const picked = books.find(b => b.id === value)

  return (
    <div>
      <label style={labelStyle}>สมุดบันทึก *</label>
      <SearchSelect {...field} style={{ ...inputStyle, cursor: 'pointer' }}>
        <option value="">— เลือกสมุดบันทึก —</option>
        {books.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        {current?.id && !books.some(b => b.id === current.id) && <option value={current.id}>{current.code} — {current.name} (ปิดใช้งาน)</option>}
      </SearchSelect>
      {picked ? (
        <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.5 }}>
          ลง{JOURNAL_TYPE_META[picked.journal_type].full}
          {' · '}{side === 'income' ? 'Cr' : 'Dr'} {picked.account ? `${picked.account.code} ${picked.account.name}` : '—'}
          {' · '}{side === 'income' ? 'Dr' : 'Cr'} {picked.counter_account ? `${picked.counter_account.code} ${picked.counter_account.name}` : (side === 'income' ? 'ลูกหนี้ (ค่าเริ่มต้น)' : 'เจ้าหนี้ (ค่าเริ่มต้น)')}
          {picked.tax_code && <> · {picked.tax_code.code}</>}
        </p>
      ) : books.length === 0 ? (
        <p className="doc-edit-only" style={{ margin: '5px 0 0', fontSize: 11, color: '#C77700' }}>
          ยังไม่มีสมุดบันทึก{side === 'income' ? 'รายได้' : 'ค่าใช้จ่าย'} — บันทึกเป็นฉบับร่างได้ แต่ต้องสร้างสมุดก่อนจึงจะยืนยันเอกสารได้ (เมนู {side === 'income' ? 'การขาย/รายได้' : 'รายจ่าย/ค่าใช้จ่าย'} › สมุดบันทึก)
        </p>
      ) : !value ? (
        <p className="doc-edit-only" style={{ margin: '5px 0 0', fontSize: 11, color: '#C77700' }}>
          ต้องเลือกสมุดบันทึกก่อนจึงจะยืนยันเอกสารได้ (บันทึกเป็นฉบับร่างได้)
        </p>
      ) : null}
    </div>
  )
}
