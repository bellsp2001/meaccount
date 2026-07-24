import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import type { UserRole } from '@/types'

interface SubItem { to: string; label: string }
interface NavItem { to: string; icon: string; label: string; roles: UserRole[]; badge?: string; children?: SubItem[] }

const NAV: NavItem[] = [
  { to: '/dashboard', icon: '◈', label: 'แดชบอร์ด', roles: ['admin','accountant','cashier','inventory','manager','auditor'] },
  {
    to: '/ar', icon: '⬆', label: 'ลูกหนี้ (AR)', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/ar',           label: 'ใบแจ้งหนี้' },
      { to: '/ar/customers', label: 'รายชื่อลูกค้า' },
      { to: '/ar/aging',     label: 'รายงานอายุหนี้' },
    ],
  },
  {
    to: '/ap', icon: '⬇', label: 'เจ้าหนี้ (AP)', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/ap',            label: 'บิล / ค่าใช้จ่าย' },
      { to: '/ap/suppliers',  label: 'รายชื่อผู้จำหน่าย' },
    ],
  },
  {
    to: '/gl', icon: '⚖', label: 'บัญชีแยกประเภท', roles: ['admin','accountant'],
    children: [
      { to: '/gl',         label: 'ผังบัญชี' },
      { to: '/gl/journal', label: 'สมุดรายวัน' },
    ],
  },
  {
    to: '/inventory', icon: '▦', label: 'สินค้าคงคลัง', roles: ['admin','inventory','accountant'],
    children: [
      { to: '/inventory',           label: 'รายการสินค้า' },
      { to: '/inventory/movements', label: 'รับ/จ่ายสินค้า' },
    ],
  },
  { to: '/payroll',   icon: '◎', label: 'เงินเดือน',    roles: ['admin','accountant'] },
  { to: '/tax',       icon: '⬡', label: 'ภาษี',         roles: ['admin','accountant'] },
  {
    to: '/reports', icon: '◉', label: 'รายงาน', roles: ['admin','accountant','manager','auditor'],
    children: [
      { to: '/reports',         label: 'งบการเงิน' },
      { to: '/reports/builder', label: 'Report Builder' },
      { to: '/reports/ask',     label: 'ถามด้วยภาษาพูด' },
    ],
  },
  { to: '/ai-chat',   icon: '🤖', label: 'AI Assistant', roles: ['admin','accountant','manager'], badge: 'Beta' },
  { to: '/audit',     icon: '🔍', label: 'AI Audit',       roles: ['admin','manager','auditor'] },
  { to: '/fraud',     icon: '🛡️', label: 'Fraud Detection', roles: ['admin','manager','auditor'] },
  { to: '/analytics', icon: '📈', label: 'Predictive Analytics', roles: ['admin','accountant','manager'] },
  {
    to: '/documents', icon: '📁', label: 'Document AI', roles: ['admin','accountant','cashier'], badge: 'New',
    children: [
      { to: '/documents',       label: 'Document Center' },
      { to: '/documents/match', label: '3-Way Match' },
    ],
  },
  {
    to: '/companies', icon: '🏢', label: 'บริษัทในเครือ', roles: ['admin','accountant'], badge: 'New',
    children: [
      { to: '/companies',             label: 'บริษัททั้งหมด' },
      { to: '/companies/consolidated', label: 'งบการเงินรวม' },
    ],
  },
  {
    to: '/developer', icon: '🔌', label: 'Developer', roles: ['admin','accountant'], badge: 'New',
    children: [
      { to: '/developer/keys',         label: 'API Keys' },
      { to: '/developer/integrations', label: 'Integrations' },
    ],
  },
  {
    to: '/ai-ops', icon: '🧠', label: 'AI Ops', roles: ['admin','accountant'], badge: 'New',
    children: [
      { to: '/ai-ops/profiles',    label: 'Prompt Profiles' },
      { to: '/ai-ops/ab-testing',  label: 'A/B Testing' },
    ],
  },
  {
    to: '/security', icon: '🛡️', label: 'Security & Compliance', roles: ['admin'], badge: 'New',
    children: [
      { to: '/security/compliance', label: 'Compliance Scanner' },
      { to: '/security/dsr',        label: 'Data Requests (PDPA)' },
    ],
  },
  { to: '/ops/readiness', icon: '🚀', label: 'Go-Live Readiness', roles: ['admin'], badge: 'New' },
  { to: '/users',     icon: '👥', label: 'จัดการผู้ใช้', roles: ['admin'] },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const allowed = NAV.filter(n => user && n.roles.includes(user.role as UserRole))

  const isGroupActive = (item: NavItem) =>
    pathname === item.to ||
    item.children?.some(c => pathname === c.to) ||
    (pathname.startsWith(item.to + '/') && item.to !== '/dashboard')

  return (
    <aside style={{ width: 232, minHeight: '100vh', background: '#0A0C12', borderRight: '1px solid #151C28', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid #151C28' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#07090E', fontSize: 18, boxShadow: '0 0 16px #00D4AA33', flexShrink: 0 }}>M</div>
        <div>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>Me<span style={{ color: '#00D4AA' }}>Account</span></p>
          <p style={{ margin: 0, fontSize: 9, color: '#2A3A50', textTransform: 'uppercase', letterSpacing: '0.15em' }}>AI Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        <p style={{ margin: '0 0 8px', padding: '0 10px', fontSize: 9, fontWeight: 700, color: '#2A3A50', textTransform: 'uppercase', letterSpacing: '0.15em' }}>เมนูหลัก</p>
        {allowed.map(item => {
          const active = isGroupActive(item)
          return (
            <div key={item.to}>
              <NavLink to={item.to} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, marginBottom: 2,
                textDecoration: 'none', fontSize: 13, transition: 'all 0.15s',
                background: active ? '#00D4AA12' : 'transparent',
                color: active ? '#00D4AA' : '#5A6A80',
                fontWeight: active ? 600 : 400,
              }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 15 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && <span style={{ fontSize: 9, fontWeight: 700, background: '#00D4AA20', color: '#00D4AA', border: '1px solid #00D4AA30', padding: '1px 6px', borderRadius: 10 }}>{item.badge}</span>}
                {item.children && <span style={{ fontSize: 9, color: '#3A4A60' }}>{active ? '▾' : '▸'}</span>}
              </NavLink>
              {item.children && active && (
                <div style={{ marginLeft: 30, marginBottom: 4 }}>
                  {item.children.map(child => (
                    <NavLink key={child.to} to={child.to} end style={({ isActive }) => ({
                      display: 'block', padding: '6px 10px', borderRadius: 6, marginBottom: 1,
                      textDecoration: 'none', fontSize: 12, transition: 'all 0.12s',
                      color: isActive ? '#00D4AA' : '#4A5A70',
                      background: isActive ? '#00D4AA0A' : 'transparent',
                      fontWeight: isActive ? 600 : 400,
                    })}>
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ borderTop: '1px solid #151C28', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#07090E', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
            {user?.full_name?.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#DDE3EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name}</p>
            <p style={{ margin: 0, fontSize: 10, color: '#3A4A60', textTransform: 'capitalize' }}>{user?.role}</p>
          </div>
          <button onClick={() => { logout(); navigate('/login') }} title="ออกจากระบบ" style={{ background: 'none', border: 'none', color: '#3A4A60', cursor: 'pointer', fontSize: 14, padding: 4 }}>⏻</button>
        </div>
      </div>
    </aside>
  )
}
