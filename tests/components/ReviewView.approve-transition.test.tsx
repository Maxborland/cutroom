import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewView } from '../../src/components/ReviewView'
import { useProjectStore } from '../../src/stores/projectStore'

vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('../../src/stores/lightboxStore', () => ({
  useLightboxStore: {
    getState: () => ({ show: vi.fn() }),
  },
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    generate: { aiReview: vi.fn() },
    shots: {
      generatedImageUrl: vi.fn((_projectId: string, _shotId: string, filename: string) => `/generated/${filename}`),
    },
  },
}))

const mockedUseProjectStore = vi.mocked(useProjectStore)

function makeProject(status: 'img_review' | 'vid_review'): any {
  return {
    id: 'proj-1',
    name: 'Test project',
    created: '2026-02-19T00:00:00.000Z',
    updated: '2026-02-19T00:00:00.000Z',
    stage: 'review',
    brief: { text: '', assets: [], targetDuration: 60 },
    script: '',
    settings: {
      scriptwriterPrompt: '',
      shotSplitterPrompt: '',
      model: 'openai/gpt-4o',
      temperature: 0.7,
    },
    shots: [
      {
        id: 'shot-1',
        order: 1,
        status,
        scene: 'Exterior hero shot',
        audioDescription: '',
        imagePrompt: '',
        videoPrompt: '',
        duration: 5,
        assetRefs: [],
        generatedImages: ['generated-1.png'],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ],
  }
}

describe('ReviewView approve transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts video generation when approving an image-review shot', () => {
    const project = makeProject('img_review')
    const updateShotStatus = vi.fn()
    const generateVideo = vi.fn().mockResolvedValue(undefined)

    const state = {
      activeProject: () => project,
      updateShotStatus,
      generateVideo,
      enhanceImage: vi.fn(),
      enhancingShotIds: new Set<string>(),
    }

    mockedUseProjectStore.mockImplementation((selector: any) => selector(state))

    render(<ReviewView />)

    fireEvent.click(screen.getByRole('button', { name: /утвердить/i }))

    expect(generateVideo).toHaveBeenCalledWith('shot-1')
    expect(updateShotStatus).not.toHaveBeenCalledWith('proj-1', 'shot-1', 'approved')
  })

  it('marks shot as approved when approving a video-review shot', () => {
    const project = makeProject('vid_review')
    const updateShotStatus = vi.fn()
    const generateVideo = vi.fn().mockResolvedValue(undefined)

    const state = {
      activeProject: () => project,
      updateShotStatus,
      generateVideo,
      enhanceImage: vi.fn(),
      enhancingShotIds: new Set<string>(),
    }

    mockedUseProjectStore.mockImplementation((selector: any) => selector(state))

    render(<ReviewView />)

    fireEvent.click(screen.getByRole('button', { name: /утвердить/i }))

    expect(updateShotStatus).toHaveBeenCalledWith('proj-1', 'shot-1', 'approved')
    expect(generateVideo).not.toHaveBeenCalled()
  })
})
