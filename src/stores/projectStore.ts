import { create } from 'zustand'
import type { Project, Shot, ShotStatus, PipelineStage, BriefAsset, DirectorReviewStage } from '../types'
import { api } from '../lib/api'
import { useToastStore } from './toastStore'

const toast = (type: 'success' | 'info' | 'error', title: string, description?: string) =>
  useToastStore.getState().addToast(type, title, description)

const getActionErrorMessage = (error: unknown, fallback = 'Unknown error') => {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  activeShotId: string | null
  loading: boolean
  error: string | null

  // Track in-flight async operations (survives page navigation)
  generatingShotIds: Set<string>
  enhancingShotIds: Set<string>
  generatingVideoShotIds: Set<string>
  describeProgress: { active: boolean; currentId: string | null; done: number; total: number }

  // Director
  directorLoading: boolean
  directorReviewStage: DirectorReviewStage | 'all' | null

  activeProject: () => Project | null
  activeShot: () => Shot | null

  // Async actions (API-backed)
  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  createProject: (name: string) => Promise<void>
  generateScript: () => Promise<void>
  splitShots: () => Promise<void>
  generateImage: (shotId: string) => Promise<void>
  generateVideo: (shotId: string) => Promise<void>
  generateAllVideos: () => Promise<void>
  enhanceImage: (shotId: string, sourceImage: string) => Promise<void>
  enhanceAll: () => Promise<void>
  cancelGeneration: (shotId: string) => Promise<void>
  cancelAllGeneration: () => Promise<void>
  describeAllAssets: () => Promise<void>
  describeOneAsset: (assetId: string) => Promise<void>
  cancelDescribe: () => void

  // Sync setters (local state)
  setActiveProject: (id: string | null) => void
  setActiveShotId: (id: string | null) => void

  // Optimistic + async background save
  updateShot: (projectId: string, shotId: string, updates: Partial<Shot>) => void
  updateShotStatus: (projectId: string, shotId: string, status: ShotStatus) => void
  batchUpdateShotStatus: (projectId: string, shotIds: string[], status: ShotStatus) => void
  updateProjectStage: (projectId: string, stage: PipelineStage) => void
  updateBriefText: (projectId: string, text: string) => void
  updateTargetDuration: (projectId: string, duration: number) => void
  addBriefAsset: (projectId: string, asset: BriefAsset) => void
  removeBriefAsset: (projectId: string, assetId: string) => void
  updateAssetLabel: (projectId: string, assetId: string, label: string) => void
  deleteShotImage: (projectId: string, shotId: string, filename: string) => void
  deleteShotVideo: (projectId: string, shotId: string) => void
  clearError: () => void

  // Director actions
  directorReviewScript: () => Promise<void>
  directorReviewShots: () => Promise<void>
  directorReviewImages: () => Promise<void>
  directorReviewAll: () => Promise<void>
  directorApplyFeedback: (reviewId: string, action: string, shotId?: string, shotIds?: string[]) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeShotId: null,
  loading: false,
  error: null,
  generatingShotIds: new Set<string>(),
  enhancingShotIds: new Set<string>(),
  generatingVideoShotIds: new Set<string>(),
  describeProgress: { active: false, currentId: null, done: 0, total: 0 },
  directorLoading: false,
  directorReviewStage: null,

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
      set({ error: getActionErrorMessage(e), loading: false })
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
        return { projects, activeProjectId: id, activeShotId: null, loading: false }
      })
    } catch (e: any) {
      set({ error: getActionErrorMessage(e), loading: false })
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
      set({ error: getActionErrorMessage(e), loading: false })
    }
  },

  generateScript: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ loading: true, error: null })
    try {
      await api.generate.script(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        loading: false,
      }))
      toast('success', 'Сценарий сгенерирован', 'Сценарий создан и переведен на этап сценария')
    } catch (e: any) {
      set({ error: getActionErrorMessage(e), loading: false })
      toast('error', 'Ошибка генерации сценария', getActionErrorMessage(e))
    }
  },

  splitShots: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ loading: true, error: null })
    try {
      await api.generate.splitShots(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        loading: false,
      }))
      const count = project.shots?.length || 0
      toast('success', 'Шоты разбиты', `Создано ${count} шотов, проект переведен на этап шотов`)
    } catch (e: any) {
      set({ error: getActionErrorMessage(e), loading: false })
      toast('error', 'Ошибка разбивки на шоты', getActionErrorMessage(e))
    }
  },

  generateImage: async (shotId: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    // Track in store; survives page navigation
    set((state) => ({
      error: null,
      generatingShotIds: new Set([...state.generatingShotIds, shotId]),
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, status: 'img_gen' as ShotStatus } : s)) }
          : p
      ),
    }))
    try {
      await api.generate.image(projectId, shotId)
      const project = await api.projects.get(projectId)
      set((state) => {
        const next = new Set(state.generatingShotIds)
        next.delete(shotId)
        return {
          generatingShotIds: next,
          projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        }
      })
      const shot = project.shots?.find((s: any) => s.id === shotId)
      toast('success', 'Изображение сгенерировано', `Шот #${String((shot?.order ?? 0)).padStart(2, '0')} переведен в этап ревью изображения`)
    } catch (e: any) {
      set((state) => {
        const next = new Set(state.generatingShotIds)
        next.delete(shotId)
        return { generatingShotIds: next }
      })
      const isCancelled = getActionErrorMessage(e)?.includes('cancelled')
      if (!isCancelled) {
        set({ error: getActionErrorMessage(e) })
        toast('error', 'Ошибка генерации изображения', getActionErrorMessage(e))
      }
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

  enhanceImage: async (shotId: string, sourceImage: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set((state) => ({
      enhancingShotIds: new Set([...state.enhancingShotIds, shotId]),
    }))
    try {
      await api.generate.enhance(projectId, shotId, sourceImage)
      const project = await api.projects.get(projectId)
      set((state) => {
        const next = new Set(state.enhancingShotIds)
        next.delete(shotId)
        return {
          enhancingShotIds: next,
          projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        }
      })
      toast('success', 'Enhance завершен', 'Улучшенное изображение добавлено')
    } catch (e: any) {
      set((state) => {
        const next = new Set(state.enhancingShotIds)
        next.delete(shotId)
        return { enhancingShotIds: next }
      })
      toast('error', 'Ошибка Enhance', getActionErrorMessage(e))
    }
  },

  enhanceAll: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    try {
      const result = await api.generate.enhanceAll(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
      }))
      toast('success', 'Enhance завершен', `Улучшено ${result.enhanced} из ${result.total} шотов`)
    } catch (e: any) {
      toast('error', 'Ошибка пакетного Enhance', getActionErrorMessage(e))
    }
  },

  generateVideo: async (shotId: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    // Optimistic update: move shot into vid_gen immediately so Kanban reflects the running job.
    set((state) => ({
      error: null,
      generatingVideoShotIds: new Set([...state.generatingVideoShotIds, shotId]),
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, status: 'vid_gen' as ShotStatus } : s)) }
          : p
      ),
    }))
    try {
      await api.generate.video(projectId, shotId)
      const project = await api.projects.get(projectId)
      set((state) => {
        const next = new Set(state.generatingVideoShotIds)
        next.delete(shotId)
        return {
          generatingVideoShotIds: next,
          projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        }
      })
      toast('success', 'Видео сгенерировано', 'Видео для этого шота готово')
    } catch (e: any) {
      set((state) => {
        const next = new Set(state.generatingVideoShotIds)
        next.delete(shotId)
        return { generatingVideoShotIds: next }
      })
      toast('error', 'Ошибка генерации видео', getActionErrorMessage(e))

      // Reload to restore server truth (e.g. rollback vid_gen -> img_review on failure).
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

  generateAllVideos: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    try {
      const result = await api.generate.allVideos(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
      }))
      toast('success', 'Генерация всех видео завершена', `Сгенерировано ${result.generated} из ${result.total} видео`)
    } catch (e: any) {
      toast('error', 'Ошибка генерации всех видео', getActionErrorMessage(e))
    }
  },

  describeAllAssets: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    const project = get().activeProject()
    if (!project) return
    const toDescribe = project.brief.assets.filter((a) => !a.label?.trim())
    if (toDescribe.length === 0) return

    set({ describeProgress: { active: true, currentId: null, done: 0, total: toDescribe.length } })

    let done = 0
    for (const asset of toDescribe) {
      // Check if cancelled
      if (!get().describeProgress.active) break
      set((state) => ({
        describeProgress: { ...state.describeProgress, currentId: asset.id },
      }))
      try {
        const result = await api.assets.describe(projectId, asset.id)
        // Update label locally
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  brief: {
                    ...p.brief,
                    assets: p.brief.assets.map((a) =>
                      a.id === asset.id ? { ...a, label: result.label } : a
                    ),
                  },
                }
              : p
          ),
        }))
      } catch (e) {
        console.error(`Describe failed for ${asset.filename}:`, e)
      }
      done++
      set((state) => ({
        describeProgress: { ...state.describeProgress, done },
      }))
    }

    const wasCancelled = !get().describeProgress.active
    set({ describeProgress: { active: false, currentId: null, done: 0, total: 0 } })
    if (done > 0) {
      toast(
        wasCancelled ? 'info' : 'success',
        wasCancelled ? 'РћРїРёСЃР°РЅРёРµ РѕС‚РјРµРЅРµРЅРѕ' : 'РћРїРёСЃР°РЅРёРµ Р·Р°РІРµСЂС€РµРЅРѕ',
        `РћРїРёСЃР°РЅРѕ ${done} РёР· ${toDescribe.length} Р°СЃСЃРµС‚РѕРІ`
      )
    }
  },

  describeOneAsset: async (assetId: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ describeProgress: { active: true, currentId: assetId, done: 0, total: 1 } })
    try {
      const result = await api.assets.describe(projectId, assetId)
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                brief: {
                  ...p.brief,
                  assets: p.brief.assets.map((a) =>
                    a.id === assetId ? { ...a, label: result.label } : a
                  ),
                },
              }
            : p
        ),
      }))
    } catch (e) {
      console.error('Describe failed:', e)
    } finally {
      set({ describeProgress: { active: false, currentId: null, done: 0, total: 0 } })
    }
  },

  cancelDescribe: () => {
    set({ describeProgress: { active: false, currentId: null, done: 0, total: 0 } })
  },

  cancelGeneration: async (shotId: string) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    try {
      await api.generate.cancelImage(projectId, shotId)
      // Optimistic update: img_gen -> draft, vid_gen -> img_review
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                shots: p.shots.map((s) => {
                  if (s.id !== shotId) return s
                  if (s.status === 'vid_gen') return { ...s, status: 'img_review' as ShotStatus }
                  return { ...s, status: 'draft' as ShotStatus }
                }),
              }
            : p
        ),
      }))
    } catch (e: any) {
      console.error('Cancel failed:', e)
    }
  },

  cancelAllGeneration: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    try {
      await api.generate.cancelAll(projectId)
      // Optimistic update: img_gen -> draft, vid_gen -> img_review
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                shots: p.shots.map((s) => {
                  if (s.status === 'img_gen') return { ...s, status: 'draft' as ShotStatus }
                  if (s.status === 'vid_gen') return { ...s, status: 'img_review' as ShotStatus }
                  return s
                }),
              }
            : p
        ),
      }))
    } catch (e: any) {
      console.error('Cancel all failed:', e)
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
    // Optimistic local update: when reverting to draft, also clear generated content
    const clearGenerated = status === 'draft'
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              shots: p.shots.map((s) =>
                s.id === shotId
                  ? {
                      ...s,
                      status,
                      ...(clearGenerated && {
                        generatedImages: [],
                        enhancedImages: [],
                        videoFile: null,
                      }),
                    }
                  : s
              ),
            }
          : p
      ),
    }))
    // Background save
    api.shots.setStatus(projectId, shotId, status).catch((e) => {
      console.error('Failed to update shot status:', e)
    })
  },

  batchUpdateShotStatus: (projectId, shotIds, status) => {
    const clearGenerated = status === 'draft'
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              shots: p.shots.map((s) =>
                shotIds.includes(s.id)
                  ? {
                      ...s,
                      status,
                      ...(clearGenerated && {
                        generatedImages: [],
                        enhancedImages: [],
                        videoFile: null,
                      }),
                    }
                  : s
              ),
            }
          : p
      ),
    }))
    api.shots.batchSetStatus(projectId, shotIds, status).catch((e) => {
      console.error('Failed to batch update shot status:', e)
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
    // Background save - debounced by the caller (BriefEditor)
    api.projects.update(projectId, { brief: { text } }).catch((e) => {
      console.error('Failed to save brief text:', e)
    })
  },

  updateTargetDuration: (projectId, duration) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, brief: { ...p.brief, targetDuration: duration } } : p
      ),
    }))
    api.projects.update(projectId, { brief: { targetDuration: duration } }).catch((e) => {
      console.error('Failed to save target duration:', e)
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

  updateAssetLabel: (projectId, assetId, label) => {
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
    }))
    // Background save
    api.assets.updateLabel(projectId, assetId, label).catch((e) => {
      console.error('Failed to save asset label:', e)
    })
  },

  deleteShotImage: (projectId, shotId, filename) => {
    // Optimistic: remove from generatedImages and enhancedImages
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              shots: p.shots.map((s) =>
                s.id === shotId
                  ? {
                      ...s,
                      generatedImages: s.generatedImages.filter((f) => f !== filename),
                      enhancedImages: (s.enhancedImages || []).filter((f) => f !== filename),
                    }
                  : s
              ),
            }
          : p
      ),
    }))
    // Background delete
    api.shots.deleteImage(projectId, shotId, filename).catch((e) => {
      console.error('Failed to delete shot image:', e)
    })
  },

  deleteShotVideo: (projectId, shotId) => {
    // Optimistic: set videoFile to null
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              shots: p.shots.map((s) =>
                s.id === shotId ? { ...s, videoFile: null } : s
              ),
            }
          : p
      ),
    }))
    // Background delete
    api.shots.deleteVideo(projectId, shotId).catch((e) => {
      console.error('Failed to delete shot video:', e)
    })
  },

  // --- Director actions ---

  directorReviewScript: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ directorLoading: true, directorReviewStage: 'script' })
    try {
      await api.director.reviewScript(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        directorLoading: false,
        directorReviewStage: null,
      }))
      toast('success', 'Ревью сценария завершено')
    } catch (e: any) {
      set({ directorLoading: false, directorReviewStage: null })
      toast('error', 'Ошибка ревью сценария', getActionErrorMessage(e))
    }
  },

  directorReviewShots: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ directorLoading: true, directorReviewStage: 'shots' })
    try {
      await api.director.reviewShots(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        directorLoading: false,
        directorReviewStage: null,
      }))
      toast('success', 'Ревью шотов завершено')
    } catch (e: any) {
      set({ directorLoading: false, directorReviewStage: null })
      toast('error', 'Ошибка ревью шотов', getActionErrorMessage(e))
    }
  },

  directorReviewImages: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ directorLoading: true, directorReviewStage: 'images' })
    try {
      await api.director.reviewImages(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        directorLoading: false,
        directorReviewStage: null,
      }))
      toast('success', 'Ревью изображений завершено')
    } catch (e: any) {
      set({ directorLoading: false, directorReviewStage: null })
      toast('error', 'Ошибка ревью изображений', getActionErrorMessage(e))
    }
  },

  directorReviewAll: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ directorLoading: true, directorReviewStage: 'all' })
    try {
      await api.director.reviewAll(projectId)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        directorLoading: false,
        directorReviewStage: null,
      }))
      toast('success', 'Полное ревью завершено')
    } catch (e: any) {
      set({ directorLoading: false, directorReviewStage: null })
      toast('error', 'Ошибка полного ревью', getActionErrorMessage(e))
    }
  },

  directorApplyFeedback: async (reviewId, action, shotId?, shotIds?) => {
    const projectId = get().activeProjectId
    if (!projectId) return
    set({ directorLoading: true })
    try {
      await api.director.applyFeedback(projectId, reviewId, action, shotId, shotIds)
      const project = await api.projects.get(projectId)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? project : p)),
        directorLoading: false,
      }))
      const actionLabels: Record<string, string> = {
        'regenerate-script': 'Сценарий пересобран',
        'regenerate-shots': 'Шоты пересобраны',
        'regenerate-image': 'Изображение перегенерировано',
        'regenerate-images': 'Изображения перегенерированы',
        'reject-image': 'Изображение отклонено',
      }
      toast('success', actionLabels[action] || 'Действие применено')
    } catch (e: any) {
      set({ directorLoading: false })
      toast('error', 'Ошибка применения фидбека', getActionErrorMessage(e))
    }
  },
}))
