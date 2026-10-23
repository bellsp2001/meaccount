// Unified line-icon set for the app modules.
// Each entry is the inner markup of a 24x24, stroke-based icon. Icons inherit
// `currentColor`, so the caller controls the tint. Keeping them in one place
// makes the dock / top-bar read as a single, modern icon system instead of a
// mix of unicode glyphs and emoji.

const P: Record<string, JSX.Element> = {
  // Dashboard — 4-pane grid
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  // Accounts Receivable — money coming in (arrow into wallet)
  receivable: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M16 12h1.5" />
      <path d="M12 2v7m0 0 2.5-2.5M12 9 9.5 6.5" />
    </>
  ),
  // Accounts Payable — money going out
  payable: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M16 12h1.5" />
      <path d="M12 9V2m0 7-2.5-2.5M12 9l2.5-2.5" />
    </>
  ),
  // General Ledger — open book
  ledger: (
    <>
      <path d="M12 6.5C10.5 5 8 4.5 5 4.5A1 1 0 0 0 4 5.5v12a1 1 0 0 0 1 1c3 0 5.5.5 7 2 1.5-1.5 4-2 7-2a1 1 0 0 0 1-1v-12a1 1 0 0 0-1-1c-3 0-5.5.5-7 2z" />
      <path d="M12 6.5v13" />
    </>
  ),
  // POS — storefront
  pos: (
    <>
      <path d="M4 9h16l-1-4.5A1 1 0 0 0 18 4H6a1 1 0 0 0-1 .5z" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  // Inventory — stacked boxes
  inventory: (
    <>
      <path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z" />
      <path d="M3.5 8.5 12 13l8.5-4.5" />
      <path d="M12 13v7" />
    </>
  ),
  // Payroll — wallet with coin
  payroll: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.5" />
    </>
  ),
  // Leave / HR — calendar
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  // Tax — receipt with percent
  tax: (
    <>
      <path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z" />
      <path d="M9.5 9.5h.01M14.5 14.5h.01M15 9l-6 6" />
    </>
  ),
  // Document templates — layout template
  template: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M3.5 9h17M9 9v11.5" />
    </>
  ),
  // Reports — bar chart
  reports: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 20v-6M12.5 20V9M17 20v-9" />
    </>
  ),
  // AI Assistant — sparkle
  ai: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  // Audit — magnifier over checklist
  audit: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.2 15.2 20 20" />
      <path d="M7.8 10.6l1.8 1.8 3.4-3.6" />
    </>
  ),
  // Companies / group — office buildings
  building: (
    <>
      <path d="M4 21V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15" />
      <path d="M13 21V10h6a1 1 0 0 1 1 1v10" />
      <path d="M7 9h3M7 13h3M7 17h3M16 14h1M16 17h1" />
    </>
  ),
  // Users — team
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17 14.7c2.3.6 4 2.6 4 5.3" />
    </>
  ),
  // More / overflow — ellipsis
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
}

export type IconName = keyof typeof P

/** Render a unified line icon. Falls back to raw text for unknown keys
 *  (keeps legacy glyphs like "•••" working). */
export function AppIcon({ name, size = 22, strokeWidth = 1.9 }: { name: string; size?: number; strokeWidth?: number }) {
  const inner = P[name]
  if (!inner) return <span style={{ fontSize: size * 0.9 }}>{name}</span>
  const filled = name === 'more'
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {inner}
    </svg>
  )
}
