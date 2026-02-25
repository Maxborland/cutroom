import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import path from 'node:path'
import { createApp } from './setup.js'
import { createProject, deleteProject, getProject, type Project } from '../../server/lib/storage.js'

vi.mock('../../server/lib/openrouter.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Mock asset label'),
}))

const app = createApp()

describe('Assets API', () => {
  let project: Project

  beforeAll(async () => {
    project = await createProject('Asset Test Project')
  })

  afterAll(async () => {
    await deleteProject(project.id)
  })

  describe('POST /api/projects/:id/assets', () => {
    it('should upload a file', async () => {
      const testFile = path.join(process.cwd(), 'public', 'vite.svg')

      const res = await request(app)
        .post(`/api/projects/${project.id}/assets`)
        .attach('files', testFile)
        .expect(201)

      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(1)
      expect(res.body[0]).toHaveProperty('id')
      expect(res.body[0].filename).toBe('vite.svg')
      expect(res.body[0]).toHaveProperty('url')
      expect(res.body[0]).toHaveProperty('uploadedAt')
    })

    it('should return 404 for non-existent project', async () => {
      const testFile = path.join(process.cwd(), 'public', 'vite.svg')

      await request(app)
        .post('/api/projects/non-existent-id/assets')
        .attach('files', testFile)
        .expect(404)
    })
  })

  describe('GET /api/projects/:id/assets/file/:filename', () => {
    it('should serve an uploaded file', async () => {
      const testFile = path.join(process.cwd(), 'public', 'vite.svg')

      // Upload first
      await request(app)
        .post(`/api/projects/${project.id}/assets`)
        .attach('files', testFile)

      const res = await request(app)
        .get(`/api/projects/${project.id}/assets/file/vite.svg`)
        .expect(200)

      expect(res.headers['content-type']).toMatch(/svg|xml|octet/)
    })

    it('should return 404 for non-existent file', async () => {
      await request(app)
        .get(`/api/projects/${project.id}/assets/file/nonexistent.png`)
        .expect(404)
    })
  })

  describe('Path traversal protection', () => {
    it('should reject path traversal attempts', async () => {
      const res = await request(app)
        .get(`/api/projects/${project.id}/assets/file/..%2F..%2F..%2Fetc%2Fpasswd`)

      // Should get 403 or 404, not 200
      expect([403, 404]).toContain(res.status)
    })
  })

  describe('DELETE /api/projects/:id/assets/:assetId', () => {
    it('should remove an asset', async () => {
      const testFile = path.join(process.cwd(), 'public', 'vite.svg')

      // Upload first
      const uploadRes = await request(app)
        .post(`/api/projects/${project.id}/assets`)
        .attach('files', testFile)

      const assetId = uploadRes.body[0].id

      const deleteRes = await request(app)
        .delete(`/api/projects/${project.id}/assets/${assetId}`)
        .expect(200)

      expect(deleteRes.body).toEqual({ ok: true })
    })

    it('should return 404 for non-existent asset', async () => {
      await request(app)
        .delete(`/api/projects/${project.id}/assets/non-existent-asset-id`)
        .expect(404)
    })
  })

  describe('POST /api/projects/:id/assets/describe-all', () => {
    it('describe-all persists labels and returns complete counters', async () => {
      const isolated = await createProject('Describe All Test Project')
      const testFile = path.join(process.cwd(), 'public', 'vite.svg')
      const { chatCompletion } = await import('../../server/lib/openrouter.js')
      vi.mocked(chatCompletion).mockClear()

      try {
        await request(app)
          .post(`/api/projects/${isolated.id}/assets`)
          .attach('files', testFile, 'angle-a_00000.svg')
          .attach('files', testFile, 'angle-a_00001.svg')
          .expect(201)

        const describeRes = await request(app)
          .post(`/api/projects/${isolated.id}/assets/describe-all`)
          .expect(200)

        expect(describeRes.body).toEqual({ described: 2, total: 2 })
        expect(chatCompletion).toHaveBeenCalledTimes(2)

        const stored = await getProject(isolated.id)
        expect(stored).toBeTruthy()
        if (!stored) return

        const labels = stored.brief.assets.map((asset) => asset.label)
        expect(labels).toEqual(['Mock asset label', 'Mock asset label'])
      } finally {
        await deleteProject(isolated.id)
      }
    })
  })
})
