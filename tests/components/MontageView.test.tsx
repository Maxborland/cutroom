import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MontageView } from '../../src/components/MontageView'
import { useProjectStore } from '../../src/stores/projectStore'
import { api } from '../../src/lib/api'
import type { Project } from '../../src/types'

vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    montage: {
      getVoices: vi.fn().mockResolvedValue({
        providers: [],
        voices: [],
      }),
      describeVideos: vi.fn(),
      extractAnchors: vi.fn(),
      matchAnchors: vi.fn(),
      updateAnchorMatches: vi.fn(),
      generatePlan: vi.fn(),
      refinePlan: vi.fn(),
      musicUrl: vi.fn(() => '/music'),
      voiceoverUrl: vi.fn(() => '/voiceover'),
      getRenderStatus: vi.fn(),
      render: vi.fn(),
      getRenderDownloadUrl: vi.fn(() => '/download'),
    },
  },
}))

const mockedUseProjectStore = vi.mocked(useProjectStore)

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Тестовый проект',
    created: '2026-03-13T00:00:00.000Z',
    updated: '2026-03-13T00:00:00.000Z',
    stage: 'montage_draft',
    briefType: 'text',
    brief: {
      text: '',
      assets: [],
      targetDuration: 30,
    },
    script: 'Сценарий',
    shots: [
      {
        id: 'shot-1',
        order: 1,
        status: 'approved',
        scene: 'Фасад',
        audioDescription: '',
        imagePrompt: '',
        videoPrompt: '',
        duration: 5,
        assetRefs: [],
        generatedImages: [],
        enhancedImages: [],
        videoFile: 'clip-1.mp4',
      },
      {
        id: 'shot-2',
        order: 2,
        status: 'approved',
        scene: 'Терраса',
        audioDescription: '',
        imagePrompt: '',
        videoPrompt: '',
        duration: 5,
        assetRefs: [],
        generatedImages: [],
        enhancedImages: [],
        videoFile: 'clip-2.mp4',
      },
    ],
    settings: {
      textModel: 'openai/gpt-4o',
      imageModel: 'image-model',
      enhanceModel: 'enhance-model',
      masterPromptScriptwriter: '',
      masterPromptShotSplitter: '',
      masterPromptEnhance: '',
    },
    voiceoverScript: 'Текст озвучки',
    voiceoverScriptApproved: true,
    musicFile: 'montage/music.mp3',
    montagePlan: undefined,
    narrationAnchors: [
      {
        id: 'anchor-1',
        sourceText: 'Терраса с видом',
        label: 'Терраса',
        order: 1,
        intent: 'lifestyle',
      },
    ],
    anchorMatches: [
      {
        anchorId: 'anchor-1',
        selectedShotId: 'shot-1',
        confidence: 0.44,
        status: 'weak_match',
        candidates: [],
      },
    ],
    anchorCoverageSummary: {
      totalAnchors: 1,
      matchedAnchors: 0,
      weakMatches: 1,
      unmatchedAnchors: 0,
    },
    ...overrides,
  }
}

function renderMontage(project: Project) {
  const state = {
    activeProject: () => project,
    loadProject: vi.fn().mockResolvedValue(undefined),
  }

  mockedUseProjectStore.mockImplementation((selector: (value: typeof state) => unknown) => selector(state))

  return render(
    <MemoryRouter>
      <MontageView />
    </MemoryRouter>,
  )
}

describe('MontageView semantic planning panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders semantic planning controls and weak-match warning in the plan step', async () => {
    const user = userEvent.setup()
    renderMontage(makeProject())

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))

    expect(screen.getByText('Семантическая сборка')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Описать видео' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Извлечь якоря' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сопоставить' })).toBeInTheDocument()
    expect(screen.getByText(/требуют проверки/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('shot-1')).toBeInTheDocument()
  })

  it('saves manual shot overrides for weak matches', async () => {
    const user = userEvent.setup()
    const updateAnchorMatchesMock = vi.mocked(api.montage.updateAnchorMatches)
    updateAnchorMatchesMock.mockResolvedValue({
      anchorMatches: [
        {
          anchorId: 'anchor-1',
          selectedShotId: 'shot-2',
          confidence: 0.44,
          status: 'matched',
          candidates: [],
        },
      ],
      anchorCoverageSummary: {
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      },
    })

    renderMontage(makeProject())

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Выбор шота для якоря Терраса' }), 'shot-2')
    await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))

    await waitFor(() => {
      expect(updateAnchorMatchesMock).toHaveBeenCalledWith('project-1', [
        expect.objectContaining({
          anchorId: 'anchor-1',
          selectedShotId: 'shot-2',
          status: 'matched',
        }),
      ])
    })
  })
})
