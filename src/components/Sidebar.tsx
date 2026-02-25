import { useState, useEffect, useRef, useCallback, useId } from 'react'
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
  Crown,
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
  onViewChange: (view: string, projectIdOverride?: string) => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const project = useProjectStore((s) => s.activeProject())
  const projects = useProjectStore((s) => s.projects)
  const createProject = useProjectStore((s) => s.createProject)
  const loading = useProjectStore((s) => s.loading)

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  const projectMenuId = useId()

  const closeProjectMenu = useCallback((restoreFocus = false) => {
    setProjectMenuOpen(false)
    setCreating(false)
    setNewName('')

    if (restoreFocus) {
      toggleButtonRef.current?.focus()
    }
  }, [])

  const stageIndex = STAGES.findIndex((s) => s.id === project?.stage)

  // Close dropdown on outside click
  useEffect(() => {
    if (!projectMenuOpen) return

    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeProjectMenu()
      }
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [projectMenuOpen, closeProjectMenu])

  useEffect(() => {
    if (!projectMenuOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeProjectMenu(true)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [projectMenuOpen, closeProjectMenu])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return

    await createProject(name)
    const createdProjectId = useProjectStore.getState().activeProjectId
    closeProjectMenu()
    if (createdProjectId) {
      onViewChange('brief', createdProjectId)
    } else {
      onViewChange('brief')
    }
  }

  const handleSwitch = (id: string) => {
    closeProjectMenu()
    onViewChange('brief', id)
  }

  return (
    <aside className="w-[220px] h-screen bg-surface-1 border-r-2 border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b-2 border-border">
        <div className="w-7 h-7 rounded-[3px] bg-amber border-2 border-border flex items-center justify-center">
          <Clapperboard size={15} className="text-black" />
        </div>
        <span className="font-heading font-bold text-sm tracking-wide uppercase">CUTROOM</span>
      </div>

      {/* Project selector */}
      <div ref={menuRef} className="px-3 py-3 border-b-2 border-border relative">
        <button
          ref={toggleButtonRef}
          onClick={() => setProjectMenuOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !projectMenuOpen) {
              e.preventDefault()
              setProjectMenuOpen(true)
            }
            if (e.key === 'Escape' && projectMenuOpen) {
              e.preventDefault()
              closeProjectMenu(true)
            }
          }}
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          aria-controls={projectMenuId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[5px] hover:bg-surface-2 group"
        >
          <div className="flex-1 min-w-0 text-left">
            <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted">Проект</p>
            <p className="text-sm font-bold text-text-primary truncate">
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
              id={projectMenuId}
              role="menu"
              aria-label="Project selector"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeProjectMenu(true)
                }
              }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1 }}
              className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface-2 brutal-card overflow-hidden"
            >
              <div className="max-h-48 overflow-y-auto py-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    role="menuitemradio"
                    aria-checked={p.id === project?.id}
                    onClick={() => handleSwitch(p.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm truncate ${
                      p.id === project?.id
                        ? 'text-amber bg-amber-dim font-bold'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="border-t-2 border-border p-2">
                {creating ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate()
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          closeProjectMenu(true)
                        }
                      }}
                      placeholder="Название..."
                      className="flex-1 min-w-0 brutal-input px-2 py-1 text-xs"
                    />
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim() || loading}
                      className="px-2 py-1 rounded-[3px] bg-amber text-black text-xs font-bold border-2 border-border disabled:opacity-50"
                    >
                      {loading ? <Loader2 size={10} className="animate-spin" /> : 'OK'}
                    </button>
                  </div>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[3px] text-xs text-amber hover:bg-amber-dim font-bold"
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
        <div className="space-y-1">
          {STAGES.map((stage, i) => {
            const isActive = activeView === stage.id
            const isPast = i < stageIndex
            const isCurrent = i === stageIndex

            return (
              <button
                key={stage.id}
                onClick={() => onViewChange(stage.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-[5px] text-sm relative group
                  ${isActive
                    ? 'bg-amber text-black font-bold border-2 border-border shadow-brutal-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
                  }
                `}
              >
                {/* Stage connector line */}
                {i < STAGES.length - 1 && (
                  <div
                    className={`absolute left-[21px] top-[34px] w-px h-[10px] ${
                      isPast ? 'bg-amber/40' : 'bg-surface-3'
                    }`}
                  />
                )}

                <span
                  className={`relative ${isPast ? 'text-amber/60' : ''} ${isCurrent && !isActive ? 'text-amber' : ''}`}
                >
                  {stage.icon}
                  {isCurrent && !isActive && (
                    <motion.div
                      layoutId="stage-dot"
                      className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-amber border border-border"
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    />
                  )}
                </span>
                <span className="flex-1 text-left">{stage.label}</span>
                {isActive && <ChevronRight size={14} />}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Creative Director */}
      <div className="px-3 mt-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted px-2 mb-2">
          Директор
        </p>
        <button
          onClick={() => onViewChange('director')}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-[5px] text-sm
            ${activeView === 'director'
              ? 'bg-amber text-black font-bold border-2 border-border shadow-brutal-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
            }
          `}
        >
          <Crown size={18} />
          <span>Креативный директор</span>
        </button>
      </div>

      {/* Settings */}
      <div className="p-3 border-t-2 border-border">
        <button
          onClick={() => onViewChange('settings')}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-[5px] text-sm
            ${activeView === 'settings'
              ? 'bg-amber text-black font-bold border-2 border-border shadow-brutal-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
            }
          `}
        >
          <Settings size={18} />
          <span>Настройки</span>
        </button>
      </div>
    </aside>
  )
}
