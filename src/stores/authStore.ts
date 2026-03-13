import { create } from 'zustand'
import { ApiRequestError, api, isApiRequestError, type AuthUser } from '../lib/api'

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

const getErrorMessage = (error: unknown, fallback = 'Произошла ошибка') => {
  if (isApiRequestError(error) && error.message.trim()) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  loading: boolean
  error: string | null
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  acceptInvite: (token: string, name: string, password: string) => Promise<boolean>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  hydrate: async () => {
    set((state) => ({
      loading: state.status !== 'authenticated',
      error: null,
      status: state.status === 'authenticated' ? state.status : 'loading',
    }))

    try {
      const response = await api.auth.me()
      set({
        user: response.user,
        status: 'authenticated',
        loading: false,
        error: null,
      })
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        set({
          user: null,
          status: 'unauthenticated',
          loading: false,
          error: null,
        })
        return
      }

      set({
        user: null,
        status: 'unauthenticated',
        loading: false,
        error: getErrorMessage(error, 'Не удалось проверить текущую сессию'),
      })
    }
  },

  login: async (email: string, password: string) => {
    set({ loading: true, error: null })

    try {
      const response = await api.auth.login(email.trim(), password)
      set({
        user: response.user,
        status: 'authenticated',
        loading: false,
        error: null,
      })
      return true
    } catch (error) {
      set({
        user: null,
        status: 'unauthenticated',
        loading: false,
        error: getErrorMessage(error, 'Не удалось войти'),
      })
      return false
    }
  },

  logout: async () => {
    set({ loading: true, error: null })

    try {
      await api.auth.logout()
    } catch {
      // keep local state in sync even if the server session already disappeared
    } finally {
      set({
        user: null,
        status: 'unauthenticated',
        loading: false,
        error: null,
      })
    }
  },

  acceptInvite: async (token: string, name: string, password: string) => {
    set({ loading: true, error: null })

    try {
      const response = await api.auth.acceptInvite(token, name.trim(), password)
      set({
        user: response.user,
        status: 'authenticated',
        loading: false,
        error: null,
      })
      return true
    } catch (error) {
      set({
        user: null,
        status: 'unauthenticated',
        loading: false,
        error: getErrorMessage(error, 'Не удалось принять приглашение'),
      })
      return false
    }
  },
}))
