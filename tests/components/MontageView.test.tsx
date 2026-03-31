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
        providers: [{ id: 'kokoro', name: 'Kokoro', configured: true }],
        voices: [{ id: 'af_heart', name: 'Heart', gender: 'female', language: 'en-US', provider: 'kokoro' }],
      }),
      assembleDraft: vi.fn(),
      describeVideos: vi.fn(),
      extractAnchors: vi.fn(),
      matchAnchors: vi.fn(),
      updateAnchorMatches: vi.fn(),
      generatePlan: vi.fn(),
      refinePlan: vi.fn(),
      musicUrl: vi.fn(() => '/music'),
      voiceoverUrl: vi.fn(() => '/voiceover'),
      previewVoice: vi.fn().mockResolvedValue({ previewUrl: '/voice-preview?ts=1', provider: 'kokoro', voiceId: 'af_heart' }),
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
        videoDescription: {
          version: 1,
          summary: 'Фасад и панорамные окна',
          tags: ['фасад'],
          matchHints: ['фасад'],
          moments: [
            {
              id: 'moment-facade',
              label: 'Фасад',
              startSec: 0.5,
              endSec: 2.5,
              tags: ['фасад'],
              summary: 'Кадр фасада с плавным движением камеры',
            },
          ],
        },
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
        videoDescription: {
          version: 1,
          summary: 'Терраса с видом',
          tags: ['терраса'],
          matchHints: ['терраса'],
          moments: [
            {
              id: 'moment-terrace',
              label: 'Терраса',
              startSec: 1.25,
              endSec: 3.75,
              tags: ['терраса'],
              summary: 'Терраса и вид на закат',
            },
          ],
        },
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
        selectedMomentId: 'moment-facade',
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

  it('renders one-click assemble CTA and keeps raw coverage behind manual diagnostics', async () => {
    const user = userEvent.setup()
    renderMontage(makeProject())

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))

    expect(screen.getByText('Семантическая сборка')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Собрать черновик' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ручной режим' })).toBeInTheDocument()
    expect(screen.getByText(/visual-first summary/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Описать видео' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 якорь требует проверки перед сборкой плана.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ручной режим' }))

    expect(screen.getByText('1 якорь требует проверки перед сборкой плана.')).toBeInTheDocument()
  })

  it('allows extracting anchors in manual mode when only script is present', async () => {
    const user = userEvent.setup()
    const extractAnchorsMock = vi.mocked(api.montage.extractAnchors)
    extractAnchorsMock.mockResolvedValue({
      anchors: [
        {
          id: 'anchor-script',
          sourceText: 'Сценарный блок',
          label: 'Сценарий',
          order: 1,
          intent: 'feature',
        },
      ],
    })

    renderMontage(makeProject({
      voiceoverScript: '',
      voiceoverScriptApproved: false,
      narrationAnchors: [],
      anchorMatches: [],
    }))

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))
    await user.click(screen.getByRole('button', { name: 'Ручной режим' }))

    const extractButton = screen.getByRole('button', { name: 'Извлечь якоря' })
    expect(extractButton).toBeEnabled()

    await user.click(extractButton)

    await waitFor(() => {
      expect(extractAnchorsMock).toHaveBeenCalledWith('project-1')
    })
  })

  it('shows visual-first assembly summary after drafting', async () => {
    const user = userEvent.setup()
    const assembleDraftMock = vi.mocked(api.montage.assembleDraft)
    assembleDraftMock.mockResolvedValue({
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-semantic-block-1',
            shotId: 'shot-1',
            clipFile: 'montage/normalized/shot-1.mp4',
            startSec: 0,
            durationSec: 4,
            trimStartSec: 0.5,
            trimEndSec: 4.5,
            anchorId: 'anchor-1',
            selectedMomentId: 'moment-facade',
          },
        ],
        transitions: [],
        motionGraphics: {
          intro: { title: 'Тестовый проект', durationSec: 3, animation: 'fade_in' },
          lowerThirds: [],
          outro: { title: 'Тестовый проект', durationSec: 4, animation: 'fade_in' },
        },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#1a1a2e',
          secondaryColor: '#e2b44d',
          textColor: '#ffffff',
        },
        semanticBlocks: [],
      },
      summary: {
        blocks: 4,
        clips: 6,
        issues: [],
        steps: [],
        directBlocks: 2,
        visualBlocks: 1,
        atmosphericBlocks: 1,
        unresolvedBlocks: 0,
      },
    })

    renderMontage(makeProject({ montagePlan: undefined }))

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))
    await user.click(screen.getByRole('button', { name: 'Собрать черновик' }))

    await waitFor(() => {
      expect(assembleDraftMock).toHaveBeenCalledWith('project-1')
    })

    expect(screen.getByText('Черновик собран')).toBeInTheDocument()
    expect(screen.getByText('Черновик собран автоматически по визуальной пригодности. Откройте его в редакторе, чтобы доработать клипы и продолжить сборку проекта.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть в редакторе' })).toBeInTheDocument()
    expect(screen.getByText('4 смысловых блока')).toBeInTheDocument()
    expect(screen.getByText('6 клипов')).toBeInTheDocument()
    expect(screen.getByText('Прямые')).toBeInTheDocument()
    expect(screen.getByText('2 прямых блока')).toBeInTheDocument()
    expect(screen.getByText('Визуальные')).toBeInTheDocument()
    expect(screen.getByText('1 визуальный блок')).toBeInTheDocument()
    expect(screen.getByText('Атмосферные')).toBeInTheDocument()
    expect(screen.getByText('1 атмосферный блок')).toBeInTheDocument()
    expect(screen.getByText('Требуют внимания')).toBeInTheDocument()
    expect(screen.getByText('0 блоков требуют внимания')).toBeInTheDocument()
  })

  it('does not show the editor CTA before a semantic draft exists', async () => {
    const user = userEvent.setup()
    renderMontage(makeProject({ montagePlan: undefined }))

    await user.click(screen.getByRole('button', { name: 'План монтажа' }))

    expect(screen.queryByRole('button', { name: 'Открыть в редакторе' })).not.toBeInTheDocument()
    expect(screen.queryByText('Черновик готов для редактора')).not.toBeInTheDocument()
  })

  it('saves manual shot and moment overrides for weak matches', async () => {
    const user = userEvent.setup()
    const updateAnchorMatchesMock = vi.mocked(api.montage.updateAnchorMatches)
    updateAnchorMatchesMock.mockResolvedValue({
      anchorMatches: [
        {
          anchorId: 'anchor-1',
          selectedShotId: 'shot-2',
          selectedMomentId: 'moment-terrace',
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
    await user.click(screen.getByRole('button', { name: 'Ручной режим' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Выбор шота для якоря Терраса' }), 'shot-2')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Выбор момента для якоря Терраса' }), 'moment-terrace')
    await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))

    await waitFor(() => {
      expect(updateAnchorMatchesMock).toHaveBeenCalledWith('project-1', [
        expect.objectContaining({
          anchorId: 'anchor-1',
          selectedShotId: 'shot-2',
          selectedMomentId: 'moment-terrace',
          status: 'matched',
        }),
      ])
    })
  })

  it('requests and renders temporary voice preview in the voiceover step', async () => {
    const user = userEvent.setup()
    const previewVoiceMock = vi.mocked(api.montage.previewVoice)
    const { container } = renderMontage(makeProject())

    const previewButton = await screen.findByRole('button', { name: 'Прослушать голос' })
    await user.click(previewButton)

    await waitFor(() => {
      expect(previewVoiceMock).toHaveBeenCalledWith('project-1', { provider: 'kokoro', voiceId: 'af_heart' })
    })

    await waitFor(() => {
      const previewAudio = container.querySelector('audio[src="/voice-preview?ts=1"]')
      expect(previewAudio).not.toBeNull()
    })
  })

  it('renders editor-first export step without legacy render buttons', async () => {
    const user = userEvent.setup()
    renderMontage(makeProject({
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-anchor-1',
            shotId: 'shot-1',
            clipFile: 'montage/normalized/shot-1.mp4',
            startSec: 0,
            durationSec: 4,
          },
        ],
        transitions: [],
        motionGraphics: {
          lowerThirds: [],
        },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#1a1a2e',
          secondaryColor: '#e2b44d',
          textColor: '#ffffff',
        },
      },
      latestExportArtifact: {
        filename: 'final-cut.mp4',
        exportedAt: '2026-03-27T10:00:00.000Z',
      },
      renders: [
        {
          id: 'openreel-render-1',
          createdAt: '2026-03-27T10:00:00.000Z',
          quality: 'final',
          resolution: '3840x2160',
          status: 'done',
          progress: 100,
          outputFile: 'openreel/exports/123-final-cut.mp4',
        },
      ],
    }))

    await user.click(screen.getByRole('button', { name: 'Рендер' }))

    expect(screen.getByText('Финальная сборка через OpenReel Export')).toBeInTheDocument()
    expect(screen.getByText(/откройте проект в редакторе/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть в редакторе' })).toBeInTheDocument()
    expect(screen.getByText('Последний экспорт')).toBeInTheDocument()
    expect(screen.getByText(/final-cut\.mp4/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Превью (720p)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Финальный (4K)' })).not.toBeInTheDocument()
  })
})
