import { useProjectStore } from '../stores/projectStore'
import { Sparkles, Play, RotateCcw, Loader2 } from 'lucide-react'

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
}

export function PipelineHeader({ activeView }: PipelineHeaderProps) {
  const project = useProjectStore((s) => s.activeProject())
  const loading = useProjectStore((s) => s.loading)
  const generateScript = useProjectStore((s) => s.generateScript)
  const splitShots = useProjectStore((s) => s.splitShots)
  const generateImage = useProjectStore((s) => s.generateImage)

  if (!project) return null

  const stats = {
    total: project.shots.length,
    approved: project.shots.filter((s) => s.status === 'approved').length,
    generating: project.shots.filter((s) => s.status === 'generating').length,
    review: project.shots.filter((s) => s.status === 'review').length,
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
    <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-surface-1/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="font-display font-bold text-lg">{VIEW_TITLES[activeView] ?? activeView}</h1>

        {(activeView === 'shots' || activeView === 'review') && stats.total > 0 && (
          <div className="flex items-center gap-3 ml-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald" />
              <span className="font-mono text-xs text-text-secondary">{stats.approved}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-sky" />
              <span className="font-mono text-xs text-text-secondary">{stats.review}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-violet animate-pulse" />
              <span className="font-mono text-xs text-text-secondary">{stats.generating}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="font-mono text-xs text-text-secondary">{stats.draft}</span>
            </div>

            {/* Progress bar */}
            <div className="w-24 h-1.5 rounded-full bg-surface-3 ml-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber to-emerald transition-all duration-500"
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
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors glow-amber-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors glow-amber-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {loading ? 'Разбивка...' : 'Разбить на шоты'}
          </button>
        )}
        {activeView === 'shots' && (
          <>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors">
              <RotateCcw size={14} />
              Перегенерировать все
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={loading || stats.draft === 0}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors glow-amber-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
