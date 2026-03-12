import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './setup.js'
import {
  createProject,
  deleteProject,
  getProject,
  saveProject,
  type Project,
  type ShotMeta,
} from '../../server/lib/storage.js'

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

    it('rejects redirecting external video URLs for local caching', async () => {
      shot.videoFile = 'http://93.184.216.34/redirect.mp4'
      await saveProject(project)

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        url: 'http://93.184.216.34/redirect.mp4',
        headers: new Headers({ location: 'http://127.0.0.1/internal.mp4' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        const res = await request(app)
          .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
          .send({})
          .expect(400)

        expect(res.body.error).toContain('not allowed')
        expect(fetchMock).toHaveBeenCalledWith(
          'http://93.184.216.34/redirect.mp4',
          expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('POST /api/projects/:id/shots/:shotId/generate-video', () => {
    it('rolls back and does not persist a forbidden external fallback URL', async () => {
      const { generateVideoFromImage } = await import('../../server/lib/generation.js')
      const { getBestImageFile } = await import('../../server/lib/media-utils.js')
      vi.mocked(generateVideoFromImage).mockResolvedValueOnce('http://127.0.0.1/forbidden.mp4')
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
