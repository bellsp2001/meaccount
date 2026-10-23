import { clsx } from 'clsx'
import type { UserRole } from '@/types'

const roleColors: Record<UserRole, string> = {
  admin:      'bg-[#F2714E20] text-[#F2714E] border-[#F2714E30]',
  accountant: 'bg-[#6E8BB720] text-[#6E8BB7] border-[#6E8BB730]',
  cashier:    'bg-[#F093FB20] text-[#F093FB] border-[#F093FB30]',
  inventory:  'bg-[#43E97B20] text-[#43E97B] border-[#43E97B30]',
  manager:    'bg-[#F5A62320] text-[#F5A623] border-[#F5A62330]',
  auditor:    'bg-[#667EEA20] text-[#667EEA] border-[#667EEA30]',
}
const roleLabels: Record<UserRole, string> = {
  admin: 'Admin', accountant: 'Accountant', cashier: 'Cashier',
  inventory: 'Inventory', manager: 'Manager', auditor: 'Auditor',
}

export function Badge({ role }: { role: UserRole }) {
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border', roleColors[role])}>
      {roleLabels[role]}
    </span>
  )
}
