import { create } from 'zustand'

export type ToastType = 'success' | 'info' | 'warn' | 'error'

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
const DEDUPE_WINDOW_MS = 2500
const recentToastExpiry = new Map<string, number>()

function getToastKey(type: ToastType, title: string, description?: string): string {
  return `${type}::${title.trim()}::${(description || '').trim()}`
}

function isDuplicateToast(type: ToastType, title: string, description?: string): boolean {
  const now = Date.now()

  for (const [key, expiresAt] of recentToastExpiry) {
    if (expiresAt <= now) recentToastExpiry.delete(key)
  }

  const toastKey = getToastKey(type, title, description)
  const expiresAt = recentToastExpiry.get(toastKey)
  if (expiresAt && expiresAt > now) return true

  recentToastExpiry.set(toastKey, now + DEDUPE_WINDOW_MS)
  return false
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, title, description) => {
    if (isDuplicateToast(type, title, description)) return

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
