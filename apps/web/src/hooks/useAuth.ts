import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import type { TokenResponse, User } from '@/types'

export function useLogin() {
  const { setUser } = useAuthStore()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }) =>
      (await api.post<TokenResponse>('/api/v1/auth/login', creds)).data,
    onSuccess: (data) => {
      setUser(data.user, data.access_token, data.refresh_token)
      navigate('/dashboard')
    },
  })
}

export function useLogout() {
  const { logout } = useAuthStore()
  const navigate = useNavigate()
  return () => { logout(); navigate('/login') }
}

export function useMe() {
  const { setUser, isAuthenticated } = useAuthStore()
  return useQuery({
    queryKey: ['me'],
    enabled: !!localStorage.getItem('access_token') && !isAuthenticated,
    queryFn: async () => {
      const { data } = await api.get<User>('/api/v1/auth/me')
      const at = localStorage.getItem('access_token')!
      const rt = localStorage.getItem('refresh_token')!
      setUser(data, at, rt)
      return data
    },
    retry: false,
  })
}
