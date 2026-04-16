import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportView } from '../../src/components/ExportView'
import { useProjectStore } from '../../src/stores/projectStore'

vi.mock('../../src/stores/projectStore', () => {
  const store: any = vi.fn()
  return { useProjectStore: store }
})

vi.mock('../../src/lib/api', () => ({
  api: {
    export: {
      zipUrl: vi.fn((projectId: string) => `/api/projects/${projectId}/export.zip`),
      promptsUrl: vi.fn((projectId: string) => `/api/projects/${projectId}/prompts.zip`),
    },
  },
}))

const mockedUseProjectStore = useProjectStore as any

describe('ExportView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUseProjectStore.mockImplementation((selector: any) =>
      selector({
        activeProject: () => ({
          id: 'project-1',
          shots: [
            {
              id: 'shot-1',
              order: 0,
              scene: 'Фасад',
              status: 'approved',
              generatedImages: ['frame.png'],
              enhancedImages: [],
              videoFile: 'clip.mp4',
            },
          ],
        }),
      }),
    )

    vi.stubGlobal('open', vi.fn())
  })

  it('describes the export zip as an external edit package', () => {
    render(<ExportView />)

    expect(
      screen.getByText(
        'ZIP содержит: финальные фото full-res, видео шотов, отдельные дорожки диктора и музыки, промпты (TXT) и metadata.json для внешнего монтажа',
      ),
    ).toBeInTheDocument()
  })

  it('opens the export zip url when the main export button is clicked', () => {
    render(<ExportView />)

    fireEvent.click(screen.getByText('Экспортировать ZIP'))

    expect(window.open).toHaveBeenCalledWith('/api/projects/project-1/export.zip')
  })

  it('shows image-only status for shots that only have enhanced images', () => {
    mockedUseProjectStore.mockImplementation((selector: any) =>
      selector({
        activeProject: () => ({
          id: 'project-1',
          shots: [
            {
              id: 'shot-1',
              order: 0,
              scene: 'Интерьер',
              status: 'approved',
              generatedImages: [],
              enhancedImages: ['final-enhanced.png'],
              videoFile: null,
            },
          ],
        }),
      }),
    )

    render(<ExportView />)

    expect(screen.getByText('только изображения')).toBeInTheDocument()
    expect(screen.queryByText('нет медиа')).not.toBeInTheDocument()
  })
})
