import { useState, useEffect, useRef } from 'react'
import {
  Film,
  FileText,
  LayoutGrid,
  Download,
  Settings,
  Clapperboard,
  ChevronRight,
  Plus,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import type { PipelineStage } from '../types'
import { useProjectStore } from '../stores/projectStore'
import { motion, AnimatePresence } from 'framer-motion'

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
  const projects = useProjectStore((s) => s.projects)
  const loadProject = useProjectStore((s) => s.loadProject)
  const createProject = useProjectStore((s) => s.createProject)
  const loading = useProjectStore((s) => s.loading)

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const stageIndex = STAGES.findIndex((s) => s.id === project?.stage)

  // Close dropdown on outside click
  useEffect(() => {
    if (!projectMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false)
        setCreating(false)
        setNewName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [projectMenuOpen])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    await createProject(name)
    setNewName('')
    setCreating(false)
    setProjectMenuOpen(false)
    onViewChange('brief')
  }

  const handleSwitch = (id: string) => {
    loadProject(id)
    setProjectMenuOpen(false)
    onViewChange('brief')
  }

  return (
    <aside className="w-[220px] h-screen bg-surface-1 border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border">
        <div className="w-7 h-7 rounded-md bg-amber flex items-center justify-center">
          <Clapperboard size={15} className="text-bg" />
        </div>
        <span className="font-display font-bold text-sm tracking-wide">CUTROOM</span>
      </div>

      {/* Project selector */}
      <div ref={menuRef} className="px-3 py-3 border-b border-border relative">
        <button
          onClick={() => setProjectMenuOpen(!projectMenuOpen)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 transition-colors group"
        >
          <div className="flex-1 min-w-0 text-left">
            <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted">Проект</p>
            <p className="text-sm font-medium text-text-primary truncate">
              {project?.name ?? 'Выберите...'}
            </p>
          </div>
          <ChevronDown
            size={14}
            className={`text-text-muted shrink-0 transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence>
          {projectMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden"
            >
              <div className="max-h-48 overflow-y-auto py-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSwitch(p.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors ${
                      p.id === project?.id
                        ? 'text-amber bg-amber/5'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="border-t border-border p-2">
                {creating ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate()
                        if (e.key === 'Escape') { setCreating(false); setNewName('') }
                      }}
                      placeholder="Название..."
                      className="flex-1 min-w-0 bg-surface-3 border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber/30"
                    />
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim() || loading}
                      className="px-2 py-1 rounded bg-amber text-bg text-xs font-semibold disabled:opacity-50"
                    >
                      {loading ? <Loader2 size={10} className="animate-spin" /> : 'OK'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-amber hover:bg-amber/5 transition-colors"
                  >
                    <Plus size={12} />
                    Новый проект
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
