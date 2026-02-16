import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from './setup.js'
import {
  createProject,
  deleteProject,
  saveProject,
  type Project,
  type ShotMeta,
} from '../../server/lib/storage.js'

const app = createApp()

describe('Shots API', () => {
  let project: Project
  let shot: ShotMeta

  beforeAll(async () => {
    project = await createProject('Shots Test Project')

    shot = {
      id: 'shot-001',
      order: 0,
      prompt: 'A cinematic aerial shot of a luxury building at sunset',
      durationSec: 5,
      status: 'draft',
      generatedImages: [],
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
        .send({ prompt: 'Updated prompt', durationSec: 10 })
        .expect(200)

      expect(res.body.prompt).toBe('Updated prompt')
      expect(res.body.durationSec).toBe(10)
    })

    it('should preserve id and order', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/shot-001`)
        .send({ id: 'hacked-id', order: 999, prompt: 'Another update' })
        .expect(200)

      expect(res.body.id).toBe('shot-001')
      expect(res.body.order).toBe(0)
      expect(res.body.prompt).toBe('Another update')
    })

    it('should return 404 for non-existent shot', async () => {
      const res = await request(app)
        .put(`/api/projects/${project.id}/shots/non-existent-shot`)
        .send({ prompt: 'Will not work' })
        .expect(404)

      expect(res.body.error).toBe('Shot not found')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .put('/api/projects/fake-project-id/shots/shot-001')
        .send({ prompt: 'Will not work' })
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
})
