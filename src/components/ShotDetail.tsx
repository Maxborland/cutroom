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
  Trash2,
} from 'lucide-react'
import type { ShotStatus } from '../types'
import { useEffect, useRef, useState } from 'react'
import { useLightboxStore } from '../stores/lightboxStore'

interface ShotDetailProps {
  onClose: () => void
}

const STATUS_LABELS: Record<ShotStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Черновик', color: 'text-text-muted', bg: 'bg-surface-3' },
  img_gen: { label: 'Генерация изображения...', color: 'text-violet', bg: 'bg-violet-dim' },
  img_review: { label: 'Ревью изображения', color: 'text-sky', bg: 'bg-sky-dim' },
  vid_gen: { label: 'Генерация видео...', color: 'text-violet', bg: 'bg-violet-dim' },
  vid_review: { label: 'Ревью видео', color: 'text-amber', bg: 'bg-amber-dim' },
  approved: { label: 'Утверждён', color: 'text-emerald', bg: 'bg-emerald-dim' },
}

export function ShotDetail({ onClose }: ShotDetailProps) {
  const project = useProjectStore((s) => s.activeProject())
  const shot = useProjectStore((s) => s.activeShot())
  const setActiveShotId = useProjectStore((s) => s.setActiveShotId)
  const updateShot = useProjectStore((s) => s.updateShot)
  const updateShotStatus = useProjectStore((s) => s.updateShotStatus)
  const generateImage = useProjectStore((s) => s.generateImage)
  const generateVideoAction = useProjectStore((s) => s.generateVideo)
  const enhanceImage = useProjectStore((s) => s.enhanceImage)
  const cancelGeneration = useProjectStore((s) => s.cancelGeneration)
  const deleteShotImage = useProjectStore((s) => s.deleteShotImage)
  const deleteShotVideo = useProjectStore((s) => s.deleteShotVideo)
  const loadProject = useProjectStore((s) => s.loadProject)
  const generatingShotIds = useProjectStore((s) => s.generatingShotIds)
  const enhancingShotIds = useProjectStore((s) => s.enhancingShotIds)
  const generatingVideoShotIds = useProjectStore((s) => s.generatingVideoShotIds)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [cachingVideo, setCachingVideo] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const [videoEditHint, setVideoEditHint] = useState('')
  const [durationDraft, setDurationDraft] = useState<number>(shot?.duration ?? 4)
  const [savingVideoTweaks, setSavingVideoTweaks] = useState(false)

  useEffect(() => {
    if (!shot) return
    setVideoEditHint('')
    setDurationDraft(shot.duration)
  }, [shot?.id])

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
  const generatingVideo = shot ? generatingVideoShotIds.has(shot.id) : false
  const isExternalVideo = Boolean(
    shot.videoFile &&
      (shot.videoFile.startsWith('http://') ||
        shot.videoFile.startsWith('https://') ||
        shot.videoFile.startsWith('data:')),
  )

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

  const handleCacheVideo = async () => {
    if (!isExternalVideo) return
    setCachingVideo(true)
    try {
      await api.shots.cacheVideo(project.id, shot.id)
      await loadProject(project.id)
    } catch (err) {
      console.error('Video cache failed:', err)
    } finally {
      setCachingVideo(false)
    }
  }

  const applyVideoEditHint = (basePrompt: string, hint: string): string => {
    const trimmedHint = hint.trim()
    if (!trimmedHint) return basePrompt

    const marker = '\n\nEDIT:'
    const idx = basePrompt.lastIndexOf(marker)
    const withoutPrev = idx >= 0 ? basePrompt.slice(0, idx) : basePrompt

    return `${withoutPrev}${marker}\n${trimmedHint}`
  }

  const handleApplyTweaksAndRegenerate = async () => {
    if (savingVideoTweaks || generatingVideo) return

    const nextDuration = Number.isFinite(durationDraft) ? Math.round(durationDraft) : shot.duration
    const safeDuration = Math.max(1, nextDuration)

    const hint = videoEditHint.trim()
    const nextPrompt = hint ? applyVideoEditHint(shot.videoPrompt, hint) : shot.videoPrompt

    const hasChanges = safeDuration !== shot.duration || nextPrompt !== shot.videoPrompt

    setSavingVideoTweaks(true)
    try {
      if (hasChanges) {
        const shotId = shot.id
        await api.shots.update(project.id, shotId, {
          duration: safeDuration,
          videoPrompt: nextPrompt,
        })
        await loadProject(project.id)
        // Restore active shot after loadProject resets activeShotId
        setActiveShotId(shotId)
        setVideoEditHint('')
      }

      await generateVideoAction(shot.id)
    } catch (err) {
      console.error('Apply tweaks + regenerate failed:', err)
    } finally {
      setSavingVideoTweaks(false)
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
      <div className="flex items-center justify-between px-5 h-12 border-b-2 border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-amber">
            #{String(shot.order).padStart(2, '0')}
          </span>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-xs font-mono border border-border ${statusInfo.bg} ${statusInfo.color}`}>
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
            className="p-1 rounded-[3px] hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => goToShot(1)}
            disabled={shotIndex === project.shots.length - 1}
            className="p-1 rounded-[3px] hover:bg-surface-2 text-text-muted hover:text-text-primary disabled:opacity-20"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-[3px] hover:bg-surface-2 text-text-muted hover:text-text-primary ml-2"
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
            className="w-full brutal-input px-3 py-2 text-sm resize-none min-h-[80px]"
          />
        </Field>

        {/* Audio description */}
        <Field icon={<Volume2 size={13} />} label="Аудио / Голос">
          <textarea
            value={shot.audioDescription}
            onChange={(e) => updateShot(project.id, shot.id, { audioDescription: e.target.value })}
            className="w-full brutal-input px-3 py-2 text-sm resize-none min-h-[60px]"
          />
        </Field>

        {/* Linked assets from brief */}
        {linkedAssets.length > 0 && (
          <Field icon={<ImageIcon size={13} />} label="Привязанные ассеты">
            <div className="space-y-2">
              {linkedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 bg-surface-2 border-2 border-border rounded-[5px] p-2.5"
                >
                  <button
                    type="button"
                    aria-label={`Open linked asset ${asset.filename}`}
                    className="w-10 h-10 rounded-[3px] bg-surface-3 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer border-2 border-border hover:border-amber transition-colors"
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
                  </button>
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
            <button className="flex items-center gap-1 text-[10px] text-amber hover:text-amber-light">
              <Wand2 size={10} />
              Авто
            </button>
          }
        >
          <textarea
            value={shot.imagePrompt}
            onChange={(e) => updateShot(project.id, shot.id, { imagePrompt: e.target.value })}
            className="w-full brutal-input px-3 py-2 text-xs font-mono resize-none min-h-[80px] leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1 rounded-[5px] bg-amber text-black text-[11px] font-bold uppercase brutal-btn disabled:opacity-50"
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
              className="flex items-center gap-1.5 px-3 py-1 rounded-[5px] border-2 border-border text-[11px] text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow"
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
          label="Промпт для видео"
          action={
            <button className="flex items-center gap-1 text-[10px] text-amber hover:text-amber-light">
              <Wand2 size={10} />
              Авто
            </button>
          }
        >
          <textarea
            value={shot.videoPrompt}
            onChange={(e) => updateShot(project.id, shot.id, { videoPrompt: e.target.value })}
            className="w-full brutal-input px-3 py-2 text-xs font-mono resize-none min-h-[80px] leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => generateVideoAction(shot.id)}
              disabled={generatingVideo || shot.generatedImages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1 rounded-[5px] bg-violet text-white text-[11px] font-bold uppercase brutal-btn disabled:opacity-50"
            >
              {generatingVideo ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Film size={11} />
              )}
              {generatingVideo ? 'Генерация...' : 'Сгенерировать видео'}
            </button>
            <button
              onClick={() => handleCopy(shot.videoPrompt, 'videoPrompt')}
              className="flex items-center gap-1.5 px-3 py-1 rounded-[5px] border-2 border-border text-[11px] text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow"
            >
              {copied === 'videoPrompt' ? (
                <CheckCircle2 size={11} className="text-emerald" />
              ) : (
                <Copy size={11} />
              )}
              {copied === 'videoPrompt' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </Field>

        {/* Generated images */}
        <Field icon={<ImageIcon size={13} />} label="Сгенерированные изображения">
          {shot.generatedImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {shot.generatedImages.map((img, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="relative group">
                    <button
                      type="button"
                      aria-label={`Open generated image ${i + 1}`}
                      className="aspect-video bg-surface-3 rounded-[5px] border-2 border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-amber transition-colors"
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
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm('Удалить это изображение?')) {
                          deleteShotImage(project.id, shot.id, img)
                        }
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-[3px] bg-black/70 text-white/70 hover:text-rose hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-all border border-border"
                      title="Удалить изображение"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => handleEnhance(img)}
                    disabled={enhancing}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-bold bg-amber-dim text-amber border border-border hover:bg-amber/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="border-2 border-dashed border-border rounded-[5px] p-6 text-center">
              <p className="text-xs text-text-muted">Изображения ещё не сгенерированы</p>
            </div>
          )}
        </Field>

        {/* Enhanced images */}
        {shot.enhancedImages && shot.enhancedImages.length > 0 && (
          <Field icon={<Sparkles size={13} />} label="Постобработка (Enhance)">
            <div className="grid grid-cols-2 gap-2">
              {shot.enhancedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <button
                    type="button"
                    aria-label={`Open enhanced image ${i + 1}`}
                    className="aspect-video bg-surface-3 rounded-[5px] border-2 border-emerald flex items-center justify-center overflow-hidden cursor-pointer hover:border-emerald transition-colors"
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
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm('Удалить это изображение?')) {
                        deleteShotImage(project.id, shot.id, img)
                      }
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-[3px] bg-black/70 text-white/70 hover:text-rose hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-all border border-border"
                    title="Удалить изображение"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </Field>
        )}

        {/* Video */}
        <Field icon={<Play size={13} />} label="Видео">
          {shot.videoFile ? (
            <div className="space-y-2">
              <video
                src={api.shots.videoUrl(project.id, shot.id, shot.videoFile)}
                controls
                className="w-full rounded-[5px] border-2 border-emerald"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[10px] text-text-muted break-all">
                  {isExternalVideo ? 'Внешний URL (временное хранение)' : shot.videoFile}
                </p>
                <div className="flex items-center gap-2">
                  {isExternalVideo && (
                    <button
                      onClick={handleCacheVideo}
                      disabled={cachingVideo}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] text-amber hover:bg-amber-dim transition-colors disabled:opacity-50"
                    >
                      {cachingVideo ? (
                        <>
                          <Loader2 size={10} className="animate-spin" />
                          Докачка...
                        </>
                      ) : (
                        'Докачать локально'
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (window.confirm('Удалить видео?')) {
                        deleteShotVideo(project.id, shot.id)
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] text-rose hover:bg-rose-dim transition-colors"
                  >
                    <Trash2 size={10} />
                    Удалить видео
                  </button>
                </div>
              </div>
              {isExternalVideo && (
                <p className="text-[10px] text-amber">
                  Видео проигрывается по внешней ссылке. Для стабильного хранения нажмите "Докачать локально".
                </p>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-border rounded-[5px] p-6 text-center space-y-2">
              {generatingVideo ? (
                <div className="flex items-center gap-2 justify-center text-violet text-xs">
                  <Loader2 size={14} className="animate-spin" />
                  Генерация видео...
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-muted">Видео не загружено</p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => generateVideoAction(shot.id)}
                      disabled={shot.generatedImages.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-violet text-white text-xs font-bold uppercase brutal-btn disabled:opacity-50"
                    >
                      <Film size={12} />
                      Сгенерировать видео
                    </button>
                    <button
                      onClick={() => videoInputRef.current?.click()}
                      disabled={uploadingVideo}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow disabled:opacity-50"
                    >
                      {uploadingVideo ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Загрузка...
                        </>
                      ) : (
                        'Загрузить вручную'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </Field>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 border-t-2 border-border flex items-center gap-2 shrink-0">
        {shot.status === 'draft' && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-violet text-white text-xs font-bold uppercase brutal-btn disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {generating ? 'Генерация...' : 'Генерировать изображение'}
          </button>
        )}
        {shot.status === 'img_gen' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-violet text-xs">
              <div className="w-3 h-3 rounded-full border-2 border-violet border-t-transparent animate-spin" />
              Генерация изображения...
            </div>
            <button
              onClick={() => cancelGeneration(shot.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-rose text-xs text-rose hover:bg-rose-dim transition-colors"
            >
              <X size={12} />
              Отменить
            </button>
          </div>
        )}
        {shot.status === 'img_review' && (
          <>
            <button
              onClick={() => {
                generateVideoAction(shot.id)
              }}
              disabled={generatingVideo || shot.generatedImages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-violet text-white text-xs font-bold uppercase brutal-btn disabled:opacity-50"
            >
              <Film size={12} />
              Генерировать видео
            </button>
            <button
              onClick={() => updateShotStatus(project.id, shot.id, 'draft')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow"
            >
              Вернуть в черновик
            </button>
          </>
        )}
        {shot.status === 'vid_gen' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-violet text-xs">
              <div className="w-3 h-3 rounded-full border-2 border-violet border-t-transparent animate-spin" />
              Генерация видео...
            </div>
            <button
              onClick={() => cancelGeneration(shot.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-rose text-xs text-rose hover:bg-rose-dim transition-colors"
            >
              <X size={12} />
              Отменить
            </button>
          </div>
        )}
        {shot.status === 'vid_review' && (
          <>
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted shrink-0">Подсказка</span>
                <input
                  value={videoEditHint}
                  onChange={(e) => setVideoEditHint(e.target.value)}
                  placeholder="напр. медленнее камера, меньше тряски, плавнее движение"
                  className="flex-1 brutal-input px-2 py-1 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted shrink-0">Длительность</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={durationDraft}
                  onChange={(e) => setDurationDraft(Number(e.target.value))}
                  className="w-16 brutal-input px-2 py-1 text-xs font-mono"
                />
                <div className="flex items-center gap-1">
                  {[4, 6, 8].map((v) => (
                    <button
                      key={v}
                      onClick={() => setDurationDraft(v)}
                      className="px-2 py-1 rounded-[4px] border-2 border-border text-[10px] font-mono text-text-muted hover:text-text-primary hover:bg-surface-2"
                      title={`Установить ${v} сек`}
                      type="button"
                    >
                      {v}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => void handleApplyTweaksAndRegenerate()}
              disabled={savingVideoTweaks || generatingVideo || shot.generatedImages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-violet text-white text-xs font-bold uppercase brutal-btn disabled:opacity-50"
              title="Применить и перегенерировать видео"
            >
              {savingVideoTweaks || generatingVideo ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
              {savingVideoTweaks || generatingVideo ? 'Генерация...' : 'Перегенерировать'}
            </button>

            <button
              onClick={() => updateShotStatus(project.id, shot.id, 'approved')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-emerald text-black text-xs font-bold uppercase brutal-btn"
            >
              <CheckCircle2 size={12} />
              Утвердить
            </button>
            <button
              onClick={() => updateShotStatus(project.id, shot.id, 'img_review')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow"
            >
              Вернуть на ревью изображения
            </button>
          </>
        )}
        {shot.status === 'approved' && (
          <div className="flex items-center gap-1.5 text-emerald text-xs font-bold">
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
