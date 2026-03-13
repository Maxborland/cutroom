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
  OpenReelHost: () => <div data-testid="openreel-host">HOST</div>,
}))

const getProjectMock = api.openreel.getProject as unknown as ReturnType<typeof vi.fn>
const saveProjectMock = api.openreel.saveProject as unknown as ReturnType<typeof vi.fn>

const mockBundle = {
  version: '1.0.0',
  project: { id: 'project-1', timeline: { tracks: [] } },
  mediaManifest: {},
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
})
