import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLightboxStore } from '../stores/lightboxStore'

export function Lightbox() {
  const { open, images, index, close, next, prev } = useLightboxStore()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    },
    [open, close, next, prev]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!open || images.length === 0) return null

  const src = images[index]
  const hasMultiple = images.length > 1

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={close}
    >
      {/* Close button */}
      <button
        onClick={close}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <X size={20} />
      </button>

      {/* Counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 font-mono text-sm text-white/70">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Prev */}
      {hasMultiple && index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {/* Next */}
      {hasMultiple && index < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {/* Image */}
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[95vh] object-contain select-none"
        draggable={false}
      />
    </div>
  )
}
