import type { UserRole } from '@/types'
import { AppIcon } from './icons'

/** `roles` narrows a sub-item below its parent's roles; omitted means the parent's roles.
 *  `section` starts a titled group in the sub-menu; it carries over to the items after it. */
export interface SubItem { to: string; label: string; roles?: UserRole[]; section?: string }
export interface NavItem { to: string; icon: string; label: string; roles: UserRole[]; badge?: string; children?: SubItem[] }

export const NAV: NavItem[] = [
  { to: '/dashboard', icon: 'dashboard', label: 'แดชบอร์ด', roles: ['admin','accountant','cashier','inventory','manager','auditor'] },
  {
    to: '/ar', icon: 'receivable', label: 'การขาย/รายได้', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/ar/quotations',   label: 'ใบเสนอราคา' },
      { to: '/ar/orders',       label: 'ใบสั่งขาย/คำสั่งขาย' },
      { to: '/ar',              label: 'ใบแจ้งหนี้' },
      { to: '/ar/tax-invoices', label: 'ใบกำกับภาษี' },
      { to: '/ar/receipts',     label: 'ใบเสร็จรับเงิน/การชำระเงิน' },
      { to: '/ar/deposits',     label: 'ใบรับมัดจำ' },
      { to: '/ar/credit-notes', label: 'ใบลดหนี้' },
      { to: '/ar/debit-notes',  label: 'ใบเพิ่มหนี้' },
      { to: '/ar/books',        label: 'สมุดบันทึก', roles: ['admin','accountant'] },
    ],
  },
  {
    to: '/ap', icon: 'payable', label: 'รายจ่าย/ค่าใช้จ่าย', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/ap/rfq',          label: 'ใบขอเสนอราคา' },
      { to: '/ap/orders',       label: 'ใบสั่งซื้อ/คำสั่งซื้อ' },
      { to: '/ap',              label: 'ใบแจ้งหนี้' },
      { to: '/ap/tax-invoices', label: 'ใบกำกับภาษี' },
      { to: '/ap/payments',     label: 'ใบเสร็จรับเงิน/การชำระเงิน' },
      { to: '/ap/deposits',     label: 'ใบจ่ายมัดจำ' },
      { to: '/ap/credit-notes', label: 'ใบลดหนี้' },
      { to: '/ap/debit-notes',  label: 'ใบเพิ่มหนี้' },
      { to: '/ap/books',        label: 'สมุดบันทึก', roles: ['admin','accountant'] },
    ],
  },
  {
    to: '/contacts', icon: 'contacts', label: 'ผู้ติดต่อ', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/contacts',        label: 'รายชื่อผู้ติดต่อ' },
      { to: '/contacts/groups', label: 'กลุ่มประเภทลูกค้า' },
    ],
  },
  {
    to: '/gl', icon: 'ledger', label: 'การบัญชี', roles: ['admin','accountant'],
    children: [
      { to: '/gl',         label: 'ผังบัญชี' },
      { to: '/gl/journal', label: 'สมุดรายวัน' },
      { to: '/gl/tax-types', label: 'ประเภทภาษี' },
    ],
  },
  { to: '/pos', icon: 'pos', label: 'POS หน้าร้าน', roles: ['admin','cashier','accountant'], badge: 'New' },
  {
    to: '/inventory', icon: 'inventory', label: 'สินค้าคงคลัง', roles: ['admin','inventory','accountant'],
    children: [
      { to: '/inventory',           label: 'รายการสินค้า' },
      { to: '/inventory/movements', label: 'รับ/จ่ายสินค้า' },
    ],
  },
  { to: '/payroll',   icon: 'payroll', label: 'เงินเดือน',    roles: ['admin','accountant'] },
  {
    to: '/leave/my', icon: 'calendar', label: 'ลา/HR', roles: ['admin','accountant','manager','cashier','inventory'], badge: 'New',
    children: [
      { to: '/leave/my',         label: 'วันลาของฉัน' },
      { to: '/leave/approvals',  label: 'อนุมัติวันลา' },
      { to: '/leave/calendar',   label: 'ปฏิทินทีม' },
    ],
  },
  { to: '/tax',       icon: 'tax', label: 'ภาษี',         roles: ['admin','accountant'] },
  { to: '/doc-templates', icon: 'template', label: 'เทมเพลตเอกสาร', roles: ['admin'], badge: 'New' },
  {
    to: '/reports', icon: 'reports', label: 'รายงาน', roles: ['admin','accountant','manager','auditor'],
    children: [
      { to: '/reports',               label: 'งบการเงิน',          section: 'งบการเงิน' },
      { to: '/reports/trial-balance', label: 'งบทดลอง',            section: 'รายงานทางบัญชี' },
      { to: '/reports/ledger',        label: 'บัญชีแยกประเภท' },
      { to: '/reports/builder',       label: 'Report Builder' },
      { to: '/reports/ask',           label: 'ถามด้วยภาษาพูด',     roles: ['admin','accountant','manager'] },
      { to: '/analytics',             label: 'Predictive Analytics', roles: ['admin','accountant','manager'] },
      { to: '/reports/sales',         label: 'รายงานการขาย',       section: 'รายงานการขาย/รายได้', roles: ['admin','accountant'] },
      { to: '/reports/ar-aging',      label: 'อายุลูกหนี้',          roles: ['admin','accountant'] },
      { to: '/reports/expenses',      label: 'รายงานค่าใช้จ่าย',    section: 'รายงานรายจ่าย/ค่าใช้จ่าย', roles: ['admin','accountant'] },
      { to: '/reports/ap-aging',      label: 'อายุเจ้าหนี้',         roles: ['admin','accountant'] },
    ],
  },
  { to: '/ai-chat',   icon: 'ai', label: 'AI Assistant', roles: ['admin','accountant','manager'], badge: 'Beta' },
  {
    to: '/audit', icon: 'audit', label: 'AI Audit', roles: ['admin','manager','auditor'],
    children: [
      { to: '/audit', label: 'AI Audit' },
      { to: '/fraud', label: 'Fraud Detection' },
    ],
  },
  {
    to: '/documents', icon: 'documents', label: 'Document AI', roles: ['admin','accountant','cashier'],
    children: [
      { to: '/documents',       label: 'Document Center' },
      { to: '/documents/match', label: '3-Way Match' },
    ],
  },
  {
    to: '/companies', icon: 'building', label: 'บริษัทในเครือ', roles: ['admin','accountant'], badge: 'New',
    children: [
      { to: '/companies',             label: 'บริษัททั้งหมด' },
      { to: '/companies/consolidated', label: 'งบการเงินรวม' },
    ],
  },
  {
    // Platform/admin tools grouped under one entry; each page keeps its own role from App.tsx.
    to: '/developer/integrations', icon: 'settings', label: 'ตั้งค่าระบบ', roles: ['admin','accountant'],
    children: [
      { to: '/developer/integrations', label: 'Integrations' },
      { to: '/developer/keys',         label: 'API Keys',             roles: ['admin'] },
      { to: '/ai-ops/profiles',        label: 'Prompt Profiles',      roles: ['admin'] },
      { to: '/ai-ops/ab-testing',      label: 'A/B Testing' },
      { to: '/security/compliance',    label: 'Compliance Scanner',   roles: ['admin'] },
      { to: '/security/dsr',           label: 'Data Requests (PDPA)', roles: ['admin'] },
      { to: '/ops/readiness',          label: 'Go-Live Readiness',    roles: ['admin'] },
    ],
  },
  { to: '/users',     icon: 'users', label: 'จัดการผู้ใช้', roles: ['admin'] },
]

// iOS home-screen palette — a stable hue per app so the dock reads like a
// colourful, frosted app grid.
export const ICON_TINTS: [string, string][] = [
  ['#0A84FF', '#4CA5FF'], ['#30D158', '#4BE36F'], ['#FF9F0A', '#FFBD4D'],
  ['#FF375F', '#FF6A86'], ['#BF5AF2', '#D68BFF'], ['#64D2FF', '#93E2FF'],
  ['#5E5CE6', '#8A88FF'], ['#FF6482', '#FF97AC'], ['#FFD60A', '#FFE45C'],
  ['#32ADE6', '#6FC7F0'],
]
export const navTint = (i: number): [string, string] => ICON_TINTS[i % ICON_TINTS.length]

export function allowedNav(role?: string): NavItem[] {
  return NAV
    .filter(n => role && n.roles.includes(role as UserRole))
    .map(n => {
      if (!n.children) return n
      // Resolve each item's section before filtering, so a hidden first item doesn't take its heading with it.
      let section: string | undefined
      const children = n.children
        .map(c => ({ ...c, section: (section = c.section ?? section) }))
        .filter(c => !c.roles || c.roles.includes(role as UserRole))
      return { ...n, children }
    })
}

/** Resolve the top-level app that owns the current path. An exact route match wins over a
 *  path prefix, so /ar/tax-invoices belongs to การขาย rather than to a parent at /ar. */
export function findActiveNav(pathname: string, items: NavItem[] = NAV): NavItem | undefined {
  return items.find(item => pathname === item.to || item.children?.some(c => pathname === c.to))
    ?? items.find(item => pathname.startsWith(item.to + '/') && item.to !== '/dashboard')
}

/** Frosted iOS-style squircle icon tile with a unified line icon. */
export function IconTile({ icon, tint, active, size = 30 }: { icon: string; tint: [string, string]; active: boolean; size?: number }) {
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: Math.round(size * 0.3),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: `color-mix(in srgb, ${tint[0]} ${active ? 100 : 88}%, var(--color-text-primary))`,
      background: `linear-gradient(150deg, color-mix(in srgb, ${tint[0]} ${active ? 46 : 26}%, transparent), color-mix(in srgb, ${tint[1]} ${active ? 32 : 17}%, transparent))`,
      border: `1px solid color-mix(in srgb, ${tint[0]} ${active ? 60 : 34}%, transparent)`,
      boxShadow: `inset 0 1px 0 var(--glass-hi), 0 3px 10px -4px color-mix(in srgb, ${tint[0]} 55%, transparent)`,
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      transition: 'all 0.15s',
    }}>
      <AppIcon name={icon} size={Math.round(size * 0.56)} strokeWidth={size >= 40 ? 1.8 : 2} />
    </span>
  )
}
