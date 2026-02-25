import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../integration/setup.js'
import {
  createProject,
  deleteProject,
  getProject,
  withProject,
  resolveProjectPath,
  ensureDir,
} from '../../server/lib/storage.js'

// Mock chatCompletion for LLM calls
vi.mock('../../server/lib/openrouter.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Cinematic piano with gentle strings, 120 BPM, building from soft to grand. Suitable for luxury real estate.'),
}))

import { chatCompletion } from '../../server/lib/openrouter.js'
const mockChatCompletion = vi.mocked(chatCompletion)

const app = createApp()

describe('Montage Music Pipeline', () => {
  let projectId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    // Ensure settings file has required keys
    const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
    await fs.writeFile(settingsPath, JSON.stringify({
      ...existingSettings,
      openRouterApiKey: 'test-openrouter-key',
      defaultMusicStyle: 'elegant piano with subtle strings',
    }, null, 2))

    const p = await createProject('Music Test Project')
    projectId = p.id
    await withProject(projectId, (proj) => {
      proj.script = 'Сцена 1: Дрон поднимается.\nСцена 2: Вид на город.'
      proj.brief.targetDuration = 60
      proj.stage = 'review'
    })
  })

  afterEach(async () => {
    try {
      await deleteProject(projectId)
    } catch {
      // ignore
    }
  })

  // ─── POST /montage/generate-music-prompt ────────────────────────────

  describe('POST /montage/generate-music-prompt', () => {
    it('should generate a music prompt via LLM and save to project', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music-prompt`)
        .expect(200)

      expect(res.body).toHaveProperty('musicPrompt')
      expect(typeof res.body.musicPrompt).toBe('string')
      expect(res.body.musicPrompt.length).toBeGreaterThan(0)

      // Verify LLM was called
      expect(mockChatCompletion).toHaveBeenCalledTimes(1)

      // Verify project updated
      const updated = await getProject(projectId)
      expect(updated!.musicPrompt).toBe(res.body.musicPrompt)
    })

    it('should use project script as context for prompt generation', async () => {
      await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music-prompt`)
        .expect(200)

      // Check that the user message sent to LLM contains the script
      const [, messages] = mockChatCompletion.mock.calls[0]
      const userMsg = messages.find((m: any) => m.role === 'user')
      expect(userMsg?.content).toContain('Дрон поднимается')
    })

    it('should return 400 if no OpenRouter API key', async () => {
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
      const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
      await fs.writeFile(settingsPath, JSON.stringify({
        ...existingSettings,
        openRouterApiKey: '',
      }, null, 2))

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music-prompt`)
        .expect(400)

      expect(res.body.error).toContain('OpenRouter')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/non-existent-project-id/montage/generate-music-prompt')
        .expect(404)
    })
  })

  // ─── POST /montage/upload-music ───────────────────────────────────

  describe('POST /montage/upload-music', () => {
    it('should upload an mp3 music file and save it', async () => {
      const fakeAudio = Buffer.from('fake-mp3-audio-data')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .attach('music', fakeAudio, { filename: 'background.mp3', contentType: 'audio/mpeg' })
        .expect(200)

      expect(res.body).toHaveProperty('musicFile')
      expect(res.body.musicFile).toMatch(/montage\/music\.mp3$/)
      expect(res.body).toHaveProperty('provider', 'manual')

      // Verify file saved
      const filePath = resolveProjectPath(projectId, res.body.musicFile)
      const stat = await fs.stat(filePath)
      expect(stat.isFile()).toBe(true)

      // Verify project updated
      const updated = await getProject(projectId)
      expect(updated!.musicFile).toMatch(/montage\/music\.mp3$/)
      expect(updated!.musicProvider).toBe('manual')
    })

    it('should upload a wav file', async () => {
      const fakeAudio = Buffer.from('fake-wav-data')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .attach('music', fakeAudio, { filename: 'track.wav', contentType: 'audio/wav' })
        .expect(200)

      expect(res.body.musicFile).toMatch(/montage\/music\.wav$/)
    })

    it('should reject non-audio files', async () => {
      const fakeImage = Buffer.from('fake-image-data')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .attach('music', fakeImage, { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 400 if no file is provided', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      const fakeAudio = Buffer.from('fake-audio')

      await request(app)
        .post('/api/projects/non-existent-project-id/montage/upload-music')
        .attach('music', fakeAudio, { filename: 'bg.mp3', contentType: 'audio/mpeg' })
        .expect(404)
    })
  })

  // ─── GET /montage/music ───────────────────────────────────────────

  describe('GET /montage/music', () => {
    it('should stream the music file with correct content type for mp3', async () => {
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      const musicPath = path.join(montageDir, 'music.mp3')
      await fs.writeFile(musicPath, Buffer.from('fake-mp3-data'))

      await withProject(projectId, (proj) => {
        proj.musicFile = 'montage/music.mp3'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(200)

      expect(res.headers['content-type']).toContain('audio/mpeg')
      expect(res.body).toBeTruthy()
    })

    it('should stream wav file with correct content type', async () => {
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      const musicPath = path.join(montageDir, 'music.wav')
      await fs.writeFile(musicPath, Buffer.from('fake-wav-data'))

      await withProject(projectId, (proj) => {
        proj.musicFile = 'montage/music.wav'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(200)

      expect(res.headers['content-type']).toContain('audio/wav')
    })

    it('should return 404 if no music file is set on project', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(404)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 if music file is set but does not exist on disk', async () => {
      await withProject(projectId, (proj) => {
        proj.musicFile = 'montage/music.mp3'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(404)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .get('/api/projects/non-existent-project-id/montage/music')
        .expect(404)
    })
  })

  // ─── PUT /montage/music-prompt ────────────────────────────────────

  describe('PUT /montage/music-prompt', () => {
    it('should save the music prompt and return updated project', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/music-prompt`)
        .send({ musicPrompt: 'Upbeat electronic music for modern apartments' })
        .expect(200)

      expect(res.body.musicPrompt).toBe('Upbeat electronic music for modern apartments')

      // Verify from storage
      const updated = await getProject(projectId)
      expect(updated!.musicPrompt).toBe('Upbeat electronic music for modern apartments')
    })

    it('should return 400 if musicPrompt is missing', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/music-prompt`)
        .send({})
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 400 if musicPrompt is not a string', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/music-prompt`)
        .send({ musicPrompt: 123 })
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .put('/api/projects/non-existent-project-id/montage/music-prompt')
        .send({ musicPrompt: 'Some prompt' })
        .expect(404)
    })
  })
})
