import { create } from 'zustand'

export type ToastType = 'success' | 'info' | 'error'

export interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: ToastType, title: string, description?: string) => void
  removeToast: (id: string) => void
}

let nextId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, title, description) => {
    const id = String(++nextId)
    set((s) => ({ toasts: [...s.toasts, { id, type, title, description }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 5000)
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
