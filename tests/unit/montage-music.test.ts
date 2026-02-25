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

// Mock global fetch for Suno API
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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
      sunoApiKey: 'test-suno-key',
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

  // ─── POST /montage/generate-music ─────────────────────────────────

  describe('POST /montage/generate-music', () => {
    it('should generate music via Suno API and save file', async () => {
      await withProject(projectId, (proj) => {
        proj.musicPrompt = 'Epic cinematic music for real estate'
      })

      // Mock Suno generate call - returns clip data with audio_url
      const fakeAudioData = Buffer.from('fake-suno-audio-data')
      mockFetch
        // First call: Suno generate
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'suno-gen-123',
            clips: {
              'clip-abc': {
                id: 'clip-abc',
                audio_url: 'https://cdn.suno.ai/clip-abc.mp3',
                status: 'complete',
              },
            },
          }),
        })
        // Second call: download the audio URL
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => fakeAudioData.buffer.slice(
            fakeAudioData.byteOffset,
            fakeAudioData.byteOffset + fakeAudioData.byteLength,
          ),
        })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music`)
        .expect(200)

      expect(res.body).toHaveProperty('musicFile', 'montage/music.mp3')
      expect(res.body).toHaveProperty('provider', 'suno')

      // Verify Suno API was called with correct params
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const [sunoUrl, sunoOpts] = mockFetch.mock.calls[0]
      expect(sunoUrl).toBe('https://studio-api.suno.ai/api/external/generate/')
      expect(sunoOpts.method).toBe('POST')
      expect(sunoOpts.headers['Authorization']).toBe('Bearer test-suno-key')
      const sunoBody = JSON.parse(sunoOpts.body)
      expect(sunoBody.topic).toBe('Epic cinematic music for real estate')
      expect(sunoBody.make_instrumental).toBe(true)
      expect(sunoBody.mv).toBe('chirp-v4')

      // Verify audio file download
      const [downloadUrl] = mockFetch.mock.calls[1]
      expect(downloadUrl).toBe('https://cdn.suno.ai/clip-abc.mp3')

      // Verify file was saved
      const filePath = resolveProjectPath(projectId, 'montage', 'music.mp3')
      const stat = await fs.stat(filePath)
      expect(stat.isFile()).toBe(true)
      const content = await fs.readFile(filePath)
      expect(content.toString()).toBe('fake-suno-audio-data')

      // Verify project updated
      const updated = await getProject(projectId)
      expect(updated!.musicFile).toBe('montage/music.mp3')
      expect(updated!.musicProvider).toBe('suno')
    })

    it('should use default music prompt when project has no musicPrompt', async () => {
      // No musicPrompt set, so default should be used
      const fakeAudioData = Buffer.from('fake-audio')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'suno-gen-456',
            clips: {
              'clip-xyz': {
                id: 'clip-xyz',
                audio_url: 'https://cdn.suno.ai/clip-xyz.mp3',
                status: 'complete',
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => fakeAudioData.buffer.slice(
            fakeAudioData.byteOffset,
            fakeAudioData.byteOffset + fakeAudioData.byteLength,
          ),
        })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music`)
        .expect(200)

      expect(res.body.musicFile).toBe('montage/music.mp3')

      // Verify default prompt was used (should contain duration and style)
      const [, sunoOpts] = mockFetch.mock.calls[0]
      const sunoBody = JSON.parse(sunoOpts.body)
      expect(sunoBody.topic).toContain('60')
      expect(sunoBody.topic).toContain('elegant piano with subtle strings')
    })

    it('should poll Suno API when clips are not immediately complete', async () => {
      await withProject(projectId, (proj) => {
        proj.musicPrompt = 'Background music'
      })

      const fakeAudioData = Buffer.from('fake-audio')
      mockFetch
        // First call: Suno generate - status streaming (not ready)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'suno-gen-789',
            clips: {
              'clip-poll': {
                id: 'clip-poll',
                audio_url: '',
                status: 'submitted',
              },
            },
          }),
        })
        // Second call: poll - still not ready
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'clip-poll',
            audio_url: '',
            status: 'streaming',
          }),
        })
        // Third call: poll - complete
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'clip-poll',
            audio_url: 'https://cdn.suno.ai/clip-poll.mp3',
            status: 'complete',
          }),
        })
        // Fourth call: download
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => fakeAudioData.buffer.slice(
            fakeAudioData.byteOffset,
            fakeAudioData.byteOffset + fakeAudioData.byteLength,
          ),
        })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music`)
        .expect(200)

      expect(res.body.musicFile).toBe('montage/music.mp3')
      // Should have been: generate + 2 polls + 1 download = 4 fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('should return 400 if no Suno API key is configured', async () => {
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
      const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
      await fs.writeFile(settingsPath, JSON.stringify({
        ...existingSettings,
        sunoApiKey: '',
      }, null, 2))

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music`)
        .expect(400)

      expect(res.body.error).toContain('Suno')
      expect(res.body.error).toContain('upload')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/non-existent-project-id/montage/generate-music')
        .expect(404)
    })

    it('should return 500 if Suno API returns an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music`)
        .expect(500)

      expect(res.body.error).toBeTruthy()
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
