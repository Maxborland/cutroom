import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DirectorView } from '../../src/components/DirectorView'
import { useProjectStore } from '../../src/stores/projectStore'
import type { DirectorReview, Project } from '../../src/types'

vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('../../src/stores/lightboxStore', () => ({
  useLightboxStore: {
    getState: () => ({
      show: vi.fn(),
    }),
  },
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    shots: {
      generatedImageUrl: vi.fn(() => '/image.png'),
    },
  },
}))

const mockedUseProjectStore = vi.mocked(useProjectStore)

function makeProject(review: DirectorReview): Project {
  return {
    id: 'project-1',
    name: 'Тестовый проект',
    created: '2026-03-27T00:00:00.000Z',
    updated: '2026-03-27T00:00:00.000Z',
    stage: 'script',
    briefType: 'text',
    brief: {
      text: 'Бриф',
      assets: [],
      targetDuration: 30,
    },
    script: 'Первый абзац.\n\nВторой абзац.',
    shots: [],
    settings: {
      textModel: 'openai/gpt-4o',
      imageModel: 'openai/gpt-image-1',
      enhanceModel: 'openai/gpt-image-1',
      masterPromptScriptwriter: '',
      masterPromptShotSplitter: '',
      masterPromptEnhance: '',
    },
    directorState: {
      reviews: [review],
      latestByStage: {
        script: review.id,
      },
    },
  }
}

function installStore(project: Project, directorApplyFeedback = vi.fn()) {
  const state = {
    activeProject: () => project,
    directorLoading: false,
    directorReviewStage: null,
    directorReviewScript: vi.fn(),
    directorReviewShots: vi.fn(),
    directorReviewImages: vi.fn(),
    directorApplyFeedback,
    batchUpdateShotStatus: vi.fn(),
  }

  mockedUseProjectStore.mockImplementation((selector: (value: typeof state) => unknown) => selector(state))
  return { directorApplyFeedback }
}

describe('DirectorView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Отправить на доработку" for script reviews with revise verdict', () => {
    const review: DirectorReview = {
      id: 'review-script-1',
      stage: 'script',
      createdAt: '2026-03-27T10:00:00.000Z',
      model: 'openai/gpt-4o',
      overallVerdict: 'revise',
      summary: 'Нужна доработка сценария.',
      notes: [
        {
          id: 'note-1',
          target: 'script',
          verdict: 'revise',
          comment: 'Слабый хук в начале.',
          suggestion: 'Сделать более сильное открытие.',
        },
      ],
    }

    installStore(makeProject(review))
    render(<DirectorView />)

    expect(screen.getByRole('button', { name: 'Отправить на доработку' })).toBeInTheDocument()
  })

  it('still shows script rework action when review has open revise notes but overall verdict is approve', () => {
    const review: DirectorReview = {
      id: 'review-script-2',
      stage: 'script',
      createdAt: '2026-03-27T10:00:00.000Z',
      model: 'openai/gpt-4o',
      overallVerdict: 'approve',
      summary: 'В целом хорошо, но есть правки.',
      notes: [
        {
          id: 'note-2',
          target: 'script',
          verdict: 'revise',
          comment: 'Уточнить позиционирование.',
          suggestion: 'Добавить конкретное УТП в первом блоке.',
        },
      ],
    }

    installStore(makeProject(review))
    render(<DirectorView />)

    expect(screen.getByRole('button', { name: 'Отправить на доработку' })).toBeInTheDocument()
  })

  it('sends script review to regenerate with feedback when rework button is clicked', () => {
    const review: DirectorReview = {
      id: 'review-script-3',
      stage: 'script',
      createdAt: '2026-03-27T10:00:00.000Z',
      model: 'openai/gpt-4o',
      overallVerdict: 'revise',
      summary: 'Нужна доработка сценария.',
      notes: [
        {
          id: 'note-3',
          target: 'script',
          verdict: 'revise',
          comment: 'Финал не дожимает ценность.',
        },
      ],
    }

    const { directorApplyFeedback } = installStore(makeProject(review))
    render(<DirectorView />)

    fireEvent.click(screen.getByRole('button', { name: 'Отправить на доработку' }))

    expect(directorApplyFeedback).toHaveBeenCalledWith('review-script-3', 'regenerate-script')
  })
})
