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
  Bot,
  X,
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
  const generateVideo = useProjectStore((s) => s.generateVideo)
  const enhanceImage = useProjectStore((s) => s.enhanceImage)
  const enhancingShotIds = useProjectStore((s) => s.enhancingShotIds)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [direction, setDirection] = useState(0)
  const [approveAnim, setApproveAnim] = useState(false)
  const [aiReview, setAiReview] = useState<string | null>(null)
  const [aiReviewing, setAiReviewing] = useState(false)

  const allShots = project ? [...project.shots].sort((a, b) => a.order - b.order) : []
  const filteredShots = showAll
    ? allShots
    : allShots.filter(
        (s) =>
          (s.status === 'img_review' || s.status === 'vid_review' || s.status === 'approved') &&
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
      setAiReview(null)
    }
  }, [currentIndex, filteredShots.length])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1)
      setCurrentIndex((i) => i - 1)
      setShowOriginal(false)
      setAiReview(null)
    }
  }, [currentIndex])

  const handleApprove = useCallback(() => {
    if (!currentShot || !project) return

    // Pipeline:
    // - Approving an image should start video generation.
    // - Approving a video should mark the shot as final approved.
    if (currentShot.status === 'img_review') {
      void generateVideo(currentShot.id)
    } else {
      updateShotStatus(project.id, currentShot.id, 'approved')
    }

    setApproveAnim(true)
    setTimeout(() => setApproveAnim(false), 300)
  }, [currentShot, project, updateShotStatus, generateVideo])

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

  const handleAiReview = useCallback(async () => {
    if (!currentShot || !project) return
    setAiReviewing(true)
    setAiReview(null)
    try {
      const { review } = await api.generate.aiReview(project.id, currentShot.id)
      setAiReview(review)
    } catch (e: any) {
      setAiReview(`Ошибка: ${e.message}`)
    } finally {
      setAiReviewing(false)
    }
  }, [currentShot, project])

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

  if (!project) return null

  // Empty state
  if (filteredShots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-16 h-16 rounded-[5px] bg-surface-2 border-2 border-border flex items-center justify-center shadow-brutal-sm">
          <Film size={28} className="text-text-muted" />
        </div>
        <div className="text-center max-w-sm">
          <h2 className="font-heading font-bold text-lg mb-1">Нет шотов для ревью</h2>
          <p className="text-sm text-text-muted">
            {showAll
              ? 'В проекте пока нет шотов. Сгенерируйте их на этапе "Шоты".'
              : 'Нет шотов со статусом "Ревью" или "Утверждён". Переключите на "Все шоты" или вернитесь к генерации.'}
          </p>
        </div>
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-[5px] border-2 border-border text-sm text-text-secondary hover:text-text-primary hover:border-border-hover shadow-brutal-sm hover:shadow-brutal transition-shadow"
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
      <div className="flex items-center justify-between px-6 py-3 border-b-2 border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            aria-label="Previous shot"
            className="p-1 rounded-[3px] hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20"
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
            aria-label="Next shot"
            className="p-1 rounded-[3px] hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20"
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
                aria-label={`Shot ${i + 1} of ${filteredShots.length}`}
                className={`w-2.5 h-2.5 rounded-[2px] border border-border transition-all ${
                  i === currentIndex
                    ? 'bg-amber scale-125'
                    : s.status === 'approved'
                      ? 'bg-emerald hover:bg-emerald'
                      : 'bg-surface-3 hover:bg-text-muted'
                }`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowAll(!showAll)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-[5px] text-xs font-mono border-2 transition-colors ${
            showAll
              ? 'bg-amber-dim text-amber border-amber'
              : 'border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
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
          aria-label="Previous shot"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-[5px] bg-surface-2 border-2 border-border text-text-muted hover:text-text-primary disabled:opacity-0 shadow-brutal-sm transition-all"
        >
          <ChevronLeft size={24} />
        </button>
        <button
          onClick={goNext}
          disabled={currentIndex === filteredShots.length - 1}
          aria-label="Next shot"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-[5px] bg-surface-2 border-2 border-border text-text-muted hover:text-text-primary disabled:opacity-0 shadow-brutal-sm transition-all"
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
                  className="w-full h-full object-contain rounded-[5px] border-2 border-border cursor-pointer hover:border-amber transition-colors"
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
                    className="absolute top-5 right-5 flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] bg-bg border-2 border-border text-xs font-mono text-text-secondary hover:text-text-primary shadow-brutal-sm transition-all"
                  >
                    <Eye size={12} />
                    {showOriginal ? 'Оригинал' : 'Улучшенное'}
                  </button>
                )}

                {/* Status badge */}
                {currentShot && (
                  <div
                    className={`absolute top-5 left-5 flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs font-mono border-2 ${
                      currentShot.status === 'approved'
                        ? 'bg-emerald-dim text-emerald border-emerald'
                        : currentShot.status === 'img_review'
                          ? 'bg-sky-dim text-sky border-sky'
                          : currentShot.status === 'vid_review'
                            ? 'bg-amber-dim text-amber border-amber'
                          : currentShot.status === 'draft'
                            ? 'bg-surface-2 text-text-muted border-border'
                            : 'bg-violet-dim text-violet border-violet'
                    }`}
                  >
                    {currentShot.status === 'approved' && <CheckCircle2 size={11} />}
                    {currentShot.status === 'approved'
                      ? 'Утверждён'
                      : currentShot.status === 'img_review'
                        ? 'На ревью IMG'
                        : currentShot.status === 'vid_review'
                          ? 'На ревью VID'
                        : currentShot.status === 'draft'
                          ? 'Черновик'
                          : 'Генерация...'}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-3">
                <div className="w-full max-w-2xl aspect-video bg-surface-2 border-2 border-dashed border-border rounded-[5px] flex items-center justify-center">
                  <p className="text-sm text-text-muted">Нет изображения</p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* AI Review panel */}
        {aiReview && (
          <div className="shrink-0 mx-4 mb-2 bg-surface-2 border-2 border-amber rounded-[5px] px-4 py-3 flex items-start gap-3">
            <Bot size={14} className="text-amber shrink-0 mt-0.5" />
            <p className="text-xs text-text-secondary leading-relaxed flex-1">{aiReview}</p>
            <button
              onClick={() => setAiReview(null)}
              className="p-0.5 rounded-[3px] hover:bg-surface-3 text-text-muted transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Bottom overlay bar — shot info + actions */}
        {currentShot && (
          <div className="shrink-0 border-t-2 border-border bg-surface-1 px-6 py-2.5 flex items-center justify-between gap-4">
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
                onClick={handleAiReview}
                disabled={aiReviewing || !bestImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary hover:border-border-hover shadow-brutal-sm hover:shadow-brutal transition-shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {aiReviewing ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                {aiReviewing ? 'Анализ...' : 'AI ревью'}
              </button>
              <button
                onClick={handleEnhance}
                disabled={enhancing || currentShot.generatedImages.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-amber-dim text-amber border-2 border-amber text-xs font-bold hover:bg-amber/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enhancing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                {enhancing ? 'Обработка...' : 'Улучшить'}
              </button>

              <button
                onClick={handleReject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow"
              >
                <RotateCcw size={12} />
                В черновик
              </button>

              <motion.button
                onClick={handleApprove}
                animate={approveAnim ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.3 }}
                disabled={currentShot.status === 'approved'}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-xs font-bold uppercase border-2 transition-all ${
                  currentShot.status === 'approved'
                    ? 'bg-emerald-dim text-emerald border-emerald cursor-default'
                    : 'bg-emerald text-black border-border shadow-brutal-sm brutal-btn'
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
