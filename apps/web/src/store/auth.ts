import { create } from 'zustand'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  setUser: (user: User, access: string, refresh: string) => void
  logout: () => void
}

// Hydrate from localStorage on first load
function getStoredUser(): { user: User | null; isAuthenticated: boolean } {
  try {
    const token = localStorage.getItem('access_token')
    if (!token) return { user: null, isAuthenticated: false }
    // Decode JWT payload (no verify — server will validate)
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      return { user: null, isAuthenticated: false }
    }
    return { user: null, isAuthenticated: false } // Will be filled by useMe()
  } catch {
    return { user: null, isAuthenticated: false }
  }
}

export const useAuthStore = create<AuthState>(() => ({
  ...getStoredUser(),
  setUser: (user, access, refresh) => {
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
    useAuthStore.setState({ user, isAuthenticated: true })
  },
  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    useAuthStore.setState({ user: null, isAuthenticated: false })
  },
}))
