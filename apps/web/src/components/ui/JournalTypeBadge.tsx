import { JOURNAL_TYPE_META, type JournalType } from '@/config/journals'

export function JournalTypeBadge({ type, full = false }: { type: JournalType; full?: boolean }) {
  const m = JOURNAL_TYPE_META[type] ?? JOURNAL_TYPE_META.general
  return (
    <span style={{ display: 'inline-flex', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 700, color: m.color, background: m.color + '18', border: `1px solid ${m.color}35`, padding: '2px 9px', borderRadius: 10 }}>
      {full ? m.full : m.label}
    </span>
  )
}
