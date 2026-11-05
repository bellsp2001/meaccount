import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import { useCompanyStore, type Company } from '@/store/company'
import { allowedNav, findActiveNav, navTint, IconTile, NAV } from '@/config/nav'
import { ThemeToggle } from './ThemeToggle'

export function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const apps = allowedNav(user?.role)
  const active = findActiveNav(pathname, apps)
  const title = active?.label ?? 'MeAccount'
  // By route, not identity: allowedNav() returns copies when it filters sub-items by role.
  const tint = active ? navTint(NAV.findIndex(n => n.to === active.to)) : undefined

  return (
    <header className="chrome-panel" style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '11px 18px', flexShrink: 0,
      borderRadius: 26,
    }}>
      <style>{TB_CSS}</style>
      {/* Active module title · user cluster. The row (not the header) is the size container: containment
          would make the header its own stacking context and break the shared .chrome-panel shadow layer. */}
      <div className="tb-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        {/* Left — active-module icon + name */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11 }}>
          {tint && <span className="tb-tile" style={{ display: 'flex', flexShrink: 0 }}><IconTile icon={active!.icon} tint={tint} active size={36} /></span>}
          <div style={{ minWidth: 0 }}>
            <p className="tb-kicker" style={{ margin: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)' }} /> กำลังใช้งาน
            </p>
            <h1 className="tb-title" title={title} style={{ margin: 0, fontSize: 21, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
          </div>
        </div>

        {/* Right — one translucent frame: theme · notifications · company · user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: 5, borderRadius: 14,
          background: 'var(--chrome-hover)',
          boxShadow: '0 1px 3px rgba(40,30,70,.12), 0 6px 12px -4px rgba(40,30,70,.18)' }}>
          <ThemeToggle />
          <button className="tb-bell" title="การแจ้งเตือน" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: 'var(--chrome-text-soft)', cursor: 'pointer', fontSize: 15, position: 'relative' }}>
            🔔
            <span style={{ position: 'absolute', top: 4, right: 6, width: 8, height: 8, borderRadius: '50%', background: '#FF4D6D' }} />
          </button>
          <span className="tb-company" style={{ width: 1, height: 20, background: 'var(--chrome-line)', flexShrink: 0 }} />
          <CompanyChip />
          <span style={{ width: 1, height: 20, background: 'var(--chrome-line)', flexShrink: 0 }} />
          <UserChip name={user?.full_name} role={user?.role} onLogout={() => { logout(); navigate('/login') }} />
        </div>
      </div>
    </header>
  )
}

// Steps down by the bar's own width, which also changes when the sidebar collapses:
// chip labels go first, then the company switcher, then the module tile and kicker, then the bell.
const TB_CSS = `
.tb-row { container-type: inline-size; }
@container (max-width: 640px) { .tb-label { display: none !important; } }
@container (max-width: 420px) { .tb-company { display: none !important; } }
@container (max-width: 300px) { .tb-tile, .tb-kicker { display: none !important; } }
@container (max-width: 220px) { .tb-bell { display: none !important; } }
`

function CompanyChip() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { currentId, setCurrent } = useCompanyStore()
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await (await import('@/lib/api')).default.get('/api/v1/companies/')).data,
    staleTime: 5 * 60_000,
  })
  useOutside(ref, () => setOpen(false))

  const current = companies.find(c => c.id === currentId) ?? companies[0]
  const name = current?.name ?? 'MeAccount'
  const branch = !current ? 'ยังไม่ตั้งค่าบริษัท' : current.parent_company_id ? 'บริษัทในเครือ' : 'สำนักงานใหญ่'

  return (
    <div ref={ref} className="tb-company" style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title={name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 6px', borderRadius: 10, background: 'transparent', border: 'none', cursor: 'pointer', maxWidth: 200 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 13, background: 'linear-gradient(135deg,#3B6FE0,#5A5CE0)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }}>🏢</span>
        <span className="tb-label" style={{ minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{ display: 'block', fontSize: 9.5, color: 'var(--color-muted)' }}>{branch}</span>
        </span>
        <span className="tb-label" style={{ fontSize: 9, color: 'var(--color-dim)' }}>▾</span>
      </button>
      {open && (
        <div className="glass" style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 240, borderRadius: 14, padding: 6, boxShadow: 'var(--shadow-pop)', zIndex: 40 }}>
          <p style={{ margin: 0, padding: '6px 10px', fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>เลือกบริษัท / สาขา</p>
          {companies.length === 0 && <p style={{ margin: 0, padding: '8px 10px', fontSize: 12, color: 'var(--color-muted)' }}>ยังไม่มีบริษัทในระบบ</p>}
          {companies.map(c => {
            const sel = c.id === current?.id
            return (
              <button key={c.id} onClick={() => { setCurrent(c.id); setOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: sel ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent' }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, background: 'linear-gradient(135deg,#3B6FE0,#5A5CE0)' }}>🏢</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--color-muted)' }}>{c.parent_company_id ? 'บริษัทในเครือ' : 'สำนักงานใหญ่'} · {c.code}</span>
                </span>
                {sel && <span style={{ color: 'var(--color-accent)', fontSize: 13 }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UserChip({ name, role, onLogout }: { name?: string; role?: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', borderRadius: 999, background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--color-accent-light),var(--color-accent-strong))', color: '#1A1207', fontWeight: 700, fontSize: 12, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }}>{name?.charAt(0).toUpperCase()}</span>
        <span className="tb-label" style={{ textAlign: 'left', paddingRight: 2 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{ display: 'block', fontSize: 9.5, color: 'var(--color-muted)', textTransform: 'capitalize' }}>{role}</span>
        </span>
      </button>
      {open && (
        <div className="glass" style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 170, borderRadius: 14, padding: 6, boxShadow: 'var(--shadow-pop)', zIndex: 40 }}>
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'transparent', color: '#FF4D6D', fontSize: 13, fontWeight: 600 }}>
            <span>⏻</span> ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}

function useOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) cb() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  })
}
