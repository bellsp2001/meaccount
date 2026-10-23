import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { allowedNav, findActiveNav, navTint, IconTile, NAV, type NavItem } from '@/config/nav'

const WIDTH = 230

export function Sidebar() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const apps = allowedNav(user?.role)
  const active = findActiveNav(pathname, apps)

  return (
    <aside className="glass-bar" style={{
      width: WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRadius: 22, border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden',
    }}>
      {/* Brand */}
      <button
        onClick={() => navigate('/dashboard')}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flexShrink: 0 }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg,var(--color-accent-light),var(--color-accent-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#1A1207', fontSize: 18, fontFamily: 'var(--font-display)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 16px -5px color-mix(in srgb, var(--color-accent) 60%, transparent)', flexShrink: 0 }}>M</div>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 17, lineHeight: 1.1, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Me<span style={{ color: 'var(--color-accent)' }}>Account</span></p>
          <p style={{ margin: 0, fontSize: 8.5, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>AI Platform</p>
        </div>
      </button>

      {/* Main modules */}
      <nav className="nav-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 10px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {apps.map(item => (
          <SideItem key={item.to} item={item} active={active?.to === item.to} onClick={() => navigate(item.to)} />
        ))}
      </nav>

      {/* User footer */}
      <div style={{ padding: '10px 12px 14px', flexShrink: 0, borderTop: '1px solid var(--color-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px' }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--color-accent-light),var(--color-accent-strong))', color: '#1A1207', fontWeight: 700, fontSize: 13, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }}>{user?.full_name?.charAt(0).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name}</span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--color-muted)', textTransform: 'capitalize' }}>{user?.role}</span>
          </span>
        </div>
      </div>
    </aside>
  )
}

function SideItem({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const tint = navTint(NAV.indexOf(item))
  return (
    <button
      onClick={onClick}
      title={item.label}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 12, cursor: 'pointer', position: 'relative',
        border: active ? '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' : '1px solid transparent',
        background: active ? 'color-mix(in srgb, var(--color-accent) 13%, transparent)' : 'transparent',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {active && <span style={{ position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)', width: 3, height: 20, borderRadius: 2, background: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)' }} />}
      <span style={{ position: 'relative', flexShrink: 0 }}>
        <IconTile icon={item.icon} tint={tint} active={active} size={30} />
        {item.badge && <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#FF4D6D', border: '1.5px solid var(--color-card-solid)' }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {item.badge && <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 6px', borderRadius: 999, color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', flexShrink: 0 }}>{item.badge}</span>}
    </button>
  )
}
