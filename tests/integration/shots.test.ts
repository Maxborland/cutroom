import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { EventEmitter } from 'node:events'
import { createApp } from './setup.js'
import {
  createProject,
  deleteProject,
  getProject,
  saveProject,
  type Project,
  type ShotMeta,
} from '../../server/lib/storage.js'
import { safeLogValue } from '../../server/lib/safe-log.js'

vi.mock('../../server/lib/generation.js', () => ({
  generateVideoFromImage: vi.fn(),
}))

vi.mock('../../server/lib/media-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/lib/media-utils.js')>('../../server/lib/media-utils.js')
  return {
    ...actual,
    getBestImageFile: vi.fn((shot: ShotMeta) => shot.generatedImages.at(-1) ?? null),
  }
})

const app = createApp()

describe('Shots API', () => {
  let project: Project
  let shot: ShotMeta

  beforeEach(async () => {
    vi.clearAllMocks()
  })

  beforeAll(async () => {
    project = await createProject('Shots Test Project')

    shot = {
      id: 'shot-001',
      order: 0,
      scene: 'A cinematic aerial shot of a luxury building at sunset',
      audioDescription: '',
      imagePrompt: 'Initial image prompt',
      videoPrompt: 'Initial video prompt',
      duration: 5,
      assetRefs: [],
      status: 'draft',
      generatedImages: [],
      enhancedImages: [],
      selectedImage: null,
      videoFile: null,
    }
    project.shots = [shot]
    await saveProject(project)
  })

  afterAll(async () => {
    await deleteProject(project.id)
  })

  describe('PUT /api/projects/:id/shots/:shotId', () => {
    it('should update shot fields', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001`)
        .send({ scene: 'Updated scene', duration: 10 })
        .expect(200)

      expect(res.body.scene).toBe('Updated scene')
      expect(res.body.duration).toBe(10)
    })

    it('should preserve id and order', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001`)
        .send({ id: 'hacked-id', order: 999, scene: 'Another update' })
        .expect(200)

      expect(res.body.id).toBe('shot-001')
      expect(res.body.order).toBe(0)
      expect(res.body.scene).toBe('Another update')
    })

    it('ignores internal media metadata fields during generic shot updates', async () => {
      shot.generatedImages = ['safe-generated.png']
      shot.enhancedImages = ['safe-enhanced.png']
      shot.videoFile = 'safe-video.mp4'
      await saveProject(project)

      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001`)
        .send({
          scene: 'Safe update',
          generatedImages: ['../../../project.json'],
          enhancedImages: ['..\\..\\..\\secret.png'],
          videoFile: '../../../secret.mp4',
        })
        .expect(200)

      expect(res.body.scene).toBe('Safe update')
      expect(res.body.generatedImages).toEqual(['safe-generated.png'])
      expect(res.body.enhancedImages).toEqual(['safe-enhanced.png'])
      expect(res.body.videoFile).toBe('safe-video.mp4')

      const saved = await getProject(project.id)
      expect(saved?.shots[0]?.generatedImages).toEqual(['safe-generated.png'])
      expect(saved?.shots[0]?.enhancedImages).toEqual(['safe-enhanced.png'])
      expect(saved?.shots[0]?.videoFile).toBe('safe-video.mp4')
    })

    it('should return 404 for non-existent shot', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/non-existent-shot`)
        .send({ scene: 'Will not work' })
        .expect(404)

      expect(res.body.error).toBe('Shot not found')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .put('/api/projects/fake-project-id/shots/shot-001')
        .send({ scene: 'Will not work' })
        .expect(404)
    })
  })

  describe('PUT /api/projects/:id/shots/:shotId/status', () => {
    it('should change shot status', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001/status`)
        .send({ status: 'approved' })
        .expect(200)

      expect(res.body.status).toBe('approved')
    })

    it('should return 404 for non-existent shot', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/non-existent-shot/status`)
        .send({ status: 'approved' })
        .expect(404)

      expect(res.body.error).toBe('Shot not found')
    })

    it('should return 400 for missing status body', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001/status`)
        .send({})
        .expect(400)

      expect(res.body.error).toBe('status is required')
    })

    it('should return 400 for non-string status', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001/status`)
        .send({ status: 123 })
        .expect(400)

      expect(res.body.error).toBe('status is required')
    })
  })

  describe('PUT /api/projects/:id/shots/batch-status', () => {
    it('rejects batch-status when shotIds is empty', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/batch-status`)
        .send({ shotIds: [], status: 'draft' })
        .expect(400)

      expect(res.body.error).toBe('shotIds array is required')
    })
  })

  describe('DELETE /api/projects/:id/shots/:shotId/video', () => {
    it('deletes external video url without filesystem access errors', async () => {
      shot.videoFile = 'https://cdn.example.com/video.mp4'
      await saveProject(project)

      const res = await request(app)
        .delete(`/api/projects/${project.id}/shots/${shot.id}/video`)
        .expect(200)

      expect(res.body.videoFile).toBeNull()

      const saved = await getProject(project.id)
      expect(saved?.shots[0]?.videoFile).toBeNull()
    })
  })

  describe('POST /api/projects/:id/shots/:shotId/cache-video', () => {
    it('rejects loopback video URLs before attempting a fetch', async () => {
      shot.videoFile = 'http://127.0.0.1/internal.mp4'
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(res.body.error).toContain('not allowed')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('rejects IPv4-mapped IPv6 loopback URLs before attempting a fetch', async () => {
      shot.videoFile = 'http://[::ffff:127.0.0.1]/mapped-loopback.mp4'
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(res.body.error).toContain('not allowed')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('rejects non-global carrier-grade NAT video URLs before attempting a fetch', async () => {
      shot.videoFile = 'http://100.64.0.1/carrier-nat.mp4'
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(res.body.error).toContain('not allowed')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('rejects non-global IPv6 multicast video URLs before attempting a fetch', async () => {
      shot.videoFile = 'http://[ff02::1]/multicast.mp4'
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(res.body.error).toContain('not allowed')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('follows safe public redirects and blocks non-global redirect targets hop-by-hop', async () => {
      const requestMock = vi.fn((options: any, handler: (response: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
        const isPublicRedirectStart = options.path === '/redirect-start.mp4'
        const isPrivateRedirectStart = options.path === '/redirect-private.mp4'
        response.statusCode = (isPublicRedirectStart || isPrivateRedirectStart) ? 302 : 200
        response.headers = isPublicRedirectStart
          ? { location: 'http://downloads.example.test/final.mp4?token=abc123' }
          : isPrivateRedirectStart
            ? { location: 'http://100.64.0.1/internal.mp4' }
            : {}

        queueMicrotask(() => {
          handler(response)
          if (!isPublicRedirectStart && !isPrivateRedirectStart) {
            response.emit('data', Buffer.from('video-bytes'))
          }
          response.emit('end')
        })

        const req = new EventEmitter() as EventEmitter & {
          setTimeout: (timeout: number, listener?: () => void) => void
          end: () => void
          destroy: (error?: Error) => void
        }
        req.setTimeout = vi.fn()
        req.end = vi.fn()
        req.destroy = vi.fn((error?: Error) => {
          if (error) {
            req.emit('error', error)
          }
        })
        return req
      })

      try {
        vi.resetModules()
        vi.doMock('node:dns/promises', () => ({
          default: {},
          lookup: vi.fn((hostname: string) => {
            if (hostname === 'cdn.example.test') {
              return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
            }
            if (hostname === 'downloads.example.test') {
              return Promise.resolve([{ address: '93.184.216.35', family: 4 }])
            }
            return Promise.resolve([{ address: '93.184.216.36', family: 4 }])
          }),
        }))
        vi.doMock('node:http', () => ({ default: {}, request: requestMock }))
        vi.doMock('node:https', () => ({ default: {}, request: requestMock }))

        const { createApp: createIsolatedApp } = await import('./setup.js')
        const isolatedApp = createIsolatedApp()

        shot.videoFile = 'http://cdn.example.test/redirect-start.mp4'
        await saveProject(project)

        const res = await request(isolatedApp)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(200)

        expect(requestMock).toHaveBeenCalledTimes(2)
        expect(requestMock).toHaveBeenCalledWith(
          expect.objectContaining({
            hostname: '93.184.216.34',
            path: '/redirect-start.mp4',
            headers: expect.objectContaining({
              Host: 'cdn.example.test',
            }),
          }),
          expect.any(Function),
        )
        expect(requestMock).toHaveBeenCalledWith(
          expect.objectContaining({
            hostname: '93.184.216.35',
            path: '/final.mp4?token=abc123',
            headers: expect.objectContaining({
              Host: 'downloads.example.test',
            }),
          }),
          expect.any(Function),
        )
        expect(res.body.filename).toMatch(/^vid_\d+\.mp4$/)

        const saved = await getProject(project.id)
        expect(saved?.shots[0]?.videoFile).toMatch(/^vid_\d+\.mp4$/)

        shot.videoFile = 'http://cdn.example.test/redirect-private.mp4'
        await saveProject(project)

        const blocked = await request(isolatedApp)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(blocked.body.error).toContain('not allowed')
        expect(requestMock).toHaveBeenCalledTimes(3)
        expect(requestMock).toHaveBeenLastCalledWith(
          expect.objectContaining({
            hostname: '93.184.216.34',
            path: '/redirect-private.mp4',
          }),
          expect.any(Function),
        )
      } finally {
        vi.doUnmock('node:dns/promises')
        vi.doUnmock('node:http')
        vi.doUnmock('node:https')
        vi.resetModules()
      }
    })
  })

  describe('POST /api/projects/:id/shots/:shotId/generate-video', () => {
    it('sanitizes shot ids before logging local download fallback failures', async () => {
      const { generateVideoFromImage } = await import('../../server/lib/generation.js')
      const { getBestImageFile } = await import('../../server/lib/media-utils.js')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const unsafeShotId = 'shot-001\nforged-log'

      vi.mocked(generateVideoFromImage).mockResolvedValueOnce('https://videos.example.test/fallback.mp4')
      vi.mocked(getBestImageFile).mockReturnValueOnce('https://images.example.test/seed.png')

      project.shots = [
        {
          ...shot,
          generatedImages: [],
          status: 'draft',
          videoFile: null,
        },
        {
          ...shot,
          id: unsafeShotId,
          generatedImages: ['seed.png'],
          status: 'img_review',
          videoFile: null,
        },
      ]
      await saveProject(project)

      const fetchMock = vi.fn().mockRejectedValue(new Error('download failed'))
      vi.stubGlobal('fetch', fetchMock)

      try {
        await request(app)
          .post(`/api/projects/${project.id}/shots/${encodeURIComponent(unsafeShotId)}/generate-video`)
          .send({})
          .expect(200)

        const fallbackCall = warnSpy.mock.calls.find((call) => String(call[0] ?? '').includes('[generate-video] Local download failed'))
        expect(fallbackCall).toBeTruthy()
        if (!fallbackCall) return

        expect(String(fallbackCall[0] ?? '')).not.toContain('\n')
        expect(fallbackCall[1]).toBe(safeLogValue(unsafeShotId))
      } finally {
        project.shots = [shot]
        await saveProject(project)
        vi.unstubAllGlobals()
      }
    })

    it('rolls back and does not persist a forbidden external fallback URL', async () => {
      const { generateVideoFromImage } = await import('../../server/lib/generation.js')
      const { getBestImageFile } = await import('../../server/lib/media-utils.js')
      vi.mocked(generateVideoFromImage).mockResolvedValueOnce('http://[::ffff:127.0.0.1]/forbidden.mp4')
      vi.mocked(getBestImageFile).mockReturnValueOnce('https://images.example.test/seed.png')

      shot.status = 'img_review'
      shot.generatedImages = ['seed.png']
      shot.videoFile = null
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/generate-video`)
          .send({})
          .expect(400)

        expect(res.body.code).toBe('VIDEO_CACHE_URL_FORBIDDEN')
        expect(fetchMock).not.toHaveBeenCalled()

        const saved = await getProject(project.id)
        expect(saved?.shots[0]?.status).toBe('img_review')
        expect(saved?.shots[0]?.videoFile).toBeNull()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('POST /api/projects/:id/generate-all-videos', () => {
    it('does not persist forbidden external fallback URLs in batch generation', async () => {
      const { generateVideoFromImage } = await import('../../server/lib/generation.js')
      const { getBestImageFile } = await import('../../server/lib/media-utils.js')
      vi.mocked(generateVideoFromImage).mockResolvedValueOnce('http://127.0.0.1/batch-forbidden.mp4')
      vi.mocked(getBestImageFile).mockReturnValueOnce('https://images.example.test/seed.png')

      shot.status = 'img_review'
      shot.generatedImages = ['seed.png']
      shot.videoFile = null
      await saveProject(project)

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/generate-all-videos`)
          .send({})
          .expect(200)

        expect(res.body.generated).toBe(0)
        expect(res.body.total).toBe(1)
        expect(fetchMock).not.toHaveBeenCalled()

        const saved = await getProject(project.id)
        expect(saved?.shots[0]?.status).toBe('img_review')
        expect(saved?.shots[0]?.videoFile).toBeNull()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
