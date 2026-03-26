import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OpenReelEditorPage } from '../../src/routes/OpenReelEditorPage'
import { api } from '../../src/lib/api'

vi.mock('../../src/lib/api', () => {
  class ApiRequestError extends Error {
    status: number

    constructor(message: string) {
      super(message)
      this.status = 500
    }
  }

  return {
    ApiRequestError,
    api: {
      openreel: {
        getProject: vi.fn(),
        saveProject: vi.fn(),
      },
    },
  }
})

vi.mock('../../src/components/openreel/OpenReelHost', () => ({
  OpenReelHost: ({
    onExportComplete,
  }: {
    onExportComplete?: (payload: { filename: string }) => void
  }) => (
    <div data-testid="openreel-host">
      HOST
      <button
        type="button"
        onClick={() => onExportComplete?.({ filename: 'final-cut.mp4' })}
      >
        Завершить экспорт
      </button>
    </div>
  ),
}))

const getProjectMock = api.openreel.getProject as unknown as ReturnType<typeof vi.fn>
const saveProjectMock = api.openreel.saveProject as unknown as ReturnType<typeof vi.fn>

const mockBundle = {
  version: '1.0.0',
  project: { id: 'project-1', timeline: { tracks: [] } },
  mediaManifest: {},
  semanticSummary: {
    anchors: 2,
    matched: 1,
    weak: 1,
    unmatched: 0,
  },
}

function renderEditorPage(initialPath = '/editor/project-1') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/editor/:projectId" element={<OpenReelEditorPage />} />
        <Route path="/projects/:projectId/montage" element={<div data-testid="montage-route">Монтаж</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OpenReelEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveProjectMock.mockResolvedValue({ saved: true, modifiedAt: Date.now() })
  })

  it('renders loading state while bundle is being fetched', () => {
    getProjectMock.mockReturnValue(new Promise(() => undefined))

    renderEditorPage()

    expect(screen.getByText('Загружаем редактор...')).toBeInTheDocument()
  })

  it('renders error state when fetching bundle fails', async () => {
    getProjectMock.mockRejectedValue(new Error('network failed'))

    renderEditorPage()

    await waitFor(() => {
      expect(screen.getByText('Ошибка загрузки редактора')).toBeInTheDocument()
    })
  })

  it('navigates back to project montage page via back button', async () => {
    getProjectMock.mockResolvedValue(mockBundle)
    const user = userEvent.setup()

    renderEditorPage()

    const backButton = await screen.findByRole('button', { name: '← Вернуться к проекту' })
    await user.click(backButton)

    await waitFor(() => {
      expect(screen.getByTestId('montage-route')).toBeInTheDocument()
    })
  })

  it('renders semantic summary from the bundle header when present', async () => {
    getProjectMock.mockResolvedValue(mockBundle)

    renderEditorPage()

    expect(await screen.findByText('Черновик из монтажного плана')).toBeInTheDocument()
    expect(screen.getByText('1 сильное, 1 требует проверки')).toBeInTheDocument()
    expect(screen.getByText('Откройте монтажный черновик в OpenReel, чтобы доработать клипы и синхронизировать правки с проектом.')).toBeInTheDocument()
  })

  it('renders the latest exported artifact when the bundle already knows it', async () => {
    getProjectMock.mockResolvedValue({
      ...mockBundle,
      exportArtifact: {
        filename: 'final-cut.mp4',
        exportedAt: Date.now(),
      },
    })

    renderEditorPage()

    expect(await screen.findByText('Последний экспорт из редактора')).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes('final-cut.mp4'))).toBeInTheDocument()
  })

  it('persists export completion back to CutRoom and keeps the artifact visible', async () => {
    getProjectMock.mockResolvedValue(mockBundle)
    saveProjectMock.mockResolvedValue({
      saved: true,
      modifiedAt: Date.now(),
      exportArtifact: {
        filename: 'final-cut.mp4',
        exportedAt: Date.now(),
      },
    })

    const user = userEvent.setup()

    renderEditorPage()

    const exportButton = await screen.findByRole('button', { name: 'Завершить экспорт' })
    await user.click(exportButton)

    await waitFor(() => {
      expect(saveProjectMock).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          version: '1.0.0',
          project: mockBundle.project,
          exportArtifact: expect.objectContaining({
            filename: 'final-cut.mp4',
          }),
        }),
      )
    })

    expect(await screen.findByText('Экспорт завершён и сохранён в проекте: final-cut.mp4')).toBeInTheDocument()
    expect(screen.getByText('Последний экспорт из редактора')).toBeInTheDocument()
  })
})
