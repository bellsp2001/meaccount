import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { AppIcon } from '@/config/icons'
import { allowedNav, findActiveNav } from '@/config/nav'

// Glassy Sidebar V3 — purple/blue frosted panel, collapsible, with the MeAccount
// brand logo and an icon menu wired to the real nav.
export function Sidebar() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Narrow windows start (and fall back to) icon width so the content keeps usable room;
  // the toggle still expands it on demand.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const onChange = (e: MediaQueryListEvent) => setCollapsed(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const apps = allowedNav(user?.role)
  const active = findActiveNav(pathname, apps)

  const go = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(to) }

  // One module open at a time; follows the route so deep links reveal their sub-menu.
  const [openTo, setOpenTo] = useState<string | undefined>(active?.to)
  useEffect(() => { setOpenTo(active?.to) }, [active?.to])

  const clickParent = (to: string, hasChildren: boolean) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (collapsed && hasChildren) {
      // Sub-items can't show at icon width, so expand rather than leave them unreachable.
      setCollapsed(false)
      setOpenTo(to)
    } else if (hasChildren && openTo === to && active?.to === to) {
      setOpenTo(undefined)
      return
    } else {
      setOpenTo(to)
    }
    navigate(to)
  }

  // Longest matching route, so a detail page under /ar/orders marks "คำสั่งขาย" rather than /ar.
  const activeSub = active?.children
    ?.filter(t => pathname === t.to || pathname.startsWith(`${t.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]

  return (
    <aside className={`gsb-sidebar chrome-panel${collapsed ? ' collapsed' : ''}`}>
      <style>{GSB_CSS}</style>

      {/* brand logo */}
      <button className="gsb-logo-row" onClick={() => navigate('/dashboard')} aria-label="MeAccount">
        <img className="gsb-logo-img" src="/meaccount-logo.png" alt="MeAccount" />
        <span className="gsb-logo-text">Me<span>Account</span></span>
      </button>

      {/* collapse toggle */}
      <button className="gsb-toggle" onClick={() => setCollapsed(c => !c)} aria-label="Toggle sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      <div className="gsb-divider" />

      <div className="gsb-label">เมนู</div>

      {/* main menu */}
      <ul className="gsb-menu gsb-scroll">
        {apps.map(item => {
          const hasChildren = !!item.children?.length
          const expanded = hasChildren && !collapsed && openTo === item.to
          return (
            <li key={item.to}>
              <a href={item.to} onClick={clickParent(item.to, hasChildren)} data-title={item.label} aria-expanded={hasChildren ? expanded : undefined} className={active?.to === item.to ? 'active' : undefined}>
                <AppIcon name={item.icon} size={21} strokeWidth={1.8} />
                <span className="gsb-text">{item.label}</span>
                {item.badge && <span className="gsb-badge">{item.badge}</span>}
                {hasChildren && (
                  <svg className={`gsb-chev${expanded ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                )}
              </a>
              {hasChildren && (
                <div className={`gsb-sub${expanded ? ' open' : ''}`}>
                  <ul>
                    {item.children!.flatMap((t, i, all) => [
                      ...(t.section && t.section !== all[i - 1]?.section
                        ? [<li key={`sec:${t.section}`} className="gsb-subsec" role="presentation">{t.section}</li>]
                        : []),
                      <li key={t.to}>
                        <a href={t.to} onClick={go(t.to)} aria-current={activeSub?.to === t.to ? 'page' : undefined}>{t.label}</a>
                      </li>,
                    ])}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

const NARROW = '(max-width: 860px)'

const GSB_CSS = `
.gsb-sidebar {
  position: relative; width: 232px; flex-shrink: 0; padding: 14px 10px 16px;
  border-radius: 26px;
  display: flex; flex-direction: column; min-height: 0;
  transition: width .4s cubic-bezier(.65,0,.35,1); will-change: width;
}
.gsb-sidebar.collapsed { width: 64px; padding-left: 8px; padding-right: 8px; }

.gsb-logo-row { display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 6px;
  background: none; border: none; cursor: pointer; width: 100%;
  transition: gap .4s cubic-bezier(.65,0,.35,1), padding .4s cubic-bezier(.65,0,.35,1); }
/* 3D mark from chained drop-shadows: a few stacked 1px layers for thickness, then a soft cast
   shadow. The mark's black stroke would vanish on dark glass, so the dark theme adds a hairline
   light rim around the silhouette. */
.gsb-logo-img { width: 50px; height: auto; display: block; flex-shrink: 0;
  --logo-rim: drop-shadow(0 0 .15px rgba(255,255,255,.7));
  --logo-edge: rgba(8,5,22,.9);
  --logo-cast: rgba(0,0,0,.6);
  filter: var(--logo-rim)
    drop-shadow(0 1px 0 var(--logo-edge)) drop-shadow(0 1px 0 var(--logo-edge)) drop-shadow(0 1px 0 var(--logo-edge))
    drop-shadow(0 7px 7px var(--logo-cast));
  transition: width .4s cubic-bezier(.65,0,.35,1); }
:root[data-theme="light"] .gsb-logo-img { --logo-rim: drop-shadow(0 0 0 transparent); --logo-edge: rgba(40,30,70,.32); --logo-cast: rgba(40,30,70,.38); }
.gsb-sidebar.collapsed .gsb-logo-img { width: 32px; } /* clears the toggle that overhangs the edge */
.gsb-logo-text { font-family: var(--font-display); font-weight: 800; font-size: 18px; letter-spacing: -0.03em;
  white-space: nowrap; color: var(--chrome-text); max-width: 170px; overflow: hidden; opacity: 1;
  transition: opacity .28s ease, max-width .4s cubic-bezier(.65,0,.35,1); }
.gsb-logo-text span { color: var(--color-accent); }
.gsb-sidebar.collapsed .gsb-logo-row { gap: 0; padding: 0; justify-content: center; }
.gsb-sidebar.collapsed .gsb-logo-text { opacity: 0; max-width: 0; }

.gsb-toggle { position: absolute; top: 20px; right: -16px; width: 34px; height: 34px; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer; z-index: 3;
  background: var(--chrome-toggle); border: none;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 2px 3px rgba(40,30,70,.22), 0 8px 14px -3px rgba(40,30,70,.3);
  color: var(--chrome-text); transition: transform .4s cubic-bezier(.65,0,.35,1); }
.gsb-toggle svg { width: 16px; height: 16px; }
.gsb-sidebar.collapsed .gsb-toggle { transform: rotate(180deg); width: 28px; height: 28px; right: -14px; top: 23px; }

.gsb-divider { height: 1px; background: var(--chrome-line); margin: 14px 6px; flex-shrink: 0; }

.gsb-label { font-size: 10px; letter-spacing: 1.5px; color: var(--chrome-text-soft); padding: 0 12px; margin: 2px 0 8px; flex-shrink: 0; }
.gsb-sidebar.collapsed .gsb-label { text-align: center; padding: 0; font-size: 9px; }

.gsb-menu { list-style: none; display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; }
.gsb-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.gsb-scroll::-webkit-scrollbar { width: 6px; }
.gsb-scroll::-webkit-scrollbar-thumb { background: var(--chrome-line); border-radius: 6px; }
.gsb-menu a { position: relative; display: flex; align-items: center; gap: 10px; height: 39px; padding: 0 11px;
  border-radius: 12px; border: 1px solid transparent; color: var(--chrome-text); text-decoration: none; font-size: 13.5px;
  white-space: nowrap; overflow: hidden;
  transition: background .25s, border-color .25s, padding .4s cubic-bezier(.65,0,.35,1), gap .4s cubic-bezier(.65,0,.35,1); }
.gsb-menu a:hover { background: var(--chrome-hover); }
.gsb-menu a.active { background: var(--chrome-active);
  box-shadow: 0 1px 3px rgba(40,30,70,.14), 0 6px 12px -4px rgba(40,30,70,.2); }
.gsb-menu svg { width: 21px; height: 21px; flex-shrink: 0; }
.gsb-text { max-width: 170px; opacity: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: opacity .28s ease, max-width .4s cubic-bezier(.65,0,.35,1); }
.gsb-badge { margin-left: auto; padding: 0 6px; height: 19px; border-radius: 999px; background: var(--chrome-badge-bg); color: var(--chrome-badge-text);
  font-size: 10px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }

.gsb-menu svg.gsb-chev { width: 14px; height: 14px; margin-left: auto; opacity: .65; transition: transform .28s cubic-bezier(.65,0,.35,1); }
.gsb-menu svg.gsb-chev.open { transform: rotate(180deg); }
.gsb-badge + svg.gsb-chev { margin-left: 6px; }
.gsb-sidebar.collapsed .gsb-menu svg.gsb-chev { display: none; }

/* slide-down: animate the row track so any number of sub-items needs no measuring */
.gsb-sub { display: grid; grid-template-rows: 0fr; visibility: hidden;
  transition: grid-template-rows .28s cubic-bezier(.65,0,.35,1), visibility .28s; }
.gsb-sub.open { grid-template-rows: 1fr; visibility: visible; }
.gsb-sub > ul { min-height: 0; overflow: hidden; list-style: none; margin: 0; padding: 0 0 0 20px; }
.gsb-sub li:first-child { padding-top: 3px; }
.gsb-sub li:last-child { padding-bottom: 3px; }
.gsb-menu .gsb-sub a { height: 32px; padding: 0 10px 0 14px; border-radius: 10px; font-size: 13px; color: var(--chrome-text-soft); }
.gsb-menu .gsb-sub a:hover { color: var(--chrome-text); }
/* Section heading: outdented past the items and set bold/dark so it reads as a divider, not a link. */
.gsb-sub .gsb-subsec { margin-left: -8px; padding: 10px 10px 4px 4px; font-size: 11.5px; font-weight: 800; letter-spacing: .02em;
  color: var(--chrome-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsb-sub .gsb-subsec:first-child { padding-top: 6px; }
.gsb-menu .gsb-sub a[aria-current="page"] { color: var(--color-accent-strong); font-weight: 700; background: var(--chrome-hover); }
:root:not([data-theme="light"]) .gsb-menu .gsb-sub a[aria-current="page"] { color: var(--color-accent-light); }
@media (prefers-reduced-motion: reduce) { .gsb-sub, .gsb-menu svg.gsb-chev { transition: none; } }

.gsb-sidebar.collapsed .gsb-menu a { gap: 0; padding: 0; justify-content: center; }
.gsb-sidebar.collapsed .gsb-text { opacity: 0; max-width: 0; }
.gsb-sidebar.collapsed .gsb-badge { position: absolute; top: 8px; left: 50%; margin-left: 6px;
  min-width: 8px; width: 8px; height: 8px; padding: 0; font-size: 0; }
.gsb-sidebar.collapsed .gsb-menu a { overflow: visible; }
.gsb-sidebar.collapsed .gsb-menu a:hover::after { content: attr(data-title); position: absolute; left: 54px;
  padding: 6px 12px; border-radius: 8px; background: rgba(20,15,40,.95); color: #fff; font-size: 12px; white-space: nowrap; z-index: 6;
  box-shadow: 0 6px 20px rgba(0,0,0,.5); }
`
