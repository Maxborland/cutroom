import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { PipelineHeader } from './components/PipelineHeader'
import { BriefEditor } from './components/BriefEditor'
import { ScriptView } from './components/ScriptView'
import { ShotBoard } from './components/ShotBoard'
import { ExportView } from './components/ExportView'
import { SettingsView } from './components/SettingsView'
import { useProjectStore } from './stores/projectStore'
import { Clapperboard, Plus, Loader2 } from 'lucide-react'

function App() {
  const [activeView, setActiveView] = useState('brief')
  const [newProjectName, setNewProjectName] = useState('')

  const loadProjects = useProjectStore((s) => s.loadProjects)
  const loadProject = useProjectStore((s) => s.loadProject)
  const createProject = useProjectStore((s) => s.createProject)
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const loading = useProjectStore((s) => s.loading)
  const error = useProjectStore((s) => s.error)
  const clearError = useProjectStore((s) => s.clearError)

  useEffect(() => {
    loadProjects().then(() => {
      const state = useProjectStore.getState()
      if (state.projects.length > 0 && !state.activeProjectId) {
        loadProject(state.projects[0].id)
      }
    })
  }, [loadProjects, loadProject])

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    await createProject(name)
    setNewProjectName('')
    setActiveView('brief')
  }

  const renderView = () => {
    switch (activeView) {
      case 'brief':
        return <BriefEditor />
      case 'script':
        return <ScriptView />
      case 'shots':
      case 'review':
        return <ShotBoard />
      case 'export':
        return <ExportView />
      case 'settings':
        return <SettingsView />
      default:
        return <BriefEditor />
    }
  }

  // Loading state on initial load
  if (loading && projects.length === 0 && !activeProjectId) {
    return (
      <div className="flex h-screen w-screen bg-bg items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-amber animate-spin" />
          <p className="text-sm text-text-muted">Загрузка...</p>
        </div>
      </div>
    )
  }

  // No projects — show create screen
  if (!loading && projects.length === 0) {
    return (
      <div className="flex h-screen w-screen bg-bg items-center justify-center">
        <div className="flex flex-col items-center gap-6 max-w-md w-full px-6">
          <div className="w-14 h-14 rounded-xl bg-amber flex items-center justify-center">
            <Clapperboard size={28} className="text-bg" />
          </div>
          <div className="text-center">
            <h1 className="font-display font-bold text-2xl mb-2">CutRoom</h1>
            <p className="text-sm text-text-muted">
              Создайте первый проект, чтобы начать работу с видео-пайплайном
            </p>
          </div>

          {error && (
            <div className="w-full bg-rose-dim border border-rose/20 rounded-lg px-4 py-2 text-sm text-rose">
              {error}
              <button onClick={clearError} className="ml-2 underline text-xs">
                Закрыть
              </button>
            </div>
          )}

          <div className="w-full flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="Название проекта..."
              className="flex-1 bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber/30 focus:ring-1 focus:ring-amber/20 transition-all"
            />
            <button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors glow-amber-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Создать проект
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen bg-bg">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="bg-rose-dim border-b border-rose/20 px-6 py-2 flex items-center justify-between shrink-0">
            <span className="text-sm text-rose">{error}</span>
            <button onClick={clearError} className="text-xs text-rose underline">
              Закрыть
            </button>
          </div>
        )}
        <PipelineHeader activeView={activeView} />
        {renderView()}
      </main>
    </div>
  )
}

export default App
