import { useEffect, useRef } from 'react'
import { docBackBtn } from './docStyles'

// "← กลับ" link at the top of an in-page form panel (<div className="doc-panel">). The panel
// replaces the page's list on a regular card instead of a popup (see .doc-panel in index.css).
export default function PanelBack({ onClick, label = 'กลับไปที่รายการ' }: { onClick: () => void; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null)

  // Opening from far down the list: bring the panel's top into view.
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollTop > 0) el.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [])

  return (
    <button ref={ref} type="button" onClick={onClick} className="doc-back" style={docBackBtn}>
      <span aria-hidden>←</span> {label}
    </button>
  )
}
