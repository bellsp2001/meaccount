import { useEffect, useRef, useState } from 'react'
import type { Columns } from './columns'

// "คอลัมน์" button above a document list: a checkbox per column to show or hide it.
export default function ColumnPicker({ cols }: { cols: Columns }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const hidden = cols.defs.length - cols.visible.length

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
        style={{ display:'flex', alignItems:'center', gap:6, background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:10,
                 padding:'9px 14px', fontSize:12, fontWeight:700, color:'var(--color-text-secondary)', cursor:'pointer', whiteSpace:'nowrap' }}>
        <span aria-hidden>☷</span> คอลัมน์
        {hidden > 0 && <span style={{ fontSize:10, fontWeight:700, color:'var(--color-accent-light)' }}>(ซ่อน {hidden})</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="เลือกคอลัมน์ที่แสดง"
          style={{ position:'absolute', right:0, top:'calc(100% + 6px)', zIndex:30, minWidth:220, background:'var(--color-popover, var(--color-card))',
                   border:'1px solid var(--color-border-strong)', borderRadius:12, boxShadow:'0 12px 32px rgba(0,0,0,.18)', padding:8 }}>
          <p style={{ margin:'4px 8px 8px', fontSize:10, fontWeight:700, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.1em' }}>แสดงคอลัมน์</p>
          {cols.defs.map(d => (
            <label key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 8px', borderRadius:8, fontSize:12,
                                       cursor: d.required ? 'default' : 'pointer', color: d.required ? 'var(--color-text-tertiary)' : 'var(--color-text)' }}>
              <input type="checkbox" checked={cols.on(d.id)} disabled={d.required} onChange={() => cols.toggle(d.id)} style={{ width:15, height:15 }} />
              {d.label}
              {d.required && <span style={{ marginLeft:'auto', fontSize:10 }}>แสดงเสมอ</span>}
            </label>
          ))}
          <div style={{ borderTop:'1px solid var(--color-border)', marginTop:6, paddingTop:6 }}>
            <button type="button" onClick={cols.reset}
              style={{ width:'100%', background:'none', border:'none', padding:'7px 8px', textAlign:'left', fontSize:12, fontWeight:600, color:'var(--color-accent-light)', cursor:'pointer', borderRadius:8 }}>
              ↺ คืนค่าเริ่มต้น
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
