import { useState, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { PipelineHeader } from './components/PipelineHeader'
import { BriefEditor } from './components/BriefEditor'
import { ScriptView } from './components/ScriptView'
import { ShotBoard } from './components/ShotBoard'
import { ReviewView } from './components/ReviewView'
import { ExportView } from './components/ExportView'
import { MontageView } from './components/MontageView'
import { SettingsView } from './components/SettingsView'
import { DirectorView } from './components/DirectorView'
import { Toaster } from './components/Toaster'
import { Lightbox } from './components/Lightbox'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useProjectStore } from './stores/projectStore'
import type { PipelineStage } from './types'
import { Clapperboard, Plus, Loader2 } from 'lucide-react'

const PIPELINE_VIEWS: PipelineStage[] = ['brief', 'script', 'shots', 'review', 'export']
const APP_VIEWS = [...PIPELINE_VIEWS, 'settings', 'director'] as const
type AppView = (typeof APP_VIEWS)[number]

function isAppView(value: string | undefined): value is AppView {
  return !!value && APP_VIEWS.includes(value as AppView)
}

function normalizeView(view: string | undefined, projectStage?: PipelineStage): AppView {
  if (isAppView(view)) return view
  if (projectStage && PIPELINE_VIEWS.includes(projectStage)) return projectStage
  return 'brief'
}

function AppShell() {
  const [newProjectName, setNewProjectName] = useState('')
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId: routeProjectId, view: routeView } = useParams<{ projectId?: string; view?: string }>()

  const loadProjects = useProjectStore((s) => s.loadProjects)
  const loadProject = useProjectStore((s) => s.loadProject)
  const createProject = useProjectStore((s) => s.createProject)
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const project = useProjectStore((s) => s.activeProject())
  const loading = useProjectStore((s) => s.loading)
  const error = useProjectStore((s) => s.error)
  const clearError = useProjectStore((s) => s.clearError)
  const updateProjectStage = useProjectStore((s) => s.updateProjectStage)
  const activeView = normalizeView(routeView, project?.stage)

  useEffect(() => {
    let cancelled = false
    loadProjects().then(() => {
      if (!cancelled) setProjectsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadProjects])

  useEffect(() => {
    if (!projectsLoaded) return
    const state = useProjectStore.getState()
    if (state.projects.length === 0) return

    if (routeProjectId) {
      const exists = state.projects.some((p) => p.id === routeProjectId)
      if (exists) {
        if (state.activeProjectId !== routeProjectId) void loadProject(routeProjectId)
        return
      }
    }

    const fallbackProjectId = state.activeProjectId ?? state.projects[0].id
    if (state.activeProjectId !== fallbackProjectId) {
      void loadProject(fallbackProjectId)
    }
  }, [projectsLoaded, routeProjectId, loadProject])

  useEffect(() => {
    if (!projectsLoaded) return
    if (projects.length === 0) return
    if (!project) return
    if (routeProjectId && routeProjectId !== project.id) return

    const canonicalView = normalizeView(routeView, project.stage)
    const canonicalPath = `/projects/${project.id}/${canonicalView}`
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true })
    }
  }, [projectsLoaded, projects.length, project, routeProjectId, routeView, location.pathname, navigate])

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    await createProject(name)
    const createdId = useProjectStore.getState().activeProjectId
    setNewProjectName('')
    if (createdId) {
      navigate(`/projects/${createdId}/brief`)
    }
  }

  const handleViewChange = (view: string, projectIdOverride?: string) => {
    const targetProjectId = projectIdOverride || project?.id
    if (!targetProjectId) return

    const nextView = normalizeView(view, project?.stage)
    if (project && project.id === targetProjectId && (nextView === 'review' || nextView === 'export')) {
      updateProjectStage(project.id, nextView)
    }
    navigate(`/projects/${targetProjectId}/${nextView}`)
  }

  const renderView = () => {
    switch (activeView) {
      case 'brief':
        return <BriefEditor />
      case 'script':
        return <ScriptView />
      case 'shots':
        return <ShotBoard />
      case 'review':
        return <ReviewView />
      case 'montage':
        return <MontageView />
      case 'export':
        return <ExportView />
      case 'settings':
        return <SettingsView />
      case 'director':
        return <DirectorView />
      default:
        return <BriefEditor />
    }
  }

  if (loading && projects.length === 0 && !activeProjectId) {
    return (
      <div className="flex h-screen w-screen bg-bg items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-amber animate-spin" />
          <p className="text-sm text-text-muted font-mono uppercase tracking-wider">Загрузка...</p>
        </div>
      </div>
    )
  }

  if (!loading && projects.length === 0) {
    return (
      <div className="flex h-screen w-screen bg-bg items-center justify-center">
        <div className="flex flex-col items-center gap-6 max-w-md w-full px-6">
          <div className="w-14 h-14 rounded-[5px] bg-amber border-2 border-border shadow-brutal flex items-center justify-center">
            <Clapperboard size={28} className="text-black" />
          </div>
          <div className="text-center">
            <h1 className="font-heading font-bold text-3xl mb-2 uppercase tracking-tight">CutRoom</h1>
            <p className="text-sm text-text-muted">
              Создайте первый проект, чтобы начать работу с видео-пайплайном.
            </p>
          </div>

          {error && (
            <div className="w-full bg-rose-dim border-2 border-border rounded-[5px] px-4 py-2 text-sm text-rose">
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
              className="flex-1 brutal-input px-4 py-2.5 text-sm"
            />
            <button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Создать
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen bg-bg">
      <Sidebar activeView={activeView} onViewChange={handleViewChange} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="bg-rose-dim border-b-2 border-border px-6 py-2 flex items-center justify-between shrink-0">
            <span className="text-sm text-rose font-bold">{error}</span>
            <button onClick={clearError} className="text-xs text-rose underline font-bold">
              Закрыть
            </button>
          </div>
        )}
        <PipelineHeader activeView={activeView} />
        <ErrorBoundary>{renderView()}</ErrorBoundary>
      </main>
      <Toaster />
      <Lightbox />
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="/projects/:projectId" element={<AppShell />} />
      <Route path="/projects/:projectId/:view" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
