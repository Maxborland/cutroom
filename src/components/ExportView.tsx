import { useProjectStore } from '../stores/projectStore'
import { api } from '../lib/api'
import { Download, Film, CheckCircle2, AlertCircle, Package } from 'lucide-react'

export function ExportView() {
  const project = useProjectStore((s) => s.activeProject())
  if (!project) return null

  const approved = project.shots.filter((s) => s.status === 'approved')
  const withVideo = project.shots.filter((s) => s.videoFile)
  const total = project.shots.length

  const handleExportZip = () => {
    window.open(api.export.zipUrl(project.id))
  }

  const handleExportPrompts = () => {
    window.open(api.export.promptsUrl(project.id))
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Status overview */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-2 border border-border rounded-xl p-4 text-center">
            <p className="font-mono text-2xl font-bold text-text-primary">{total}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mt-1">
              Всего шотов
            </p>
          </div>
          <div className="bg-surface-2 border border-emerald/10 rounded-xl p-4 text-center">
            <p className="font-mono text-2xl font-bold text-emerald">{approved.length}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mt-1">
              Утверждено
            </p>
          </div>
          <div className="bg-surface-2 border border-sky/10 rounded-xl p-4 text-center">
            <p className="font-mono text-2xl font-bold text-sky">{withVideo.length}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mt-1">
              С видео
            </p>
          </div>
        </div>

        {/* Shot list for export */}
        <section>
          <h2 className="font-display font-semibold text-base mb-4">Состав экспорта</h2>
          <div className="space-y-2">
            {project.shots.map((shot) => (
              <div
                key={shot.id}
                className="flex items-center gap-3 bg-surface-2 border border-border rounded-lg p-3"
              >
                <span className="font-mono text-xs font-bold text-amber w-8">
                  #{String(shot.order).padStart(2, '0')}
                </span>
                <p className="flex-1 text-sm text-text-secondary truncate">{shot.scene}</p>
                <div className="flex items-center gap-2">
                  {shot.videoFile ? (
                    <span className="flex items-center gap-1 text-emerald text-[10px] font-mono">
                      <Film size={10} />
                      {shot.videoFile}
                    </span>
                  ) : shot.generatedImages.length > 0 ? (
                    <span className="flex items-center gap-1 text-sky text-[10px] font-mono">
                      <AlertCircle size={10} />
                      только изображения
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-text-muted text-[10px] font-mono">
                      <AlertCircle size={10} />
                      нет медиа
                    </span>
                  )}
                  {shot.status === 'approved' && <CheckCircle2 size={12} className="text-emerald" />}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Export actions */}
        <section className="space-y-3">
          <button
            onClick={handleExportZip}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber text-bg text-sm font-bold hover:bg-amber-light transition-colors glow-amber"
          >
            <Package size={16} />
            Экспортировать ZIP
          </button>
          <p className="text-center text-[10px] text-text-muted">
            ZIP содержит: пронумерованные видеоклипы, изображения, промпты (TXT), metadata.json
          </p>

          <button
            onClick={handleExportPrompts}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
          >
            <Download size={16} />
            Скачать только промпты
          </button>
        </section>
      </div>
    </div>
  )
}
