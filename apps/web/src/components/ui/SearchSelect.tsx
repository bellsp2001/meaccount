import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A drop-in <select> you can type in to find an option. It takes the same props and <option>
// children as a native select (register(...) spreads straight onto it), keeps a hidden native
// select as the real field, and shows a text box with a filtered list under it. Picking an option
// sets the hidden select and fires its change event, so react-hook-form and controlled
// value/onChange selects both work unchanged.
type Props = React.SelectHTMLAttributes<HTMLSelectElement>

interface Opt { value: string; label: string; disabled: boolean }

const readOptions = (sel: HTMLSelectElement | null): Opt[] =>
  sel ? Array.from(sel.options).map(o => ({ value: o.value, label: o.text, disabled: o.disabled })) : []

const SearchSelect = forwardRef<HTMLSelectElement, Props>(function SearchSelect(
  { style, children, className, ...selectProps }, ref,
) {
  const selRef = useRef<HTMLSelectElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => selRef.current as HTMLSelectElement, [])

  const [selected, setSelected] = useState<Opt | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [options, setOptions] = useState<Opt[]>([])

  // The hidden select's value can change without an event (form reset, a controlled value),
  // so re-read the shown option after every render (setSelected only runs when it differs).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sel = selRef.current
    if (!sel) return
    const opt = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null
    const next = opt ? { value: opt.value, label: opt.text, disabled: opt.disabled } : null
    if (next?.value !== selected?.value || next?.label !== selected?.label) setSelected(next)
  })

  useEffect(() => {
    if (!open) return
    const place = () => inputRef.current && setRect(inputRef.current.getBoundingClientRect())
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = options.filter(o => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q)

  const openList = () => { setOptions(readOptions(selRef.current)); setQuery(''); setActive(0); setOpen(true) }
  const pick = (o: Opt) => {
    const sel = selRef.current
    setOpen(false); setQuery('')
    if (!sel || o.disabled) return
    if (sel.value !== o.value) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(sel, o.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setSelected(o)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openList() } return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) pick(matches[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery('') }
    else if (e.key === 'Tab') { setOpen(false); setQuery('') }
  }

  // An empty-value option ("-- เลือก... --") reads as the placeholder, not as a value.
  const shownLabel = selected && selected.value !== '' ? selected.label : ''
  const placeholder = selected && selected.value === '' ? selected.label : (options[0]?.value === '' ? options[0].label : '')
  const { width, flex, minWidth, maxWidth, margin, marginTop, marginBottom, gridColumn, ...boxStyle } = style ?? {}

  return (
    <span className={className} style={{ position:'relative', display: width === undefined && flex === undefined ? 'inline-block' : 'block',
                                          width: width ?? undefined, flex, minWidth, maxWidth, margin, marginTop, marginBottom, gridColumn }}>
      <select ref={selRef} {...selectProps} tabIndex={-1} aria-hidden style={{ display:'none' }}>{children}</select>
      <input
        ref={inputRef} type="text" autoComplete="off" role="combobox" aria-expanded={open}
        disabled={selectProps.disabled}
        value={open ? query : shownLabel}
        placeholder={open ? (shownLabel || 'พิมพ์เพื่อค้นหา') : placeholder}
        onFocus={openList}
        onMouseDown={() => { if (!open && document.activeElement === inputRef.current) openList() }}
        onChange={e => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true) }}
        onBlur={() => { setOpen(false); setQuery('') }}
        onKeyDown={onKeyDown}
        style={{ ...boxStyle, width:'100%', boxSizing:'border-box', paddingRight:26, cursor:'pointer', textOverflow:'ellipsis' }}
      />
      <span aria-hidden className="search-select-caret" style={{ position:'absolute', right:9, top:'50%', transform:'translateY(-50%)',
        pointerEvents:'none', fontSize:9, color:'var(--color-dim)' }}>▼</span>
      {open && rect && createPortal(
        <div role="listbox" style={{
          position:'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220), maxHeight: 300, overflowY:'auto',
          background:'var(--color-card)', border:'1px solid var(--color-border-strong)', borderRadius:10,
          boxShadow:'0 10px 30px rgba(0,0,0,0.18)', zIndex:1000, padding:4,
        }}>
          {matches.length === 0
            ? <div style={{ padding:'8px 10px', fontSize:12, color:'var(--color-dim)' }}>ไม่พบตัวเลือก</div>
            : matches.map((o, i) => (
              <div key={`${o.value}-${i}`} role="option" aria-selected={o.value === selected?.value}
                onMouseDown={e => { e.preventDefault(); pick(o) }} onMouseEnter={() => setActive(i)}
                style={{ padding:'7px 10px', borderRadius:7, fontSize:12, cursor: o.disabled ? 'default' : 'pointer',
                         color: o.disabled ? 'var(--color-dim)' : o.value === '' ? 'var(--color-muted)' : 'var(--color-text)',
                         fontWeight: o.value === selected?.value ? 700 : 400,
                         background: i === active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent' }}>
                {o.label}
              </div>
            ))}
        </div>,
        document.body,
      )}
    </span>
  )
})

export default SearchSelect
