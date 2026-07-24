import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'

const TITLES: Record<string, string> = {
  '/dashboard': 'แดชบอร์ด', '/users': 'จัดการผู้ใช้งาน',
  '/ar': 'บัญชีลูกหนี้ (AR)', '/ap': 'บัญชีเจ้าหนี้ (AP)',
  '/gl': 'บัญชีแยกประเภท', '/ai-chat': 'AI Assistant', '/reports': 'รายงาน',
}

export function TopBar() {
  const { pathname } = useLocation()
  const { user } = useAuthStore()
  return (
    <header style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#07090E', borderBottom: '1px solid #151C28', flexShrink: 0 }}>
      <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{TITLES[pathname] ?? 'MeAccount'}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ background: 'none', border: 'none', color: '#4A5A70', cursor: 'pointer', fontSize: 16, position: 'relative' }}>🔔</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0D1018', border: '1px solid #1E2A3A', borderRadius: 8, padding: '6px 12px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00D4AA', display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: '#6A7A90', textTransform: 'capitalize', fontWeight: 500 }}>{user?.role}</span>
        </div>
      </div>
    </header>
  )
}
