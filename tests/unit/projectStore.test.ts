import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useProjectStore } from '../../src/stores/projectStore'

// Mock the api module
vi.mock('../../src/lib/api', () => ({
  api: {
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    assets: {
      delete: vi.fn(),
    },
    shots: {
      update: vi.fn(),
      setStatus: vi.fn(),
    },
    generate: {
      script: vi.fn(),
      splitShots: vi.fn(),
      image: vi.fn(),
    },
  },
}))

import { api } from '../../src/lib/api'

const mockedApi = vi.mocked(api, true)

// Sample project data for tests
function makeProject(overrides: Partial<any> = {}): any {
  return {
    id: 'proj-1',
    name: 'Test Project',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    stage: 'brief' as const,
    briefType: 'text' as const,
    brief: { text: '', assets: [], targetDuration: 60 },
    script: '',
    shots: [],
    settings: {
      textModel: 'openai/gpt-4o',
      imageModel: 'openai/dall-e-3',
      masterPromptScriptwriter: '',
      masterPromptShotSplitter: '',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  // Reset the store to initial state
  useProjectStore.setState({
    projects: [],
    activeProjectId: null,
    activeShotId: null,
    loading: false,
    error: null,
  })
  // Default: background saves resolve
  mockedApi.projects.update.mockResolvedValue({})
  mockedApi.assets.delete.mockResolvedValue(undefined as any)
  mockedApi.shots.update.mockResolvedValue({})
  mockedApi.shots.setStatus.mockResolvedValue({})
})

describe('projectStore', () => {
  describe('loadProjects', () => {
    it('fetches and sets projects', async () => {
      const projects = [makeProject(), makeProject({ id: 'proj-2', name: 'Second' })]
      mockedApi.projects.list.mockResolvedValue(projects)

      await act(async () => {
        await useProjectStore.getState().loadProjects()
      })

      const state = useProjectStore.getState()
      expect(state.projects).toEqual(projects)
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('sets error on failure', async () => {
      mockedApi.projects.list.mockRejectedValue(new Error('Network error'))

      await act(async () => {
        await useProjectStore.getState().loadProjects()
      })

      const state = useProjectStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.loading).toBe(false)
      expect(state.projects).toEqual([])
    })
  })

  describe('createProject', () => {
    it('creates and sets as active', async () => {
      const newProject = makeProject({ id: 'new-proj', name: 'New Project' })
      mockedApi.projects.create.mockResolvedValue(newProject)

      await act(async () => {
        await useProjectStore.getState().createProject('New Project')
      })

      const state = useProjectStore.getState()
      expect(state.projects).toHaveLength(1)
      expect(state.projects[0].id).toBe('new-proj')
      expect(state.activeProjectId).toBe('new-proj')
      expect(state.activeShotId).toBeNull()
      expect(state.loading).toBe(false)
    })

    it('calls api.projects.create with the name', async () => {
      mockedApi.projects.create.mockResolvedValue(makeProject())

      await act(async () => {
        await useProjectStore.getState().createProject('My Video')
      })

      expect(mockedApi.projects.create).toHaveBeenCalledWith('My Video')
    })
  })

  describe('loadProject', () => {
    it('loads project by id and clears activeShotId', async () => {
      const existing = makeProject({ id: 'proj-1' })
      const loaded = makeProject({ id: 'proj-2', name: 'Loaded' })
      mockedApi.projects.get.mockResolvedValue(loaded)
      useProjectStore.setState({
        projects: [existing],
        activeProjectId: 'proj-1',
        activeShotId: 'shot-123',
        loading: false,
        error: null,
      })

      await act(async () => {
        await useProjectStore.getState().loadProject('proj-2')
      })

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-2')
      expect(state.activeShotId).toBeNull()
      expect(state.projects.find((p) => p.id === 'proj-2')?.name).toBe('Loaded')
      expect(state.loading).toBe(false)
    })
  })

  describe('setActiveProject', () => {
    it('sets active id and clears activeShotId', () => {
      useProjectStore.setState({
        projects: [makeProject()],
        activeProjectId: null,
        activeShotId: 'some-shot',
      })

      act(() => {
        useProjectStore.getState().setActiveProject('proj-1')
      })

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-1')
      expect(state.activeShotId).toBeNull()
    })

    it('can set to null', () => {
      useProjectStore.setState({
        activeProjectId: 'proj-1',
        activeShotId: 'shot-1',
      })

      act(() => {
        useProjectStore.getState().setActiveProject(null)
      })

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBeNull()
      expect(state.activeShotId).toBeNull()
    })
  })

  describe('activeProject()', () => {
    it('returns the correct project when activeProjectId is set', () => {
      const proj = makeProject({ id: 'proj-1' })
      useProjectStore.setState({
        projects: [proj, makeProject({ id: 'proj-2' })],
        activeProjectId: 'proj-1',
      })

      const result = useProjectStore.getState().activeProject()
      expect(result).toEqual(proj)
    })

    it('returns null when no activeProjectId', () => {
      useProjectStore.setState({
        projects: [makeProject()],
        activeProjectId: null,
      })

      const result = useProjectStore.getState().activeProject()
      expect(result).toBeNull()
    })

    it('returns null when activeProjectId does not match any project', () => {
      useProjectStore.setState({
        projects: [makeProject({ id: 'proj-1' })],
        activeProjectId: 'non-existent',
      })

      const result = useProjectStore.getState().activeProject()
      expect(result).toBeNull()
    })
  })

  describe('optimistic updates', () => {
    describe('updateBriefText', () => {
      it('updates the brief text optimistically', () => {
        const proj = makeProject({ id: 'proj-1', brief: { text: '', assets: [] } })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().updateBriefText('proj-1', 'New brief text')
        })

        const updated = useProjectStore.getState().projects[0]
        expect(updated.brief.text).toBe('New brief text')
      })

      it('calls api.projects.update in the background', () => {
        const proj = makeProject({ id: 'proj-1', brief: { text: '', assets: [] } })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().updateBriefText('proj-1', 'Updated text')
        })

        expect(mockedApi.projects.update).toHaveBeenCalledWith(
          'proj-1',
          expect.objectContaining({
            brief: expect.objectContaining({ text: 'Updated text' }),
          }),
        )
      })

      it('does not modify other projects', () => {
        const proj1 = makeProject({ id: 'proj-1', brief: { text: 'original', assets: [] } })
        const proj2 = makeProject({ id: 'proj-2', brief: { text: 'other', assets: [] } })
        useProjectStore.setState({ projects: [proj1, proj2] })

        act(() => {
          useProjectStore.getState().updateBriefText('proj-1', 'changed')
        })

        const state = useProjectStore.getState()
        expect(state.projects[0].brief.text).toBe('changed')
        expect(state.projects[1].brief.text).toBe('other')
      })
    })

    describe('updateProjectStage', () => {
      it('updates the stage optimistically', () => {
        const proj = makeProject({ id: 'proj-1', stage: 'brief' })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().updateProjectStage('proj-1', 'script')
        })

        expect(useProjectStore.getState().projects[0].stage).toBe('script')
      })

      it('calls api.projects.update with the new stage', () => {
        const proj = makeProject({ id: 'proj-1' })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().updateProjectStage('proj-1', 'shots')
        })

        expect(mockedApi.projects.update).toHaveBeenCalledWith('proj-1', {
          stage: 'shots',
        })
      })
    })

    describe('addBriefAsset', () => {
      it('adds an asset to the brief', () => {
        const proj = makeProject({ id: 'proj-1', brief: { text: '', assets: [] } })
        useProjectStore.setState({ projects: [proj] })

        const asset = {
          id: 'asset-1',
          filename: 'photo.jpg',
          label: '',
          url: '/uploads/photo.jpg',
        }

        act(() => {
          useProjectStore.getState().addBriefAsset('proj-1', asset)
        })

        const updated = useProjectStore.getState().projects[0]
        expect(updated.brief.assets).toHaveLength(1)
        expect(updated.brief.assets[0]).toEqual(asset)
      })

      it('appends to existing assets', () => {
        const existingAsset = {
          id: 'asset-0',
          filename: 'existing.png',
          label: '',
          url: '/uploads/existing.png',
        }
        const proj = makeProject({
          id: 'proj-1',
          brief: { text: '', assets: [existingAsset] },
        })
        useProjectStore.setState({ projects: [proj] })

        const newAsset = {
          id: 'asset-1',
          filename: 'new.jpg',
          label: '',
          url: '/uploads/new.jpg',
        }

        act(() => {
          useProjectStore.getState().addBriefAsset('proj-1', newAsset)
        })

        const updated = useProjectStore.getState().projects[0]
        expect(updated.brief.assets).toHaveLength(2)
        expect(updated.brief.assets[1]).toEqual(newAsset)
      })
    })

    describe('removeBriefAsset', () => {
      it('removes an asset by id', () => {
        const asset1 = {
          id: 'asset-1',
          filename: 'a.jpg',
          label: '',
          url: '/a.jpg',
        }
        const asset2 = {
          id: 'asset-2',
          filename: 'b.jpg',
          label: '',
          url: '/b.jpg',
        }
        const proj = makeProject({
          id: 'proj-1',
          brief: { text: '', assets: [asset1, asset2] },
        })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().removeBriefAsset('proj-1', 'asset-1')
        })

        const updated = useProjectStore.getState().projects[0]
        expect(updated.brief.assets).toHaveLength(1)
        expect(updated.brief.assets[0].id).toBe('asset-2')
      })

      it('calls api.assets.delete in the background', () => {
        const asset = {
          id: 'asset-1',
          filename: 'a.jpg',
          label: '',
          url: '/a.jpg',
        }
        const proj = makeProject({
          id: 'proj-1',
          brief: { text: '', assets: [asset] },
        })
        useProjectStore.setState({ projects: [proj] })

        act(() => {
          useProjectStore.getState().removeBriefAsset('proj-1', 'asset-1')
        })

        expect(mockedApi.assets.delete).toHaveBeenCalledWith('proj-1', 'asset-1')
      })
    })
  })
})
