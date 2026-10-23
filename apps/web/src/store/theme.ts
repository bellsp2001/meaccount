import { create } from 'zustand'

type ThemeMode = 'dark' | 'light' | 'system'
type Resolved = 'dark' | 'light'

interface ThemeState {
  mode: ThemeMode
  resolved: Resolved
  setMode: (mode: ThemeMode) => void
}

const STORAGE_KEY = 'theme_mode'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  // Default to the premium navy "tavola" look; users can switch to the bright Odoo light or follow the OS.
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'dark'
}

function resolve(mode: ThemeMode): Resolved {
  return mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
}

function applyTheme(resolved: Resolved) {
  document.documentElement.setAttribute('data-theme', resolved)
}

const initialMode = getStoredMode()
applyTheme(resolve(initialMode))

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  resolved: resolve(initialMode),
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    const resolved = resolve(mode)
    applyTheme(resolved)
    set({ mode, resolved })
  },
}))

// Follow OS theme changes live while in 'system' mode
media.addEventListener('change', () => {
  if (useThemeStore.getState().mode === 'system') {
    const resolved = resolve('system')
    applyTheme(resolved)
    useThemeStore.setState({ resolved })
  }
})
