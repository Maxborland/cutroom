import { create } from 'zustand'
import type { Project, Shot, ShotStatus, PipelineStage, BriefAsset } from '../types'
import { api } from '../lib/api'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  activeShotId: string | null
  loading: boolean
  error: string | null

  activeProject: () => Project | null
  activeShot: () => Shot | null

  // Async actions (API-backed)
  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  createProject: (name: string) => Promise<void>
  generateScript: () => Promise<void>
  splitShots: () => Promise<void>
  generateImage: (shotId: string) => Promise<void>

  // Sync setters (local state)
  setActiveProject: (id: string | null) => void
  setActiveShotId: (id: string | null) => void

  // Optimistic + async background save
  updateShot: (projectId: string, shotId: string, updates: Partial<Shot>) => void
  updateShotStatus: (projectId: string, shotId: string, status: ShotStatus) => void
  updateProjectStage: (projectId: string, stage: PipelineStage) => void
  updateBriefText: (projectId: string, text: string) => void
  addBriefAsset: (projectId: string, asset: BriefAsset) => void
  removeBriefAsset: (projectId: string, assetId: string) => void
  updateAssetLabel: (projectId: string, assetId: string, label: string) => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeShotId: null,
  loading: false,
  error: null,

  activeProject: () => {
    const { projects, activeProjectId } = get()
    return projects.find((p) => p.id === activeProjectId) ?? null
  },

  activeShot: () => {
    const project = get().activeProject()
    if (!project) return null
    return project.shots.find((s) => s.id === get().activeShotId) ?? null
  },

  clearError: () => set({ error: null }),

  // --- Async actions ---

  loadProjects: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await api.projects.list()
      set({ projects, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  loadProject: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const project = await api.projects.get(id)
      set((state) => {
        const exists = state.projects.some((p) => p.id === id)
        const projects = exists
          ? state.projects.map((p) => (p.id === id ? project : p))
          : [...state.projects, project]
        return { projects, activeProjectId: id, loading: false }
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createProject: async (name: string) => {
    set({ loading: true, error: null })
    try {
      const project = await api.projects.create(name)
      set((state) => ({
        projects: [...state.projects, project],
        activeProjectId: project.id,
        activeShotId: null,
        loading: false,
      }))
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  generateScript: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ loading: true, error: null })
    try {
      await api.generate.script(projectId)
      // Reload the project to get the updated script
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        loading: false,
      }))
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  splitShots: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ loading: true, error: null })
    try {
      await api.generate.splitShots(projectId)
      // Reload to get updated shots
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        loading: false,
      }))
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  generateImage: async (shotId: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    // Set shot status to generating optimistically
    set((state) => ({
      error: null,
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, status: 'generating' as ShotStatus } : s)) }
          : p
      ),
    }))
    try {
      await api.generate.image(projectId, shotId)
      // Reload project to get the generated image data
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
      }))
    } catch (e: any) {
      set({ error: e.message })
      // Reload project to get correct state
      try {
        const project = await api.projects.get(projectId)
        set((state) => ({
          projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        }))
      } catch {
        // ignore reload error
      }
    }
  },

  // --- Sync setters ---

  setActiveProject: (id) => set({ activeProjectId: id, activeShotId: null }),
  setActiveShotId: (id) => set({ activeShotId: id }),

  // --- Optimistic updates with background API sync ---

  updateShot: (projectId, shotId, updates) => {
    // Optimistic local update
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, ...updates } : s)) }
          : p
      ),
    }))
    // Background save
    api.shots.update(projectId, shotId, updates).catch((e) => {
      console.error('Failed to save shot:', e)
    })
  },

  updateShotStatus: (projectId, shotId, status) => {
    // Optimistic local update
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, status } : s)) }
          : p
      ),
    }))
    // Background save
    api.shots.setStatus(projectId, shotId, status).catch((e) => {
      console.error('Failed to update shot status:', e)
    })
  },

  updateProjectStage: (projectId, stage) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, stage } : p)),
    }))
    // Background save
    api.projects.update(projectId, { stage }).catch((e) => {
      console.error('Failed to update project stage:', e)
    })
  },

  updateBriefText: (projectId, text) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, brief: { ...p.brief, text } } : p
      ),
    }))
    // Background save — debounced by the caller (BriefEditor)
    api.projects.update(projectId, { brief: { text } }).catch((e) => {
      console.error('Failed to save brief text:', e)
    })
  },

  addBriefAsset: (projectId, asset) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, brief: { ...p.brief, assets: [...p.brief.assets, asset] } }
          : p
      ),
    })),

  removeBriefAsset: (projectId, assetId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, brief: { ...p.brief, assets: p.brief.assets.filter((a) => a.id !== assetId) } }
          : p
      ),
    }))
    // Background delete
    api.assets.delete(projectId, assetId).catch((e) => {
      console.error('Failed to delete asset:', e)
    })
  },

  updateAssetLabel: (projectId, assetId, label) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              brief: {
                ...p.brief,
                assets: p.brief.assets.map((a) => (a.id === assetId ? { ...a, label } : a)),
              },
            }
          : p
      ),
    })),
}))
