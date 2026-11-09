// Case-insensitive match of a search box query against a row's fields. Every word of the
// query must appear in at least one field, so "ซอฟต์แวร์ 107" finds that customer's ฿107 document.
// Numbers match both as written and with thousands separators (10700 and 10,700).
export function matchesSearch(query: string, ...fields: unknown[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fields.flatMap(f => {
    if (f === null || f === undefined || f === '') return []
    const n = typeof f === 'number' ? f : typeof f === 'string' && /^-?\d+(\.\d+)?$/.test(f) ? Number(f) : null
    return n === null ? [String(f)] : [String(f), n.toLocaleString('en-US', { minimumFractionDigits: 2 }), String(n)]
  }).join(' \u0000 ').toLowerCase()
  return words.every(w => haystack.includes(w))
}
