import { create } from 'zustand'

interface LightboxState {
  images: string[]
  index: number
  open: boolean
  show: (images: string[], index?: number) => void
  close: () => void
  next: () => void
  prev: () => void
}

export const useLightboxStore = create<LightboxState>((set, get) => ({
  images: [],
  index: 0,
  open: false,

  show: (images, index = 0) => set({ images, index, open: true }),
  close: () => set({ open: false }),

  next: () => {
    const { index, images } = get()
    if (index < images.length - 1) set({ index: index + 1 })
  },
  prev: () => {
    const { index } = get()
    if (index > 0) set({ index: index - 1 })
  },
}))
