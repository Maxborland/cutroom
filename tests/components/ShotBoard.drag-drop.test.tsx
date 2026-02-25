import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ShotBoard } from '../../src/components/ShotBoard'
import { useProjectStore } from '../../src/stores/projectStore'

let capturedOnDragEnd: ((event: any) => void) | null = null

vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => {
    capturedOnDragEnd = onDragEnd
    return <div>{children}</div>
  },
  DragOverlay: ({ children }: any) => <div>{children}</div>,
  PointerSensor: function PointerSensor() {},
  useSensor: () => ({}),
  useSensors: () => [],
  pointerWithin: () => [],
  rectIntersection: () => [],
  useDroppable: () => ({ setNodeRef: () => {} }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('../../src/components/ShotCard', () => ({
  ShotCard: ({ shot }: any) => <div data-testid={`shot-${shot.id}`}>{shot.id}</div>,
}))

vi.mock('../../src/components/ShotDetail', () => ({
  ShotDetail: () => <div data-testid="shot-detail" />,
}))

const mockedUseStore = vi.mocked(useProjectStore)

describe('ShotBoard drag-and-drop actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnDragEnd = null
  })

  it('starts image generation when shot is moved to img_gen column', () => {
    const generateImage = vi.fn().mockResolvedValue(undefined)
    const generateVideo = vi.fn().mockResolvedValue(undefined)
    const updateShotStatus = vi.fn()

    const state = {
      activeProject: () => ({
        id: 'project-1',
        brief: { assets: [] },
        shots: [
          {
            id: 'shot-1',
            order: 0,
            status: 'draft',
            generatedImages: [],
          },
        ],
      }),
      activeShotId: null,
      setActiveShotId: vi.fn(),
      generateImage,
      generateVideo,
      cancelAllGeneration: vi.fn(),
      enhanceAll: vi.fn(),
      updateShotStatus,
      batchUpdateShotStatus: vi.fn(),
    }

    mockedUseStore.mockImplementation((selector: any) => selector(state))

    render(<ShotBoard />)

    expect(capturedOnDragEnd).toBeTypeOf('function')
    capturedOnDragEnd?.({
      active: { id: 'shot-1' },
      over: { id: 'column:img_gen' },
    })

    expect(generateImage).toHaveBeenCalledWith('shot-1')
    expect(updateShotStatus).not.toHaveBeenCalled()
  })

  it('uses status update for non-generation columns', () => {
    const generateImage = vi.fn().mockResolvedValue(undefined)
    const generateVideo = vi.fn().mockResolvedValue(undefined)
    const updateShotStatus = vi.fn()

    const state = {
      activeProject: () => ({
        id: 'project-1',
        brief: { assets: [] },
        shots: [
          {
            id: 'shot-1',
            order: 0,
            status: 'draft',
            generatedImages: [],
          },
        ],
      }),
      activeShotId: null,
      setActiveShotId: vi.fn(),
      generateImage,
      generateVideo,
      cancelAllGeneration: vi.fn(),
      enhanceAll: vi.fn(),
      updateShotStatus,
      batchUpdateShotStatus: vi.fn(),
    }

    mockedUseStore.mockImplementation((selector: any) => selector(state))

    render(<ShotBoard />)
    capturedOnDragEnd?.({
      active: { id: 'shot-1' },
      over: { id: 'column:img_review' },
    })

    expect(updateShotStatus).toHaveBeenCalledWith('project-1', 'shot-1', 'img_review')
    expect(generateImage).not.toHaveBeenCalled()
    expect(generateVideo).not.toHaveBeenCalled()
  })
})
