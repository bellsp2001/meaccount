import { useEffect, useRef, type ReactNode } from 'react'
import { docBackBtn } from './docStyles'

// A document's create/edit form or detail view, shown on a regular card in place of the
// list (instead of a popup). The page renders either its list or one DocCard.
export default function DocCard({ title, subtitle, onBack, backLabel = 'กลับไปที่รายการ', actions, children }: {
  title: ReactNode
  subtitle?: ReactNode
  onBack: () => void
  backLabel?: string
  actions?: ReactNode          // extra buttons on the right of the header
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Opening from far down the list: bring the card's top into view.
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollTop > 0) el.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [])

  return (
    <div ref={ref} style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <button type="button" onClick={onBack} className="doc-back" style={docBackBtn}>
        <span aria-hidden>←</span> {backLabel}
      </button>
      <section style={{ background:'var(--color-card)', border:'1px solid var(--color-border)', borderRadius:14 }}>
        <header style={{ padding:'18px 24px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <h2 style={{ margin:0, fontSize:17, fontWeight:800 }}>{title}</h2>
            {subtitle && <p style={{ margin:'2px 0 0', fontSize:12, color:'var(--color-muted)' }}>{subtitle}</p>}
          </div>
          {actions && <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>{actions}</div>}
        </header>
        {children}
      </section>
    </div>
  )
}
