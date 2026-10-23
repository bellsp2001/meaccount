import { useState, useRef, useEffect } from 'react'
import { useThemeStore } from '@/store/theme'

const OPTIONS: { mode: 'light' | 'system' | 'dark'; icon: string; label: string }[] = [
  { mode: 'light', icon: '☀️', label: 'โหมดสว่าง' },
  { mode: 'system', icon: '🖥️', label: 'ตามระบบ' },
  { mode: 'dark', icon: '🌙', label: 'โหมดมืด' },
]

const ICON_BTN: React.CSSProperties = {
  display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9,
  border: 'none', cursor: 'pointer', fontSize: 16, transition: 'background 0.12s',
}

export function ThemeToggle() {
  const { mode, setMode } = useThemeStore()
  const [open, setOpen] = useState(false)
  const [render, setRender] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = OPTIONS.find(o => o.mode === mode) ?? OPTIONS[1]
  const others = OPTIONS.filter(o => o.mode !== mode)

  // Freeze the panel's contents while it slides closed: picking a mode re-sorts
  // current/others, and letting that reshuffle mid-close is what caused the jitter.
  const viewRef = useRef({ current, others })
  if (open) viewRef.current = { current, others }
  const view = viewRef.current

  // Keep the panel mounted while it slides open/closed so the exit animation can play
  useEffect(() => { if (open) setRender(true) }, [open])

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const hover = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) =>
    (e.currentTarget.style.background = on ? 'color-mix(in srgb, var(--color-text) 9%, transparent)' : 'transparent')

  return (
    <div ref={ref} style={{ position: 'relative', width: 34, height: 34 }}>
      {/* Collapsed trigger — shows the active theme, no caret */}
      <button
        title={`ธีม: ${current.label}`}
        onClick={() => setOpen(o => !o)}
        style={{ ...ICON_BTN, background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}
      >
        {current.icon}
      </button>

      {/* Open — one frame: active theme on top, unused themes below it */}
      {render && (
        <>
          <style>{`
            @keyframes themeMenuIn { from { opacity: 0; transform: translateY(-8px) scaleY(0.9); } to { opacity: 1; transform: translateY(0) scaleY(1); } }
            @keyframes themeMenuOut { from { opacity: 1; transform: translateY(0) scaleY(1); } to { opacity: 0; transform: translateY(-8px) scaleY(0.9); } }
          `}</style>
          <div
            className="glass"
            onAnimationEnd={(e) => { if (e.target === e.currentTarget && !open) setRender(false) }}
            style={{
              position: 'absolute', top: -5, left: -5, display: 'flex', flexDirection: 'column', gap: 3,
              borderRadius: 12, padding: 5, boxShadow: 'var(--shadow-pop)', zIndex: 40,
              transformOrigin: 'top center', willChange: 'transform, opacity',
              pointerEvents: open ? 'auto' : 'none',
              animation: `${open ? 'themeMenuIn' : 'themeMenuOut'} 0.18s ease-out both`,
            }}
          >
            <button
              title={`ธีม: ${view.current.label}`}
              onClick={() => setOpen(false)}
              style={{ ...ICON_BTN, background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}
            >
              {view.current.icon}
            </button>
            {view.others.map(opt => (
              <button
                key={opt.mode}
                title={opt.label}
                onClick={() => { setMode(opt.mode); setOpen(false) }}
                style={{ ...ICON_BTN, background: 'transparent' }}
                onMouseEnter={hover(true)}
                onMouseLeave={hover(false)}
              >
                {opt.icon}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
