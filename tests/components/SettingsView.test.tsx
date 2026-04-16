import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/components/SettingsView'
import { api } from '../../src/lib/api'

vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      get: vi.fn().mockResolvedValue({
        openRouterApiKey: '••••1234',
        falApiKey: '••••fal',
        replicateApiToken: '••••rep',
        defaultTextModel: 'openai/gpt-4o',
        defaultDescribeModel: 'openai/gpt-4o',
        defaultScriptModel: 'openai/gpt-4o',
        defaultShotSplitModel: 'openai/gpt-4o',
        defaultReviewModel: 'openai/gpt-4o',
        defaultImageModel: 'openai/gpt-image-1',
        defaultEnhanceModel: 'openai/gpt-image-1',
        defaultImageGenModel: 'fal/flux-kontext-max',
        defaultImageNoRefGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
        defaultVideoGenModel: 'fal/minimax-hailuo',
        defaultAudioGenModel: 'fal/minimax/speech-02-hd',
        imageAspectRatio: '16:9',
        imageSize: 'auto',
        imageQuality: 'high',
        imageNoRefAspectRatio: '9:16',
        imageNoRefSize: 'auto',
        imageNoRefQuality: '4K',
        videoQuality: '1080P',
        enhanceSize: 'auto',
        enhanceQuality: 'high',
        enhanceAspectRatio: '1:1',
        masterPromptScriptwriter: 'System prompt',
        masterPromptShotSplitter: 'Splitter prompt',
        masterPromptEnhance: '',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    models: {
      list: vi.fn().mockResolvedValue({
        textModels: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        ],
        imageModels: [{ id: 'openai/gpt-image-1', name: 'GPT Image 1' }],
        imageGenModels: [
          { id: 'fal/flux-kontext-max', name: 'Flux Kontext Max' },
          {
            id: 'fal-endpoint:fal-ai/nano-banana-pro',
            name: 'Nano Banana Pro',
            imageResolutionSupport: 'explicit',
            imageResolutionOptions: ['1K', '2K', '4K'],
            imageAspectRatioSupport: 'explicit',
            imageAspectRatioOptions: ['1:1', '16:9', '9:16'],
          },
        ],
        videoGenModels: [
          { id: 'fal/kling-2.1-pro', name: 'Kling 2.1 Pro', videoQualitySupport: 'none' },
          {
            id: 'fal/minimax-hailuo',
            name: 'MiniMax Hailuo 02',
            videoQualitySupport: 'explicit',
            videoQualityOptions: ['768P', '1080P'],
            videoDurationSupport: 'explicit',
            videoDurationOptions: ['5s', '8s'],
          },
        ],
        audioGenModels: [{ id: 'fal/minimax/speech-02-hd', name: 'MiniMax Speech 02 HD' }],
      }),
    },
    users: {
      list: vi.fn().mockResolvedValue({
        users: [
          {
            id: 'user-owner',
            email: 'owner@example.com',
            name: 'Владелец',
            role: 'owner',
            createdAt: '2026-03-13T00:00:00.000Z',
          },
          {
            id: 'user-editor',
            email: 'editor@example.com',
            name: 'Монтажер',
            role: 'editor',
            createdAt: '2026-03-13T00:00:00.000Z',
          },
        ],
      }),
      invite: vi.fn().mockResolvedValue({
        invite: {
          token: 'team-invite-token',
          email: 'editor@example.com',
          role: 'editor',
          createdAt: '2026-03-13T00:00:00.000Z',
          inviteUrl: '/accept-invite/team-invite-token',
        },
      }),
    },
    system: {
      getLicense: vi.fn().mockResolvedValue({
        status: 'trial',
        trialDaysRemaining: 5,
        restrictedMode: false,
        lastCheckAt: '2026-03-13T10:00:00.000Z',
      }),
    },
  },
}))

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading spinner initially, then shows settings sections', async () => {
    const { container } = render(<SettingsView />)

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()

    await waitFor(() => {
      expect(container.querySelector('#api')).toBeTruthy()
    })

    expect(container.querySelector('#generation')).toBeTruthy()
    expect(container.querySelector('#quality')).toBeFalsy()
    expect(container.querySelector('#director')).toBeTruthy()
    expect(container.querySelector('#access')).toBeTruthy()
    expect(container.querySelector('#prompts')).toBeTruthy()
  })

  it('associates API key inputs with labels', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByLabelText(/openrouter api key/i)).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/fal\.ai api key/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/replicate api token/i)).toBeInTheDocument()
  })

  it('shows model dropdown values when models are loaded', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getAllByText('GPT-4o').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('GPT Image 1').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('calls api.settings.get on mount', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(api.settings.get).toHaveBeenCalledTimes(1)
    })
  })

  it('loads and shows license status details', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(api.system.getLicense).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText('Статус лицензии')).toBeInTheDocument()
    expect(screen.getByText('Пробный период')).toBeInTheDocument()
    expect(screen.getByText(/осталось 5 дн/i)).toBeInTheDocument()
  })

  it('loads and shows current team members', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(api.users.list).toHaveBeenCalledTimes(1)
    })

    expect(screen.getAllByText('Владелец').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('Монтажер')).toBeInTheDocument()
    expect(screen.getByText('editor@example.com')).toBeInTheDocument()
  })

  it('reloads models after saving settings', async () => {
    const { api } = await import('../../src/lib/api')
    const { container } = render(<SettingsView />)

    await waitFor(() => {
      expect(api.models.list).toHaveBeenCalledTimes(1)
    })

    const saveButtons = container.querySelectorAll('button.brutal-btn')
    expect(saveButtons.length).toBeGreaterThan(0)
    fireEvent.click(saveButtons[0]!)

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledTimes(1)
      expect(api.models.list).toHaveBeenCalledTimes(2)
    })

    expect(api.settings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultImageNoRefGenModel: expect.any(String),
        imageNoRefQuality: expect.any(String),
        imageNoRefAspectRatio: expect.any(String),
        videoQuality: expect.any(String),
        enhanceAspectRatio: expect.any(String),
      }),
    )
  })

  it('saves videoQuality as auto when model has no explicit quality support', async () => {
    vi.mocked(api.settings.get).mockResolvedValueOnce({
      defaultVideoGenModel: 'fal/kling-2.1-pro',
      videoQuality: 'high',
    })

    const { container } = render(<SettingsView />)
    await waitFor(() => {
      expect(api.models.list).toHaveBeenCalled()
    })

    const saveButtons = container.querySelectorAll('button.brutal-btn')
    fireEvent.click(saveButtons[0]!)

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalled()
    })

    const lastCall = vi.mocked(api.settings.update).mock.calls.at(-1)?.[0]
    expect(lastCall.videoQuality).toBe('auto')
  })

  it('does not label generic quality as guaranteed 4K', async () => {
    const { container } = render(<SettingsView />)

    await waitFor(() => {
      expect(container.querySelector('#video-quality')).toBeTruthy()
    })

    expect(screen.queryByText('High (4K)')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '768P' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1080P' })).toBeInTheDocument()
  })

  it('keeps video model controls inline without extra duration hints', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByLabelText(/качество видео/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/Поддерживаемые длительности модели:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/длительность шота будет автоматически приведена/i)).not.toBeInTheDocument()
  })

  it('renders provider-native image controls inline for the selected Fal model', async () => {
    vi.mocked(api.models.list).mockResolvedValueOnce({
      textModels: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }],
      imageModels: [{ id: 'openai/gpt-image-1', name: 'GPT Image 1' }],
      imageGenModels: [
        {
          id: 'fal-endpoint:fal-ai/nano-banana-pro',
          name: 'Nano Banana Pro',
          imageResolutionSupport: 'explicit',
          imageResolutionOptions: ['1K', '2K', '4K'],
          imageAspectRatioSupport: 'explicit',
          imageAspectRatioOptions: ['1:1', '16:9'],
        },
      ],
      videoGenModels: [
        { id: 'fal/kling-2.1-pro', name: 'Kling 2.1 Pro', videoQualitySupport: 'none' },
      ],
      audioGenModels: [{ id: 'fal/minimax/speech-02-hd', name: 'MiniMax Speech 02 HD' }],
    })
    vi.mocked(api.settings.get).mockResolvedValueOnce({
      defaultImageGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
      imageQuality: '4K',
      imageAspectRatio: '16:9',
    })

    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByLabelText(/разрешение генерации/i)).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/^соотношение сторон$/i)).toBeInTheDocument()
    expect(screen.queryByText(/Параметры для этой модели подтянуты прямо из схемы Fal API/i)).not.toBeInTheDocument()
  })

  it('renders media controls next to their model blocks instead of a separate quality section', async () => {
    const { container } = render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByLabelText(/модель генерации изображений/i)).toBeInTheDocument()
    })

    expect(container.querySelector('#quality')).toBeFalsy()
    expect(screen.getByLabelText(/размер генерации/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/размер без референса/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/соотношение сторон без референса/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/качество видео/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/размер enhance/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/соотношение сторон enhance/i)).toBeInTheDocument()
  })

  it('creates a teammate invite link from settings', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByLabelText('Email участника')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Email участника'), {
      target: { value: 'editor@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать приглашение' }))

    await waitFor(() => {
      expect(api.users.invite).toHaveBeenCalledWith('editor@example.com', 'editor')
    })

    expect(screen.getByDisplayValue(/accept-invite\/team-invite-token/)).toBeInTheDocument()
  })
})
