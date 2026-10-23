/**
 * Design tokens shared with the web app for visual consistency.
 */
export const COLORS = {
  bg: '#07090E',
  card: '#0D1018',
  border: '#151C28',
  borderLight: '#1E2A3A',
  text: '#DDE3EE',
  textMuted: '#8A9BB0',
  textDim: '#4A5A70',
  textFaint: '#2A3A50',

  accent: '#00D4AA',
  accentLight: '#4FACFE',
  purple: '#F093FB',
  orange: '#F5A623',
  green: '#43E97B',
  pink: '#FA709A',
  indigo: '#667EEA',
  yellow: '#FED330',
  red: '#FF6B6B',
} as const;

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const RADIUS = { sm: 6, md: 10, lg: 14, xl: 18, full: 999 } as const;

export const FONT_SIZE = { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 26 } as const;

export const ROLE_COLORS: Record<string, string> = {
  admin: COLORS.accent,
  accountant: COLORS.accentLight,
  cashier: COLORS.purple,
  inventory: COLORS.green,
  manager: COLORS.orange,
  auditor: COLORS.indigo,
};
