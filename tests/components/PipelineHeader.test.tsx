import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineHeader } from '../../src/components/PipelineHeader'
import { useProjectStore } from '../../src/stores/projectStore'

vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}))

const mockedUseStore = vi.mocked(useProjectStore)

describe('PipelineHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const mockState = {
      activeProject: () => ({
        id: 'proj-1',
        name: 'Test',
        shots: [
          { id: '1', status: 'draft' },
          { id: '2', status: 'approved' },
          { id: '3', status: 'img_review' },
          { id: '4', status: 'vid_review' },
          { id: '5', status: 'img_gen' },
          { id: '6', status: 'vid_gen' },
        ],
      }),
      loading: false,
      generateScript: vi.fn(),
      splitShots: vi.fn(),
      generateImage: vi.fn(),
    }
    mockedUseStore.mockImplementation((selector: any) => selector(mockState))
  })

  it('renders with brief view - shows header text', () => {
    render(<PipelineHeader activeView="brief" />)

    expect(screen.getByText('Бриф')).toBeInTheDocument()
    expect(screen.getByText('Сгенерировать сценарий')).toBeInTheDocument()
  })

  it('renders with shots view - shows header text', () => {
    render(<PipelineHeader activeView="shots" />)

    expect(screen.getByText('Шоты')).toBeInTheDocument()
    expect(screen.getByText('Генерировать')).toBeInTheDocument()
  })

  it('shows shot statistics (count by status)', () => {
    render(<PipelineHeader activeView="shots" />)

    // The component renders 4 stat indicators: approved, review, generating, draft
    // With our mock data: approved=1, review=2, generating=2, draft=1
    const statElements = screen.getAllByText(/^[0-9]+$/, { selector: '.font-mono' })

    // Should have exactly 4 stat indicators
    expect(statElements).toHaveLength(4)

    // Extract the values and verify them
    const values = statElements.map((el) => el.textContent)
    // Order in PipelineHeader: approved, review, generating, draft
    expect(values).toEqual(['1', '2', '2', '1'])
  })
})
