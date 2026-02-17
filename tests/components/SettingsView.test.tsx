import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/components/SettingsView'

vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      get: vi.fn().mockResolvedValue({
        openRouterApiKey: '••••1234',
        defaultTextModel: 'openai/gpt-4o',
        defaultImageModel: 'openai/gpt-image-1',
        masterPromptScriptwriter: 'System prompt',
        masterPromptShotSplitter: 'Splitter prompt',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    models: {
      list: vi.fn().mockResolvedValue({
        textModels: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        ],
        imageModels: [
          { id: 'openai/gpt-image-1', name: 'GPT Image 1' },
        ],
        higgsfieldImageModels: [
          { id: 'flux-pro/kontext/max/text-to-image', name: 'Flux Kontext Max' },
        ],
        higgsfieldVideoModels: [
          { id: '/v1/image2video/dop', name: 'DOP Turbo' },
        ],
      }),
    },
  },
}))

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading spinner initially, then shows content', async () => {
    const { container } = render(<SettingsView />)

    // Initially should show a spinner (Loader2 renders an svg with animate-spin class)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()

    // After loading completes, the spinner should disappear and content should show
    await waitFor(() => {
      expect(screen.getByText('OpenRouter API')).toBeInTheDocument()
    })
  })

  it('displays section headers', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('OpenRouter API')).toBeInTheDocument()
    })

    expect(screen.getByText('Higgsfield API')).toBeInTheDocument()
    expect(screen.getByText('Мастер-промпты')).toBeInTheDocument()
  })

  it('shows save button', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Сохранить настройки')).toBeInTheDocument()
    })
  })

  it('displays model dropdowns when models are loaded', async () => {
    render(<SettingsView />)

    // Wait for both settings and models to load
    await waitFor(() => {
      expect(screen.getByText('OpenRouter API')).toBeInTheDocument()
    })

    // The ModelSelect component displays the selected model name
    // GPT-4o is the selected text model, GPT Image 1 is the selected image model
    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('GPT Image 1')).toBeInTheDocument()
    })
  })

  it('calls api.settings.get on mount', async () => {
    const { api } = await import('../../src/lib/api')

    render(<SettingsView />)

    await waitFor(() => {
      expect(api.settings.get).toHaveBeenCalledTimes(1)
    })
  })
})
