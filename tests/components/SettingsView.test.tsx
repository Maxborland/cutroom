import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/components/SettingsView'

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
        defaultVideoGenModel: 'fal/minimax-hailuo',
        defaultAudioGenModel: 'fal/minimax/speech-02-hd',
        imageAspectRatio: '16:9',
        imageSize: 'auto',
        imageQuality: 'high',
        videoQuality: '1080P',
        enhanceSize: 'auto',
        enhanceQuality: 'high',
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
        imageGenModels: [{ id: 'fal/flux-kontext-max', name: 'Flux Kontext Max' }],
        videoGenModels: [
          { id: 'fal/kling-2.1-pro', name: 'Kling 2.1 Pro', videoQualitySupport: 'none' },
          {
            id: 'fal/minimax-hailuo',
            name: 'MiniMax Hailuo 02',
            videoQualitySupport: 'explicit',
            videoQualityOptions: ['768P', '1080P'],
          },
        ],
        audioGenModels: [{ id: 'fal/minimax/speech-02-hd', name: 'MiniMax Speech 02 HD' }],
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
    expect(container.querySelector('#quality')).toBeTruthy()
    expect(container.querySelector('#director')).toBeTruthy()
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
    const { api } = await import('../../src/lib/api')

    render(<SettingsView />)

    await waitFor(() => {
      expect(api.settings.get).toHaveBeenCalledTimes(1)
    })
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
        videoQuality: expect.any(String),
      }),
    )
  })

  it('saves videoQuality as auto when model has no explicit quality support', async () => {
    const { api } = await import('../../src/lib/api')
    ;(api.settings.get as any).mockResolvedValueOnce({
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

    const lastCall = (api.settings.update as any).mock.calls.at(-1)?.[0]
    expect(lastCall.videoQuality).toBe('auto')
  })

  it('does not label generic quality as guaranteed 4K', async () => {
    const { container } = render(<SettingsView />)

    await waitFor(() => {
      expect(container.querySelector('#video-quality')).toBeTruthy()
    })

    expect(screen.queryByText('High (4K)')).not.toBeInTheDocument()
    expect(screen.getByText(/4K/)).toBeInTheDocument()
  })
})
