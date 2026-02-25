import { useEffect, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLightboxStore } from '../stores/lightboxStore'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Lightbox() {
  const { open, images, index, close, next, prev } = useLightboxStore()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus()
      })
      return
    }

    if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return

      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }

      if (e.key === 'ArrowRight') {
        next()
        return
      }

      if (e.key === 'ArrowLeft') {
        prev()
        return
      }

      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) =>
          !el.hasAttribute('disabled') &&
          (el.offsetParent !== null || el === document.activeElement)
      )

      if (focusable.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      }
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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95"
      onClick={close}
    >
      {/* Close button */}
      <button
        ref={closeButtonRef}
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 p-2 rounded-[5px] bg-surface-2 border-2 border-border text-text-primary hover:bg-surface-3 shadow-brutal-sm transition-colors"
      >
        <X size={20} />
      </button>

      {/* Counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 font-mono text-sm text-white/70 bg-surface-2 border-2 border-border rounded-[5px] px-3 py-1">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Prev */}
      {hasMultiple && index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            prev()
          }}
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-[5px] bg-surface-2 border-2 border-border text-text-primary hover:bg-surface-3 shadow-brutal-sm transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {/* Next */}
      {hasMultiple && index < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            next()
          }}
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-[5px] bg-surface-2 border-2 border-border text-text-primary hover:bg-surface-3 shadow-brutal-sm transition-colors"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {/* Image */}
      <img
        src={src}
        alt={`Image ${index + 1}`}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[95vh] object-contain select-none rounded-[5px] border-2 border-border"
        draggable={false}
      />
    </div>
  )
}
