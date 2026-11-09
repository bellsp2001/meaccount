import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { findProduct, type ProductOption } from './products'

// A document line's รายละเอียด: free text, with a dropdown of the created สินค้า/บริการ under it.
// The dropdown is portalled to <body> with fixed positioning, so the item table's scroll box
// does not clip it (a native <datalist> popup opens in the wrong place inside the app).
export default function ProductInput({ field, products, onPick, onUnlink, style, placeholder = 'เลือกหรือพิมพ์ชื่อสินค้า/บริการ' }: {
  field: UseFormRegisterReturn
  products: ProductOption[]
  onPick: (p: ProductOption) => void
  onUnlink?: () => void          // the text no longer names a product (typed over a picked one)
  style?: React.CSSProperties
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const q = query.trim().toLowerCase()
  const matches = products.filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8)

  // Keep the dropdown under the input while the page or the table scrolls.
  useEffect(() => {
    if (!open) return
    const place = () => inputRef.current && setRect(inputRef.current.getBoundingClientRect())
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const pick = (p: ProductOption) => { onPick(p); setQuery(p.name); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active] ?? matches[0]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <>
      <input
        {...field}
        ref={el => { field.ref(el); inputRef.current = el }}
        autoComplete="off" placeholder={placeholder} style={style}
        onFocus={e => { setQuery(e.target.value); setActive(0); setOpen(true) }}
        onBlur={e => { field.onBlur(e); setOpen(false) }}
        onChange={e => {
          field.onChange(e); setQuery(e.target.value); setActive(0); setOpen(true)
          const exact = findProduct(products, e.target.value)   // typing an exact name or SKU picks it too
          if (exact) onPick(exact)
          else onUnlink?.()
        }}
        onKeyDown={onKeyDown}
      />
      {open && rect && matches.length > 0 && createPortal(
        <div role="listbox" style={{
          position:'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280), maxHeight: 280, overflowY:'auto',
          background:'var(--color-card)', border:'1px solid var(--color-border-strong)', borderRadius:10,
          boxShadow:'0 10px 30px rgba(0,0,0,0.18)', zIndex:1000, padding:4,
        }}>
          {matches.map((p, i) => (
            <div key={p.id} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(p) }} onMouseEnter={() => setActive(i)}
              style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', padding:'7px 10px', borderRadius:7, cursor:'pointer', fontSize:12,
                       background: i === active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent' }}>
              <span style={{ color:'var(--color-text)', fontWeight:600 }}>{p.name}</span>
              <span style={{ color:'var(--color-dim)', fontSize:10, fontFamily:'monospace', whiteSpace:'nowrap' }}>
                {p.sku}{p.track_stock ? '' : ' · บริการ'}
              </span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
