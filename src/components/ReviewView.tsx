import { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useLightboxStore } from '../stores/lightboxStore'
import { api } from '../lib/api'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Eye,
  RotateCcw,
  Loader2,
  Film,
  Volume2,
  Clock,
  ListChecks,
} from 'lucide-react'
import type { Shot } from '../types'

function getBestImage(shot: Shot): { filename: string; type: 'enhanced' | 'generated' } | null {
  if (shot.enhancedImages.length > 0) {
    return { filename: shot.enhancedImages[shot.enhancedImages.length - 1], type: 'enhanced' }
  }
  if (shot.generatedImages.length > 0) {
    return { filename: shot.generatedImages[shot.generatedImages.length - 1], type: 'generated' }
  }
  return null
}

function hasAlternateImage(shot: Shot): boolean {
  return shot.enhancedImages.length > 0 && shot.generatedImages.length > 0
}

export function ReviewView() {
  const project = useProjectStore((s) => s.activeProject())
  const updateShotStatus = useProjectStore((s) => s.updateShotStatus)
  const enhanceImage = useProjectStore((s) => s.enhanceImage)
  const enhancingShotIds = useProjectStore((s) => s.enhancingShotIds)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [direction, setDirection] = useState(0)
  const [approveAnim, setApproveAnim] = useState(false)

  if (!project) return null

  const allShots = [...project.shots].sort((a, b) => a.order - b.order)
  const filteredShots = showAll
    ? allShots
    : allShots.filter(
        (s) =>
          (s.status === 'review' || s.status === 'approved') &&
          (s.generatedImages.length > 0 || s.enhancedImages.length > 0)
      )

  const currentShot = filteredShots[currentIndex] ?? null
  const enhancing = currentShot ? enhancingShotIds.has(currentShot.id) : false
  const bestImage = currentShot ? getBestImage(currentShot) : null
  const canToggle = currentShot ? hasAlternateImage(currentShot) : false

  const displayImage =
    currentShot && canToggle && showOriginal
      ? {
          filename: currentShot.generatedImages[currentShot.generatedImages.length - 1],
          type: 'generated' as const,
        }
      : bestImage

  const goNext = useCallback(() => {
    if (currentIndex < filteredShots.length - 1) {
      setDirection(1)
      setCurrentIndex((i) => i + 1)
      setShowOriginal(false)
    }
  }, [currentIndex, filteredShots.length])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1)
      setCurrentIndex((i) => i - 1)
      setShowOriginal(false)
    }
  }, [currentIndex])

  const handleApprove = useCallback(() => {
    if (!currentShot || !project) return
    updateShotStatus(project.id, currentShot.id, 'approved')
    setApproveAnim(true)
    setTimeout(() => setApproveAnim(false), 300)
  }, [currentShot, project, updateShotStatus])

  const handleReject = useCallback(() => {
    if (!currentShot || !project) return
    updateShotStatus(project.id, currentShot.id, 'draft')
  }, [currentShot, project, updateShotStatus])

  const handleEnhance = useCallback(() => {
    if (!currentShot || !project) return
    const source =
      currentShot.generatedImages.length > 0
        ? currentShot.generatedImages[currentShot.generatedImages.length - 1]
        : null
    if (!source) return
    enhanceImage(currentShot.id, source)
  }, [currentShot, project, enhanceImage])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Enter' && currentShot?.status !== 'approved') handleApprove()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goNext, goPrev, handleApprove, currentShot?.status])

  // Clamp index when filtered list changes
  useEffect(() => {
    if (currentIndex >= filteredShots.length && filteredShots.length > 0) {
      setCurrentIndex(filteredShots.length - 1)
    }
  }, [filteredShots.length, currentIndex])

  // Empty state
  if (filteredShots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
          <Film size={28} className="text-text-muted" />
        </div>
        <div className="text-center max-w-sm">
          <h2 className="font-display font-bold text-lg mb-1">Нет шотов для ревью</h2>
          <p className="text-sm text-text-muted">
            {showAll
              ? 'В проекте пока нет шотов. Сгенерируйте их на этапе "Шоты".'
              : 'Нет шотов со статусом "Ревью" или "Утверждён". Переключите на "Все шоты" или вернитесь к генерации.'}
          </p>
        </div>
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
          >
            <ListChecks size={14} />
            Показать все шоты
          </button>
        )}
      </div>
    )
  }

  const imageUrl =
    displayImage && currentShot
      ? api.shots.generatedImageUrl(project.id, currentShot.id, displayImage.filename)
      : null

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0 }),
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-mono text-sm text-text-secondary">
            <span className="text-text-primary font-bold">{currentIndex + 1}</span>
            {' / '}
            {filteredShots.length}
          </span>
          <button
            onClick={goNext}
            disabled={currentIndex === filteredShots.length - 1}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={16} />
          </button>

          {/* Progress dots */}
          <div className="flex items-center gap-1 ml-2">
            {filteredShots.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setDirection(i > currentIndex ? 1 : -1)
                  setCurrentIndex(i)
                  setShowOriginal(false)
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentIndex
                    ? 'bg-amber scale-125'
                    : s.status === 'approved'
                      ? 'bg-emerald/60 hover:bg-emerald'
                      : 'bg-surface-3 hover:bg-text-muted'
                }`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowAll(!showAll)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
            showAll
              ? 'bg-amber/10 text-amber border border-amber/20'
              : 'border border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
          }`}
        >
          <ListChecks size={13} />
          {showAll ? 'Все шоты' : 'Только ревью'}
        </button>
      </div>

      {/* Main area — image fills all available space */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Side arrows */}
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-surface-2/80 backdrop-blur-sm border border-border hover:border-border-hover text-text-muted hover:text-text-primary disabled:opacity-0 transition-all"
        >
          <ChevronLeft size={24} />
        </button>
        <button
          onClick={goNext}
          disabled={currentIndex === filteredShots.length - 1}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-surface-2/80 backdrop-blur-sm border border-border hover:border-border-hover text-text-muted hover:text-text-primary disabled:opacity-0 transition-all"
        >
          <ChevronRight size={24} />
        </button>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentShot?.id ?? 'empty'}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Hero image — takes all available space */}
            {imageUrl ? (
              <div className="flex-1 relative min-h-0 p-3">
                <motion.img
                  src={imageUrl}
                  alt={currentShot?.scene ?? ''}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="w-full h-full object-contain rounded-xl border border-border cursor-pointer hover:ring-2 hover:ring-amber/40 transition-all"
                  onClick={() => {
                    if (!currentShot) return
                    const allImages = [
                      ...currentShot.enhancedImages,
                      ...currentShot.generatedImages,
                    ]
                    const urls = allImages.map((f) =>
                      api.shots.generatedImageUrl(project.id, currentShot.id, f)
                    )
                    const idx = displayImage
                      ? allImages.indexOf(displayImage.filename)
                      : 0
                    useLightboxStore.getState().show(urls, Math.max(0, idx))
                  }}
                />

                {/* Original / Enhanced toggle */}
                {canToggle && (
                  <button
                    onClick={() => setShowOriginal(!showOriginal)}
                    className="absolute top-5 right-5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg/80 backdrop-blur-sm border border-border text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <Eye size={12} />
                    {showOriginal ? 'Оригинал' : 'Enhanced'}
                  </button>
                )}

                {/* Status badge */}
                {currentShot && (
                  <div
                    className={`absolute top-5 left-5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono backdrop-blur-sm ${
                      currentShot.status === 'approved'
                        ? 'bg-emerald/20 text-emerald border border-emerald/20'
                        : currentShot.status === 'review'
                          ? 'bg-sky/20 text-sky border border-sky/20'
                          : currentShot.status === 'draft'
                            ? 'bg-surface-2/80 text-text-muted border border-border'
                            : 'bg-violet/20 text-violet border border-violet/20'
                    }`}
                  >
                    {currentShot.status === 'approved' && <CheckCircle2 size={11} />}
                    {currentShot.status === 'approved'
                      ? 'Утверждён'
                      : currentShot.status === 'review'
                        ? 'На ревью'
                        : currentShot.status === 'draft'
                          ? 'Черновик'
                          : 'Генерация...'}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-3">
                <div className="w-full max-w-2xl aspect-video bg-surface-2 border border-dashed border-border rounded-xl flex items-center justify-center">
                  <p className="text-sm text-text-muted">Нет изображения</p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Bottom overlay bar — shot info + actions */}
        {currentShot && (
          <div className="shrink-0 border-t border-border bg-surface-1/80 backdrop-blur-sm px-6 py-2.5 flex items-center justify-between gap-4">
            {/* Shot info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="font-mono text-sm font-bold text-amber shrink-0">
                #{String(currentShot.order).padStart(2, '0')}
              </span>
              <span className="text-sm text-text-primary truncate">{currentShot.scene}</span>
              <span className="flex items-center gap-1 text-text-muted shrink-0">
                <Clock size={11} />
                <span className="font-mono text-xs">{currentShot.duration}s</span>
              </span>
              {currentShot.audioDescription && (
                <span className="flex items-center gap-1 text-text-muted shrink-0 max-w-[200px]">
                  <Volume2 size={11} className="shrink-0" />
                  <span className="text-xs truncate">{currentShot.audioDescription}</span>
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleEnhance}
                disabled={enhancing || currentShot.generatedImages.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet/20 to-amber/20 border border-violet/20 text-xs font-semibold text-amber hover:from-violet/30 hover:to-amber/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enhancing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                {enhancing ? 'Обработка...' : 'Enhance'}
              </button>

              <button
                onClick={handleReject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
              >
                <RotateCcw size={12} />
                В черновик
              </button>

              <motion.button
                onClick={handleApprove}
                animate={approveAnim ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.3 }}
                disabled={currentShot.status === 'approved'}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  currentShot.status === 'approved'
                    ? 'bg-emerald/20 text-emerald border border-emerald/20 cursor-default'
                    : 'bg-emerald text-white hover:bg-emerald/80 glow-emerald-sm'
                }`}
              >
                <CheckCircle2 size={12} />
                {currentShot.status === 'approved' ? 'Утверждён' : 'Утвердить'}
              </motion.button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
