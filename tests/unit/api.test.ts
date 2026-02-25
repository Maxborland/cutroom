import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError, isApiRequestError } from '../../src/lib/api'

describe('api client error handling', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('throws ApiRequestError with status/code/details from structured JSON response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Invalid payload',
          code: 'VALIDATION_ERROR',
          details: { field: 'name' },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    try {
      await api.projects.create('')
      throw new Error('Expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(isApiRequestError(error)).toBe(true)
      if (!isApiRequestError(error)) return

      expect(error.message).toBe('Invalid payload')
      expect(error.status).toBe(422)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.details).toEqual({ field: 'name' })
      expect(error.path).toBe('/projects')
    }
  })

  it('falls back to plain text response message when JSON payload is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Gateway timeout from upstream provider', {
        status: 504,
        statusText: 'Gateway Timeout',
      }),
    )

    await expect(api.projects.list()).rejects.toMatchObject({
      message: 'Gateway timeout from upstream provider',
      status: 504,
      path: '/projects',
    })
  })

  it('uses the same structured error parser for multipart upload endpoints', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'No files uploaded', code: 'NO_FILES_UPLOADED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const file = new File(['abc'], 'ref.png', { type: 'image/png' })
    await expect(api.assets.upload('project-1', [file])).rejects.toMatchObject({
      message: 'No files uploaded',
      code: 'NO_FILES_UPLOADED',
      status: 400,
      path: '/projects/project-1/assets',
    })
  })
})

