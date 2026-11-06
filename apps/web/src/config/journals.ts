// สมุดรายวัน 5 เล่ม — mirrors models.accounting.JournalType on the API.
export type JournalType = 'general' | 'sales' | 'purchase' | 'receipt' | 'payment'

// Order follows how the books are usually taught/filed.
export const JOURNAL_TYPES: { key: JournalType; label: string; full: string; en: string; color: string }[] = [
  { key: 'general',  label: 'ทั่วไป',   full: 'สมุดรายวันทั่วไป',   en: 'General Journal',       color: '#8E8CF7' },
  { key: 'sales',    label: 'ขาย',     full: 'สมุดรายวันขาย',     en: 'Sales Journal',         color: '#43E97B' },
  { key: 'purchase', label: 'ซื้อ',     full: 'สมุดรายวันซื้อ',     en: 'Purchase Journal',      color: '#F5A623' },
  { key: 'receipt',  label: 'รับเงิน',  full: 'สมุดรายวันรับเงิน',  en: 'Cash Receipts Journal', color: '#4CA5FF' },
  { key: 'payment',  label: 'จ่ายเงิน', full: 'สมุดรายวันจ่ายเงิน', en: 'Cash Payments Journal', color: '#FF6B8A' },
]

export const JOURNAL_TYPE_META = Object.fromEntries(JOURNAL_TYPES.map(t => [t.key, t])) as Record<JournalType, typeof JOURNAL_TYPES[number]>

export const isJournalType = (v: string | null): v is JournalType => !!v && v in JOURNAL_TYPE_META
