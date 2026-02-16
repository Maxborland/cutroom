import { useProjectStore } from '../stores/projectStore'
import { api } from '../lib/api'
import { Upload, X, ImageIcon, FolderOpen, Tag, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCallback, useRef, useState } from 'react'
import { downscaleImages, filterImageFiles } from '../lib/imageUtils'

const BATCH_SIZE = 5

export function BriefEditor() {
  const project = useProjectStore((s) => s.activeProject())
  const updateBriefText = useProjectStore((s) => s.updateBriefText)
  const loadProject = useProjectStore((s) => s.loadProject)
  const removeBriefAsset = useProjectStore((s) => s.removeBriefAsset)
  const updateAssetLabel = useProjectStore((s) => s.updateAssetLabel)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback(
    async (rawFiles: File[]) => {
      if (!project || rawFiles.length === 0) return

      // Filter to images only (important for folder selection)
      const imageFiles = filterImageFiles(rawFiles)
      if (imageFiles.length === 0) return

      setUploading(true)
      setUploadProgress({ done: 0, total: imageFiles.length })

      try {
        // Process in batches
        for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
          const batch = imageFiles.slice(i, i + BATCH_SIZE)

          // Downscale images in this batch
          const compressed = await downscaleImages(batch)

          // Upload batch
          await api.assets.upload(project.id, compressed)
          setUploadProgress({ done: Math.min(i + BATCH_SIZE, imageFiles.length), total: imageFiles.length })
        }

        await loadProject(project.id)
      } catch (e) {
        console.error('Upload failed:', e)
      } finally {
        setUploading(false)
        setUploadProgress({ done: 0, total: 0 })
      }
    },
    [project, loadProject]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      handleUpload(files)
    },
    [handleUpload]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      handleUpload(files)
      // Reset input so the same file can be re-selected
      e.target.value = ''
    },
    [handleUpload]
  )

  const handleBriefTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!project) return
      const text = e.target.value
      // Update local state immediately (optimistic)
      updateBriefText(project.id, text)
    },
    [project, updateBriefText]
  )

  const handleRemoveAsset = useCallback(
    (assetId: string) => {
      if (!project) return
      removeBriefAsset(project.id, assetId)
    },
    [project, removeBriefAsset]
  )

  if (!project) return null

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Text brief */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
              01
            </span>
            <h2 className="font-display font-semibold text-base">Описание</h2>
          </div>
          <textarea
            value={project.brief.text}
            onChange={handleBriefTextChange}
            placeholder="Опишите видеоролик: тематика, стиль, настроение, хронометраж..."
            className="w-full h-40 bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-amber/30 focus:ring-1 focus:ring-amber/20 transition-all"
          />
          <p className="mt-2 text-xs text-text-muted">
            LLM будет использовать этот текст + загруженные изображения для генерации сценария
          </p>
        </section>

        {/* Image assets */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
              02
            </span>
            <h2 className="font-display font-semibold text-base">Ассеты</h2>
            <span className="ml-auto font-mono text-xs text-text-muted">
              {project.brief.assets.length} файлов
            </span>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />
          {/* Hidden folder input */}
          {/* @ts-expect-error webkitdirectory is non-standard but widely supported */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            webkitdirectory=""
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
              ${
                dragOver
                  ? 'border-amber bg-amber-dim scale-[1.01]'
                  : 'border-border hover:border-border-hover hover:bg-surface-2/50'
              }
            `}
          >
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${dragOver ? 'bg-amber/20' : 'bg-surface-3'}`}
              >
                {uploading ? (
                  <Loader2 size={20} className="text-amber animate-spin" />
                ) : (
                  <Upload size={20} className={dragOver ? 'text-amber' : 'text-text-muted'} />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {uploading
                    ? `Загрузка... ${uploadProgress.done}/${uploadProgress.total}`
                    : 'Перетащите файлы или папку сюда'}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {uploading
                    ? 'Изображения сжимаются и загружаются пакетами'
                    : 'JPG, PNG, WebP — рендеры, скриншоты, референсы (автосжатие до 1920px)'}
                </p>
                {uploading && uploadProgress.total > 0 && (
                  <div className="w-48 h-1.5 bg-surface-3 rounded-full mt-2 mx-auto overflow-hidden">
                    <div
                      className="h-full bg-amber rounded-full transition-all duration-300"
                      style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-3 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3/80 transition-colors disabled:opacity-50"
                >
                  <ImageIcon size={13} />
                  Выбрать файлы
                </button>
                <button
                  onClick={() => folderInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-3 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3/80 transition-colors disabled:opacity-50"
                >
                  <FolderOpen size={13} />
                  Выбрать папку
                </button>
              </div>
            </div>
          </div>

          {/* Asset list */}
          <AnimatePresence>
            {project.brief.assets.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 space-y-2"
              >
                {project.brief.assets.map((asset, i) => (
                  <motion.div
                    key={asset.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 bg-surface-2 border border-border rounded-lg p-3 group hover:border-border-hover transition-colors"
                  >
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-md bg-surface-3 flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src={api.assets.url(project.id, asset.filename)}
                        alt={asset.label || asset.filename}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to icon on error
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                          target.parentElement!.innerHTML =
                            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
                        }}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-amber truncate">{asset.filename}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Tag size={10} className="text-text-muted shrink-0" />
                        <input
                          type="text"
                          value={asset.label}
                          onChange={(e) => updateAssetLabel(project.id, asset.id, e.target.value)}
                          placeholder="Добавьте описание..."
                          className="bg-transparent text-xs text-text-secondary placeholder:text-text-muted/50 focus:outline-none focus:text-text-primary w-full"
                        />
                      </div>
                    </div>

                    {/* Order badge */}
                    <span className="font-mono text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
                      #{i + 1}
                    </span>

                    {/* Remove */}
                    <button
                      onClick={() => handleRemoveAsset(asset.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-dim transition-all"
                    >
                      <X size={14} className="text-rose" />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Master prompts preview */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
              03
            </span>
            <h2 className="font-display font-semibold text-base">Мастер-промпт сценариста</h2>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="font-mono text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              {project.settings.masterPromptScriptwriter}
            </p>
            <button className="mt-3 text-xs text-amber hover:text-amber-light transition-colors">
              Редактировать в настройках →
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
