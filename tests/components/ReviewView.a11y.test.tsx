import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    generate: {
      aiReview: vi.fn(),
    },
    shots: {
      generatedImageUrl: vi.fn((_projectId: string, _shotId: string, filename: string) =>
        `/generated/${filename}`
      ),
    },
  },
}))

const mockedUseProjectStore = vi.mocked(useProjectStore)

describe('ReviewView accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const project: any = {
      id: 'proj-1',
      name: 'Test project',
      created: '2026-02-19T00:00:00.000Z',
      updated: '2026-02-19T00:00:00.000Z',
      stage: 'review',
      briefType: 'text',
      brief: {
        text: '',
        assets: [],
        targetDuration: 60,
      },
      script: '',
      settings: {
        textModel: 'openai/gpt-4o',
        imageModel: 'openai/gpt-image-1',
        enhanceModel: 'openai/gpt-image-1',
        masterPromptScriptwriter: '',
        masterPromptShotSplitter: '',
        masterPromptEnhance: '',
      },
      shots: [
        {
          id: 'shot-1',
          order: 1,
          status: 'img_review',
          scene: 'Exterior hero shot',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 5,
          assetRefs: [],
          generatedImages: ['generated-1.png'],
          enhancedImages: [],
          videoFile: null,
        },
      ],
    }

    const state = {
      activeProject: () => project,
      updateShotStatus: vi.fn(),
      enhanceImage: vi.fn(),
      enhancingShotIds: new Set<string>(),
    }

    mockedUseProjectStore.mockImplementation((selector: any) => selector(state))
  })

  it('exposes named navigation controls', () => {
    render(<ReviewView />)

    expect(screen.getAllByRole('button', { name: /previous shot/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /next shot/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /shot 1 of 1/i })).toBeInTheDocument()
  })
})
