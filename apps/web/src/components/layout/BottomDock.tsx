import { useState, useRef, useEffect, useLayoutEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { allowedNav, findActiveNav, navTint, IconTile, NAV, type NavItem } from '@/config/nav'
import { useDockOrder, applyOrder } from '@/store/dockOrder'

// Dock geometry — kept in one place so the fit calculation and the layout agree.
const ITEM_W = 62   // width of one app tile
const GAP = 4       // flex gap between tiles
const SLOT = ITEM_W + GAP
const PAD_X = 12    // horizontal padding inside the glass bar
const SIDE_MARGIN = 32 // glass maxWidth is calc(100vw - 32px) → 16px each side
const HOLD_MS = 260 // press-and-hold before a tile enters drag mode
const DIVIDER_W = 12 // space taken by the pinned-app divider
const EASE = 'transform 0.22s cubic-bezier(0.22,0.61,0.36,1)'

/** How many leading items fit; the rest collapse behind a "More" tile. */
function fitCount(viewportW: number, total: number): number {
  const avail = viewportW - SIDE_MARGIN - PAD_X * 2
  const widthFor = (k: number) => k * ITEM_W + Math.max(0, k - 1) * GAP
  if (widthFor(total) <= avail) return total // everything fits, no More tile needed
  const availForItems = avail - SLOT // reserve room for the More tile
  return Math.max(0, Math.min(total, Math.floor((availForItems + GAP) / SLOT)))
}

interface Slot { x: number; y: number; h: number }

export function BottomDock() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { order, setOrder } = useDockOrder()

  const apps = applyOrder(allowedNav(user?.role), order)
  const active = findActiveNav(pathname, apps)

  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreRender, setMoreRender] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Drag state lives entirely in refs so pointer moves never re-render React.
  // The DOM order is frozen during a drag; tiles are nudged aside with transforms
  // that only change when the insert slot changes, and CSS transitions do the rest.
  const dragRef = useRef<string | null>(null)
  const frozen = useRef<string[]>([])       // key order at pickup (DOM stays in this order)
  const slots = useRef<(Slot | null)[]>([]) // clean centre of each slot index
  const dragIndex = useRef(0)
  const lastInsert = useRef(0)
  const grab = useRef({ dx: 0, dy: 0 })
  const ptr = useRef({ x: 0, y: 0 })
  const ghostRef = useRef<HTMLDivElement>(null)
  const holdTimer = useRef<number | null>(null)
  const startPt = useRef<{ x: number; y: number } | null>(null)
  const didDrag = useRef(false)
  const tileEls = useRef(new Map<string, HTMLButtonElement>())
  const pinMin = useRef(0)

  // Pin the currently-open app to the front of the dock, split off by a divider.
  // This is a display-only reorder — the underlying (drag-persisted) order in
  // `apps` is untouched, so when you switch away the app returns to its own spot.
  const activeKey = active?.to ?? null
  const pinned = !!activeKey && apps.length > 1
  const displayApps = pinned ? [active!, ...apps.filter(a => a.to !== activeKey)] : apps
  pinMin.current = pinned ? 1 : 0

  const visibleCount = fitCount(vw - (pinned ? DIVIDER_W : 0), displayApps.length)
  const visible = displayApps.slice(0, visibleCount)
  const overflow = displayApps.slice(visibleCount)
  const overflowActive = overflow.some(a => a.to === active?.to)

  const snap = useRef({ appsKeys: [] as string[], order })
  snap.current = { appsKeys: apps.map(a => a.to), order }

  useLayoutEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (moreOpen) setMoreRender(true) }, [moreOpen])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dragRef.current) return
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  useEffect(() => { setMoreOpen(false) }, [pathname])

  const positionGhost = () => {
    const g = ghostRef.current
    if (g) g.style.transform = `translate(${ptr.current.x - grab.current.dx}px, ${ptr.current.y - grab.current.dy}px) scale(1.14)`
  }

  // On drag start (dragKey set) measure the clean slot centres; on drag end wipe
  // any leftover inline transforms so tiles rest naturally in their new order.
  useLayoutEffect(() => {
    if (!dragKey) {
      tileEls.current.forEach((el) => {
        el.style.transition = ''
        el.style.transform = ''
        el.style.zIndex = ''
        el.style.position = ''
      })
      return
    }
    slots.current = frozen.current.map((k) => {
      const el = tileEls.current.get(k)
      if (!el || !el.isConnected) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }
    })
    positionGhost()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey])

  // Slot the pointer is over → the gap index (0..n-1) in the sequence w/o the drag.
  const insertFor = (px: number, py: number): number => {
    const sc = slots.current
    const di = dragIndex.current
    let s = -1, best = Infinity, cx = 0, cy = 0, h = 44
    for (let i = 0; i < sc.length; i++) {
      const c = sc[i]
      if (!c || i === di) continue
      const d = (c.x - px) ** 2 + (c.y - py) ** 2
      if (d < best) { best = d; s = i; cx = c.x; cy = c.y; h = c.h }
    }
    if (s < 0) return di
    const sameRow = Math.abs(py - cy) < h * 0.6
    const raw = s + ((sameRow ? px > cx : py > cy) ? 1 : 0)
    const g = raw <= di ? raw : raw - 1
    // Never let a tile land before the pinned active app (keep it behind the divider).
    return Math.max(pinMin.current, Math.min(frozen.current.length - 1, g))
  }

  // Apply the shuffle for a given gap index — pure transforms, no React, no reflow.
  const applyShift = (g: number) => {
    const fr = frozen.current
    const sc = slots.current
    const di = dragIndex.current
    let p = 0
    for (let i = 0; i < fr.length; i++) {
      if (i === di) continue
      const key = fr[i]
      const el = tileEls.current.get(key)
      const targetSlot = p < g ? p : p + 1
      p++
      if (!el) continue
      const from = sc[i]
      const to = sc[targetSlot]
      el.style.transition = EASE
      if (from && to && (from.x !== to.x || from.y !== to.y)) {
        el.style.position = 'relative'
        el.style.zIndex = '50' // ride above the panel when crossing the bar↔shelf edge
        el.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px)`
      } else {
        el.style.transform = ''
        el.style.zIndex = ''
      }
    }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) {
        const s = startPt.current
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10 && holdTimer.current) {
          clearTimeout(holdTimer.current)
          holdTimer.current = null
        }
        return
      }
      e.preventDefault()
      didDrag.current = true
      ptr.current = { x: e.clientX, y: e.clientY }
      positionGhost()
      const g = insertFor(e.clientX, e.clientY)
      if (g !== lastInsert.current) {
        lastInsert.current = g
        applyShift(g)
      }
    }

    const finish = () => {
      if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
      document.body.style.userSelect = ''
      const key = dragRef.current
      startPt.current = null
      if (key) {
        const fr = frozen.current
        const di = dragIndex.current
        const g = lastInsert.current
        const seq = fr.filter((_, i) => i !== di)
        seq.splice(g, 0, key) // new display order
        const st = snap.current
        const others = st.order.filter(k => !st.appsKeys.includes(k))
        // Strip the display-only pin before persisting: drop the pinned active
        // tile and re-insert it at its own base position, so it returns there
        // once you navigate away.
        let base = seq
        if (pinMin.current === 1) {
          const activePin = fr[0]
          const rest = seq.filter(k => k !== activePin)
          const at = st.appsKeys.indexOf(activePin)
          base = [...rest]
          base.splice(Math.max(0, Math.min(at, base.length)), 0, activePin)
        }
        dragRef.current = null
        setDragKey(null)
        setOrder([...base, ...others])
      }
    }

    const onUp = () => { if (startPt.current || dragRef.current) finish() }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (holdTimer.current) clearTimeout(holdTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOrder])

  const beginPress = (e: React.PointerEvent, key: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    didDrag.current = false
    startPt.current = { x: e.clientX, y: e.clientY }
    holdTimer.current = window.setTimeout(() => {
      const el = tileEls.current.get(key)
      const r = el?.getBoundingClientRect()
      grab.current = r ? { dx: e.clientX - r.left, dy: e.clientY - r.top } : { dx: ITEM_W / 2, dy: 22 }
      ptr.current = { x: e.clientX, y: e.clientY }
      frozen.current = displayApps.map(a => a.to)
      dragIndex.current = frozen.current.indexOf(key)
      lastInsert.current = dragIndex.current
      didDrag.current = true
      dragRef.current = key
      setDragKey(key)
      setMoreOpen(true) // reveal the shelf so items can be dragged in/out
      document.body.style.userSelect = 'none'
    }, HOLD_MS)
  }

  const go = (to: string) => {
    if (didDrag.current) return // a drag just ended — don't navigate
    navigate(to)
    setMoreOpen(false)
  }

  // ── Tile renderer ──────────────────────────────────────────────────────
  const AppTile = (item: NavItem, draggable: boolean) => {
    const isActive = active?.to === item.to
    const tint = navTint(NAV.indexOf(item))
    const isPlaceholder = dragKey === item.to
    return (
      <button
        key={item.to}
        ref={(el) => { if (el) tileEls.current.set(item.to, el) }}
        title={item.label}
        onClick={() => go(item.to)}
        onPointerDown={draggable ? (e) => beginPress(e, item.to) : undefined}
        className="dock-app"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: ITEM_W, flexShrink: 0,
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
          touchAction: draggable ? 'none' : undefined,
          opacity: isPlaceholder ? 0 : 1, // the lifted tile is drawn as a floating ghost
        }}
      >
        <span style={{ position: 'relative', transition: 'transform 0.15s', transform: isActive ? 'translateY(-2px)' : 'none' }}>
          <IconTile icon={item.icon} tint={tint} active={isActive} size={44} />
          {item.badge && <span style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: '#FF375F', border: '1.5px solid var(--color-card-solid)' }} />}
        </span>
        <span style={{ fontSize: 9, fontWeight: isActive ? 700 : 500, lineHeight: 1.1, textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isActive ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>{item.label}</span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: isActive ? 'var(--color-accent)' : 'transparent', transition: 'background 0.15s' }} />
      </button>
    )
  }

  const cols = Math.min(Math.max(overflow.length, 1), 5)
  const ghostItem = dragKey ? apps.find(a => a.to === dragKey) : undefined
  const showPanel = moreRender || !!dragKey

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 30 }}>
      <style>{`
        @keyframes dockMoreIn { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dockMoreOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(10px) scale(0.96); } }
      `}</style>
      <div ref={rowRef} className="glass" style={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'flex-end', gap: GAP, padding: `10px ${PAD_X}px`,
        borderRadius: 24, boxShadow: 'var(--shadow-pop)', maxWidth: `calc(100vw - ${SIDE_MARGIN}px)`,
      }}>
        {visible.map((item, idx) => {
          const isPin = pinned && idx === 0
          return (
            <Fragment key={item.to}>
              {AppTile(item, !isPin)}
              {isPin && (
                <span aria-hidden style={{
                  alignSelf: 'center', width: 1, height: 40, margin: '0 5px', flexShrink: 0, borderRadius: 1,
                  background: 'color-mix(in srgb, var(--color-text) 18%, transparent)',
                }} />
              )}
            </Fragment>
          )
        })}

        {overflow.length > 0 && (
          <div ref={moreRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              title="เพิ่มเติม"
              onClick={() => setMoreOpen(o => !o)}
              className="dock-app"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: ITEM_W, flexShrink: 0,
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
              }}
            >
              <span style={{ position: 'relative', transition: 'transform 0.15s', transform: moreOpen ? 'translateY(-2px)' : 'none' }}>
                <IconTile icon="more" tint={['#8E8E93', '#B0B0B5']} active={moreOpen || overflowActive} size={44} />
                {!moreOpen && overflowActive && <span style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: 'var(--color-accent)', border: '1.5px solid var(--color-card-solid)' }} />}
              </span>
              <span style={{ fontSize: 9, fontWeight: (moreOpen || overflowActive) ? 700 : 500, lineHeight: 1.1, textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: (moreOpen || overflowActive) ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>เพิ่มเติม</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: (moreOpen || overflowActive) ? 'var(--color-accent)' : 'transparent', transition: 'background 0.15s' }} />
            </button>

            {showPanel && (
              <div
                className="glass"
                onAnimationEnd={(e) => { if (e.target === e.currentTarget && !moreOpen) setMoreRender(false) }}
                style={{
                  position: 'absolute', bottom: 'calc(100% + 12px)', right: 0,
                  display: 'grid', gridTemplateColumns: `repeat(${cols}, ${ITEM_W}px)`, gap: GAP,
                  padding: 10, borderRadius: 20, boxShadow: 'var(--shadow-pop)', zIndex: 40,
                  transformOrigin: 'bottom right', willChange: 'transform, opacity',
                  pointerEvents: moreOpen ? 'auto' : 'none',
                  // No entrance animation while dragging so slot centres measure clean.
                  animation: dragKey ? 'none' : `${moreOpen ? 'dockMoreIn' : 'dockMoreOut'} 0.18s ease-out both`,
                }}
              >
                {overflow.map(item => AppTile(item, true))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Free-floating drag ghost — moved imperatively, follows the pointer anywhere. */}
      {ghostItem && createPortal(
        <div ref={ghostRef} style={{
          position: 'fixed', left: 0, top: 0, width: ITEM_W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          pointerEvents: 'none', zIndex: 9999, transformOrigin: 'center top', willChange: 'transform',
          filter: 'drop-shadow(0 12px 22px rgba(0,0,0,0.45))',
        }}>
          <IconTile icon={ghostItem.icon} tint={navTint(NAV.indexOf(ghostItem))} active size={44} />
          <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.1, textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-accent)' }}>{ghostItem.label}</span>
        </div>,
        document.body,
      )}
    </div>
  )
}
