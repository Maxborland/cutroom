import { useProjectStore } from '../stores/projectStore'
import { api } from '../lib/api'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ImageIcon,
  Film,
  Volume2,
  Type,
  Wand2,
  Copy,
  CheckCircle2,
  Play,
  Clock,
  Loader2,
} from 'lucide-react'
import type { ShotStatus } from '../types'
import { useRef, useState } from 'react'
import { useLightboxStore } from '../stores/lightboxStore'

interface ShotDetailProps {
  onClose: () => void
}

const STATUS_LABELS: Record<ShotStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Черновик', color: 'text-text-muted', bg: 'bg-surface-3' },
  generating: { label: 'Генерация...', color: 'text-violet', bg: 'bg-violet-dim' },
  review: { label: 'На ревью', color: 'text-sky', bg: 'bg-sky-dim' },
  approved: { label: 'Утверждён', color: 'text-emerald', bg: 'bg-emerald-dim' },
}

export function ShotDetail({ onClose }: ShotDetailProps) {
  const project = useProjectStore((s) => s.activeProject())
  const shot = useProjectStore((s) => s.activeShot())
  const setActiveShotId = useProjectStore((s) => s.setActiveShotId)
  const updateShot = useProjectStore((s) => s.updateShot)
  const updateShotStatus = useProjectStore((s) => s.updateShotStatus)
  const generateImage = useProjectStore((s) => s.generateImage)
  const enhanceImage = useProjectStore((s) => s.enhanceImage)
  const cancelGeneration = useProjectStore((s) => s.cancelGeneration)
  const loadProject = useProjectStore((s) => s.loadProject)
  const generatingShotIds = useProjectStore((s) => s.generatingShotIds)
  const enhancingShotIds = useProjectStore((s) => s.enhancingShotIds)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  if (!project || !shot) return null

  const statusInfo = STATUS_LABELS[shot.status]
  const linkedAssets = project.brief.assets.filter((a) => shot.assetRefs.includes(a.filename))
  const shotIndex = project.shots.findIndex((s) => s.id === shot.id)

  const goToShot = (dir: -1 | 1) => {
    const next = project.shots[shotIndex + dir]
    if (next) setActiveShotId(next.id)
  }

  const generating = shot ? generatingShotIds.has(shot.id) : false
  const enhancing = shot ? enhancingShotIds.has(shot.id) : false

  const handleGenerate = () => {
    generateImage(shot.id)
  }

  const handleEnhance = (sourceImage: string) => {
    enhanceImage(shot.id, sourceImage)
  }

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch (e) {
      console.error('Copy failed:', e)
    }
  }

  const handleUploadVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingVideo(true)
    try {
      await api.shots.uploadVideo(project.id, shot.id, file)
      await loadProject(project.id)
    } catch (err) {
      console.error('Video upload failed:', err)
    } finally {
      setUploadingVideo(false)
      e.target.value = ''
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface-1 overflow-hidden">
      {/* Hidden video input */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        onChange={handleUploadVideo}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-amber">
            #{String(shot.order).padStart(2, '0')}
          </span>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono ${statusInfo.bg} ${statusInfo.color}`}>
            {statusInfo.label}
          </div>
          <div className="flex items-center gap-1 text-text-muted ml-2">
            <Clock size={11} />
            <span className="font-mono text-xs">{shot.duration}s</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => goToShot(-1)}
            disabled={shotIndex === 0}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => goToShot(1)}
            disabled={shotIndex === project.shots.length - 1}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary ml-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Scene description */}
        <Field icon={<Type size={13} />} label="Описание сцены">
          <textarea
            value={shot.scene}
            onChange={(e) => updateShot(project.id, shot.id, { scene: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-amber/30 transition-colors min-h-[80px]"
          />
        </Field>

        {/* Audio description */}
        <Field icon={<Volume2 size={13} />} label="Аудио / Голос">
          <textarea
            value={shot.audioDescription}
            onChange={(e) => updateShot(project.id, shot.id, { audioDescription: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-amber/30 transition-colors min-h-[60px]"
          />
        </Field>

        {/* Linked assets from brief */}
        {linkedAssets.length > 0 && (
          <Field icon={<ImageIcon size={13} />} label="Привязанные ассеты">
            <div className="space-y-2">
              {linkedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 bg-surface-2 border border-border rounded-lg p-2.5"
                >
                  <div
                    className="w-10 h-10 rounded bg-surface-3 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-amber/40 transition-all"
                    onClick={() => {
                      const urls = linkedAssets.map((a) => api.assets.url(project.id, a.filename))
                      const idx = linkedAssets.indexOf(asset)
                      useLightboxStore.getState().show(urls, idx)
                    }}
                  >
                    <img
                      src={api.assets.url(project.id, asset.filename)}
                      alt={asset.label || asset.filename}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-amber truncate">{asset.filename}</p>
                    {asset.label && (
                      <p className="text-[11px] text-text-muted truncate">{asset.label}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Field>
        )}

        {/* Image prompt */}
        <Field
          icon={<Sparkles size={13} />}
          label="Промпт для изображения"
          action={
            <button className="flex items-center gap-1 text-[10px] text-amber hover:text-amber-light transition-colors">
              <Wand2 size={10} />
              Авто
            </button>
          }
        >
          <textarea
            value={shot.imagePrompt}
            onChange={(e) => updateShot(project.id, shot.id, { imagePrompt: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-secondary resize-none focus:outline-none focus:border-amber/30 transition-colors min-h-[80px] leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber text-bg text-[11px] font-semibold hover:bg-amber-light transition-colors disabled:opacity-50"
            >
              {generating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Sparkles size={11} />
              )}
              {generating ? 'Генерация...' : 'Сгенерировать'}
            </button>
            <button
              onClick={() => handleCopy(shot.imagePrompt, 'imagePrompt')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >
              {copied === 'imagePrompt' ? (
                <CheckCircle2 size={11} className="text-emerald" />
              ) : (
                <Copy size={11} />
              )}
              {copied === 'imagePrompt' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </Field>

        {/* Video prompt */}
        <Field
          icon={<Film size={13} />}
          label="Промпт для видео (Higgsfield)"
          action={
            <button className="flex items-center gap-1 text-[10px] text-amber hover:text-amber-light transition-colors">
              <Wand2 size={10} />
              Авто
            </button>
          }
        >
          <textarea
            value={shot.videoPrompt}
            onChange={(e) => updateShot(project.id, shot.id, { videoPrompt: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-secondary resize-none focus:outline-none focus:border-amber/30 transition-colors min-h-[80px] leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => handleCopy(shot.videoPrompt, 'videoPrompt')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >
              {copied === 'videoPrompt' ? (
                <CheckCircle2 size={11} className="text-emerald" />
              ) : (
                <Copy size={11} />
              )}
              {copied === 'videoPrompt' ? 'Скопировано' : 'Копировать для Higgsfield'}
            </button>
          </div>
        </Field>

        {/* Generated images */}
        <Field icon={<ImageIcon size={13} />} label="Сгенерированные изображения">
          {shot.generatedImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {shot.generatedImages.map((img, i) => (
                <div key={i} className="space-y-1.5">
                  <div
                    className="aspect-video bg-surface-3 rounded-lg border border-border flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-amber/40 transition-all"
                    onClick={() => {
                      const urls = shot.generatedImages.map((f) => api.shots.generatedImageUrl(project.id, shot.id, f))
                      useLightboxStore.getState().show(urls, i)
                    }}
                  >
                    <img
                      src={api.shots.generatedImageUrl(project.id, shot.id, img)}
                      alt={img}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        target.parentElement!.innerHTML = `<span class="font-mono text-[10px] text-text-muted">${img}</span>`
                      }}
                    />
                  </div>
                  <button
                    onClick={() => handleEnhance(img)}
                    disabled={enhancing}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gradient-to-r from-violet/20 to-amber/20 text-amber hover:from-violet/30 hover:to-amber/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {enhancing ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    {enhancing ? 'Обработка...' : 'Enhance'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <p className="text-xs text-text-muted">Изображения ещё не сгенерированы</p>
            </div>
          )}
        </Field>

        {/* Enhanced images */}
        {shot.enhancedImages && shot.enhancedImages.length > 0 && (
          <Field icon={<Sparkles size={13} />} label="Постобработка (Enhance)">
            <div className="grid grid-cols-2 gap-2">
              {shot.enhancedImages.map((img, i) => (
                <div
                  key={i}
                  className="aspect-video bg-surface-3 rounded-lg border border-emerald/20 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald/40 transition-all"
                  onClick={() => {
                    const urls = shot.enhancedImages.map((f) => api.shots.generatedImageUrl(project.id, shot.id, f))
                    useLightboxStore.getState().show(urls, i)
                  }}
                >
                  <img
                    src={api.shots.generatedImageUrl(project.id, shot.id, img)}
                    alt={img}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.parentElement!.innerHTML = `<span class="font-mono text-[10px] text-text-muted">${img}</span>`
                    }}
                  />
                </div>
              ))}
            </div>
          </Field>
        )}

        {/* Video */}
        <Field icon={<Play size={13} />} label="Видео">
          {shot.videoFile ? (
            <div className="aspect-video bg-surface-3 rounded-lg border border-emerald/20 flex items-center justify-center">
              <div className="text-center">
                <Film size={24} className="text-emerald mx-auto mb-2" />
                <span className="font-mono text-xs text-emerald">{shot.videoFile}</span>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <p className="text-xs text-text-muted">Видео не загружено</p>
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={uploadingVideo}
                className="mt-2 text-xs text-amber hover:text-amber-light transition-colors disabled:opacity-50"
              >
                {uploadingVideo ? (
                  <span className="flex items-center gap-1.5 justify-center">
                    <Loader2 size={11} className="animate-spin" />
                    Загрузка...
                  </span>
                ) : (
                  'Загрузить из Higgsfield'
                )}
              </button>
            </div>
          )}
        </Field>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 border-t border-border flex items-center gap-2 shrink-0">
        {shot.status === 'draft' && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet text-white text-xs font-semibold hover:bg-violet/80 transition-colors disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {generating ? 'Генерация...' : 'Запустить генерацию'}
          </button>
        )}
        {shot.status === 'generating' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-violet text-xs">
              <div className="w-3 h-3 rounded-full border-2 border-violet border-t-transparent animate-spin" />
              Генерация в процессе...
            </div>
            <button
              onClick={() => cancelGeneration(shot.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X size={12} />
              Отменить
            </button>
          </div>
        )}
        {shot.status === 'review' && (
          <>
            <button
              onClick={() => updateShotStatus(project.id, shot.id, 'approved')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald text-white text-xs font-semibold hover:bg-emerald/80 transition-colors"
            >
              <CheckCircle2 size={12} />
              Утвердить
            </button>
            <button
              onClick={() => updateShotStatus(project.id, shot.id, 'draft')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Вернуть в черновик
            </button>
          </>
        )}
        {shot.status === 'approved' && (
          <div className="flex items-center gap-1.5 text-emerald text-xs">
            <CheckCircle2 size={12} />
            Шот утверждён
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  icon,
  label,
  action,
  children,
}: {
  icon: React.ReactNode
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-muted">{icon}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {label}
        </span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}
