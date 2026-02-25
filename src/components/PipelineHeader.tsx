import { useProjectStore } from '../stores/projectStore'
import { Sparkles, Play, RotateCcw, Loader2, Crown } from 'lucide-react'

interface PipelineHeaderProps {
  activeView: string
}

const VIEW_TITLES: Record<string, string> = {
  brief: 'Бриф',
  script: 'Сценарий',
  shots: 'Шоты',
  review: 'Ревью',
  export: 'Экспорт',
  settings: 'Настройки',
  director: 'Креативный директор',
}

export function PipelineHeader({ activeView }: PipelineHeaderProps) {
  const project = useProjectStore((s) => s.activeProject())
  const loading = useProjectStore((s) => s.loading)
  const generateScript = useProjectStore((s) => s.generateScript)
  const splitShots = useProjectStore((s) => s.splitShots)
  const generateImage = useProjectStore((s) => s.generateImage)
  const directorReviewAll = useProjectStore((s) => s.directorReviewAll)
  const directorLoading = useProjectStore((s) => s.directorLoading)

  if (!project) return null

  const stats = {
    total: project.shots.length,
    approved: project.shots.filter((s) => s.status === 'approved').length,
    generating: project.shots.filter((s) => s.status === 'img_gen' || s.status === 'vid_gen').length,
    review: project.shots.filter((s) => s.status === 'img_review' || s.status === 'vid_review').length,
    draft: project.shots.filter((s) => s.status === 'draft').length,
  }

  const progress = stats.total > 0 ? (stats.approved / stats.total) * 100 : 0

  const handleGenerateScript = async () => {
    await generateScript()
  }

  const handleSplitShots = async () => {
    await splitShots()
  }

  const handleGenerateAll = async () => {
    const draftShots = project.shots.filter((s) => s.status === 'draft')
    for (const shot of draftShots) {
      await generateImage(shot.id)
    }
  }

  return (
    <header className="h-14 border-b-2 border-border flex items-center justify-between px-6 bg-surface-1 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="font-heading font-bold text-lg uppercase tracking-tight">{VIEW_TITLES[activeView] ?? activeView}</h1>

        {(activeView === 'shots' || activeView === 'review') && stats.total > 0 && (
          <div className="flex items-center gap-3 ml-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald border border-border" />
              <span className="font-mono text-xs text-text-secondary">{stats.approved}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[2px] bg-sky border border-border" />
              <span className="font-mono text-xs text-text-secondary">{stats.review}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[2px] bg-violet border border-border animate-pulse" />
              <span className="font-mono text-xs text-text-secondary">{stats.generating}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[2px] bg-text-muted border border-border" />
              <span className="font-mono text-xs text-text-secondary">{stats.draft}</span>
            </div>

            {/* Progress bar */}
            <div className="w-24 h-2 rounded-[3px] bg-surface-3 border border-border ml-2 overflow-hidden">
              <div
                className="h-full bg-emerald transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {activeView === 'brief' && (
          <button
            onClick={handleGenerateScript}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {loading ? 'Генерация...' : 'Сгенерировать сценарий'}
          </button>
        )}
        {activeView === 'script' && (
          <button
            onClick={handleSplitShots}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {loading ? 'Разбивка...' : 'Разбить на шоты'}
          </button>
        )}
        {activeView === 'director' && (
          <button
            onClick={directorReviewAll}
            disabled={directorLoading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {directorLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Crown size={14} />
            )}
            {directorLoading ? 'Анализ...' : 'Полное ревью'}
          </button>
        )}
        {activeView === 'shots' && (
          <>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-[5px] border-2 border-border text-sm text-text-secondary hover:text-text-primary shadow-brutal-sm hover:shadow-brutal transition-shadow">
              <RotateCcw size={14} />
              Перегенерировать все
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={loading || stats.draft === 0}
              className="flex items-center gap-2 px-4 py-1.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {loading ? 'Генерация...' : 'Генерировать'}
            </button>
          </>
        )}
      </div>
    </header>
  )
}
