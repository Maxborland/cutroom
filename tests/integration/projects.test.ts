import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from './setup.js'
import { deleteProject, getProject, saveProject } from '../../server/lib/storage.js'

const app = createApp()

describe('Projects API', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    for (const id of createdIds) {
      try {
        await deleteProject(id)
      } catch {
        // ignore
      }
    }
    createdIds.length = 0
  })

  describe('POST /api/projects', () => {
    it('should create a project and return 201', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Test Project' })
        .expect(201)

      expect(res.body).toHaveProperty('id')
      expect(res.body.name).toBe('Test Project')
      expect(res.body.stage).toBe('brief')
      expect(res.body.brief).toEqual({ text: '', assets: [], targetDuration: 60 })
      expect(res.body.shots).toEqual([])
      expect(res.body).toHaveProperty('created')
      expect(res.body).toHaveProperty('updated')
      expect(res.body).toHaveProperty('settings')
      createdIds.push(res.body.id)
    })

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({})
        .expect(400)

      expect(res.body.error).toBe('name is required')
    })

    it('should return 400 with non-string name', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 123 })
        .expect(400)

      expect(res.body.error).toBe('name is required')
    })
  })

  describe('GET /api/projects', () => {
    it('should list projects', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'List Test' })
      createdIds.push(createRes.body.id)

      const res = await request(app)
        .get('/api/projects')
        .expect(200)

      expect(Array.isArray(res.body)).toBe(true)
      const found = res.body.find((p: { id: string }) => p.id === createRes.body.id)
      expect(found).toBeTruthy()
      expect(found.name).toBe('List Test')
    })
  })

  describe('GET /api/projects/:id', () => {
    it('should return a project by id', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Get Test' })
      createdIds.push(createRes.body.id)

      const res = await request(app)
        .get(`/api/projects/${createRes.body.id}`)
        .expect(200)

      expect(res.body.id).toBe(createRes.body.id)
      expect(res.body.name).toBe('Get Test')
    })

    it('should return 404 for non-existent project', async () => {
      const res = await request(app)
        .get('/api/projects/non-existent-id-12345')
        .expect(404)

      expect(res.body.error).toBe('Project not found')
    })
  })

  describe('PUT /api/projects/:id', () => {
    it('should update project fields', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Update Test' })
      createdIds.push(createRes.body.id)

      const res = await request(app)
        .put(`/api/projects/${createRes.body.id}`)
        .send({ name: 'Updated Name', stage: 'script' })
        .expect(200)

      expect(res.body.name).toBe('Updated Name')
      expect(res.body.stage).toBe('script')
    })

    it('should preserve id and created timestamp', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Preserve Test' })
      createdIds.push(createRes.body.id)

      const originalId = createRes.body.id
      const originalCreated = createRes.body.created

      const res = await request(app)
        .put(`/api/projects/${originalId}`)
        .send({ id: 'hacked-id', created: '2000-01-01T00:00:00.000Z', name: 'Changed' })
        .expect(200)

      expect(res.body.id).toBe(originalId)
      expect(res.body.created).toBe(originalCreated)
      expect(res.body.name).toBe('Changed')
    })

    it('should deep-merge settings', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Settings Merge Test' })
      createdIds.push(createRes.body.id)

      const originalModel = createRes.body.settings.model

      const res = await request(app)
        .put(`/api/projects/${createRes.body.id}`)
        .send({ settings: { temperature: 0.9 } })
        .expect(200)

      expect(res.body.settings.temperature).toBe(0.9)
      expect(res.body.settings.model).toBe(originalModel)
    })

    it('updates only brief asset labels without replacing asset metadata', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Asset Label Merge Test' })
        .expect(201)
      createdIds.push(createRes.body.id)

      const stored = await getProject(createRes.body.id)
      expect(stored).toBeTruthy()
      if (!stored) return

      stored.brief.assets = [
        {
          id: 'asset-1',
          filename: 'ref-1.png',
          label: 'Initial label',
          url: '/api/projects/p/assets/ref-1.png',
          uploadedAt: '2026-02-19T00:00:00.000Z',
        },
      ]
      await saveProject(stored)

      const res = await request(app)
        .put(`/api/projects/${createRes.body.id}`)
        .send({
          brief: {
            assets: [
              {
                id: 'asset-1',
                label: 'Updated label',
              },
            ],
          },
        })
        .expect(200)

      expect(res.body.brief.assets).toHaveLength(1)
      expect(res.body.brief.assets[0]).toEqual({
        id: 'asset-1',
        filename: 'ref-1.png',
        label: 'Updated label',
        url: '/api/projects/p/assets/ref-1.png',
        uploadedAt: '2026-02-19T00:00:00.000Z',
      })
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .put('/api/projects/non-existent-id-12345')
        .send({ name: 'Does Not Exist' })
        .expect(404)
    })
  })

  describe('DELETE /api/projects/:id', () => {
    it('should delete a project', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Delete Test' })
      const projectId = createRes.body.id

      await request(app)
        .delete(`/api/projects/${projectId}`)
        .expect(200)

      await request(app)
        .get(`/api/projects/${projectId}`)
        .expect(404)
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .delete('/api/projects/non-existent-id-12345')
        .expect(404)
    })
  })
})
