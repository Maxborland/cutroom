import { afterEach, describe, expect, it, vi } from 'vitest'

type RouterLayer = {
  route?: {
    path?: string
    methods?: Record<string, boolean>
    stack?: Array<{ handle: unknown }>
  }
  handle?: unknown
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('../../server/lib/rate-limit.js')
})

describe('shots routes', () => {
  it('protects video upload route with the mutation limiter middleware', async () => {
    const mutationLimiter = vi.fn((_req, _res, next) => next())
    const readLimiter = vi.fn((_req, _res, next) => next())

    vi.doMock('../../server/lib/rate-limit.js', () => ({
      readLimiter,
      mutationLimiter,
    }))

    const router = (await import('../../server/routes/shots.js')).default as unknown as { stack: RouterLayer[] }
    const uploadRoute = router.stack.find((layer) => (
      layer.route?.path === '/:shotId/video'
      && layer.route.methods?.post
    ))

    expect(uploadRoute).toBeTruthy()
    expect(uploadRoute?.route?.stack?.some((layer) => layer.handle === mutationLimiter)).toBe(true)
  })

  it('maps multer size-limit errors to HTTP 413 instead of crashing', async () => {
    const router = (await import('../../server/routes/shots.js')).default as unknown as { stack: RouterLayer[] }
    const errorLayer = router.stack.at(-1)

    expect(typeof errorLayer?.handle).toBe('function')

    const sendApiError = vi.fn()
    const res = {}
    const next = vi.fn()

    vi.doMock('../../server/lib/api-error.js', () => ({
      sendApiError,
    }))

    const reloadedRouter = (await import('../../server/routes/shots.js?limit-error-test')).default as unknown as { stack: RouterLayer[] }
    const reloadedErrorLayer = reloadedRouter.stack.at(-1)

    expect(typeof reloadedErrorLayer?.handle).toBe('function')

    ;(reloadedErrorLayer?.handle as (err: unknown, req: unknown, res: unknown, next: (err?: unknown) => void) => void)(
      { code: 'LIMIT_FILE_SIZE' },
      {},
      res,
      next,
    )

    expect(sendApiError).toHaveBeenCalledWith(res, 413, 'Uploaded file is too large')
    expect(next).not.toHaveBeenCalled()
  })
})
