import {
  Film,
  FileText,
  LayoutGrid,
  Download,
  Settings,
  Clapperboard,
  ChevronRight,
} from 'lucide-react'
import type { PipelineStage } from '../types'
import { useProjectStore } from '../stores/projectStore'
import { motion } from 'framer-motion'

const STAGES: { id: PipelineStage; label: string; icon: React.ReactNode }[] = [
  { id: 'brief', label: 'Бриф', icon: <FileText size={18} /> },
  { id: 'script', label: 'Сценарий', icon: <Film size={18} /> },
  { id: 'shots', label: 'Шоты', icon: <LayoutGrid size={18} /> },
  { id: 'review', label: 'Ревью', icon: <Clapperboard size={18} /> },
  { id: 'export', label: 'Экспорт', icon: <Download size={18} /> },
]

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const project = useProjectStore((s) => s.activeProject())

  const stageIndex = STAGES.findIndex((s) => s.id === project?.stage)

  return (
    <aside className="w-[220px] h-screen bg-surface-1 border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border">
        <div className="w-7 h-7 rounded-md bg-amber flex items-center justify-center">
          <Clapperboard size={15} className="text-bg" />
        </div>
        <span className="font-display font-bold text-sm tracking-wide">CUTROOM</span>
      </div>

      {/* Project name */}
      {project && (
        <div className="px-5 py-4 border-b border-border">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted mb-1">
            Проект
          </p>
          <p className="text-sm font-medium text-text-primary truncate">{project.name}</p>
        </div>
      )}

      {/* Pipeline stages */}
      <nav className="flex-1 py-4 px-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted px-2 mb-3">
          Пайплайн
        </p>
        <div className="space-y-0.5">
          {STAGES.map((stage, i) => {
            const isActive = activeView === stage.id
            const isPast = i < stageIndex
            const isCurrent = i === stageIndex

            return (
              <button
                key={stage.id}
                onClick={() => onViewChange(stage.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all relative group
                  ${isActive ? 'bg-amber-dim text-amber' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'}
                `}
              >
                {/* Stage connector line */}
                {i < STAGES.length - 1 && (
                  <div
                    className={`absolute left-[21px] top-[34px] w-px h-[10px] transition-colors ${
                      isPast ? 'bg-amber/40' : 'bg-border'
                    }`}
                  />
                )}

                <span
                  className={`relative ${isPast ? 'text-amber/60' : ''} ${isCurrent ? 'text-amber' : ''}`}
                >
                  {stage.icon}
                  {isCurrent && (
                    <motion.div
                      layoutId="stage-dot"
                      className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-amber"
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    />
                  )}
                </span>
                <span className="flex-1 text-left">{stage.label}</span>
                {isActive && <ChevronRight size={14} className="text-amber/60" />}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Settings */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => onViewChange('settings')}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
            ${activeView === 'settings' ? 'bg-amber-dim text-amber' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'}
          `}
        >
          <Settings size={18} />
          <span>Настройки</span>
        </button>
      </div>
    </aside>
  )
}
