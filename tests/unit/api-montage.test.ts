import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/lib/api'

describe('api.montage contract', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ montagePlan: { version: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('updates a timeline entry by clipId', async () => {
    await api.montage.updateTimelineEntry('project-1', 'clip-anchor-2', {
      durationSec: 8,
      trimEndSec: 3.5,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/montage/plan/timeline/clip-anchor-2',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          durationSec: 8,
          trimEndSec: 3.5,
        }),
        credentials: 'include',
      }),
    )
  })
})
