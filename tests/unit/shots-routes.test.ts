import { afterEach, describe, expect, it, vi } from 'vitest'

type RouterLayer = {
  route?: {
    path?: string
    methods?: Record<string, boolean>
    stack?: Array<{ handle: unknown }>
  }
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
})
