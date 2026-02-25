import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../integration/setup.js'
import {
  createProject,
  deleteProject,
  getProject,
  saveProject,
  withProject,
  resolveProjectPath,
  ensureDir,
} from '../../server/lib/storage.js'

// Mock the openrouter chatCompletion so we don't hit a real API
vi.mock('../../server/lib/openrouter.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Мок-текст дикторской озвучки для премиальной недвижимости.'),
  generateImage: vi.fn(),
}))

// Mock global fetch for ElevenLabs
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const app = createApp()

describe('Montage Voiceover Pipeline', () => {
  let projectId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    // Ensure settings file has a fake API key for tests
    const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
    await fs.writeFile(settingsPath, JSON.stringify({
      ...existingSettings,
      openRouterApiKey: 'test-openrouter-key',
    }, null, 2))

    const p = await createProject('VO Test Project')
    projectId = p.id
    // Set up project with a script (needed for VO generation)
    await withProject(projectId, (proj) => {
      proj.script = 'Сцена 1: Дрон поднимается над комплексом.\nСцена 2: Камера входит в лобби.'
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

  // ─── POST /montage/generate-vo-script ─────────────────────────────

  describe('POST /montage/generate-vo-script', () => {
    it('should generate a voiceover script from the project script via LLM', async () => {
      const { chatCompletion } = await import('../../server/lib/openrouter.js')
      const mockChat = vi.mocked(chatCompletion)
      mockChat.mockResolvedValueOnce('Сгенерированный дикторский текст для ролика.')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-vo-script`)
        .expect(200)

      expect(res.body).toHaveProperty('voiceoverScript')
      expect(res.body.voiceoverScript).toBe('Сгенерированный дикторский текст для ролика.')

      // Verify LLM was called with system prompt and the project script
      expect(mockChat).toHaveBeenCalledOnce()
      const callArgs = mockChat.mock.calls[0]
      // callArgs[1] is messages array
      const messages = callArgs[1]
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('narrator')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('Сцена 1')

      // Verify project was updated
      const updated = await getProject(projectId)
      expect(updated!.voiceoverScript).toBe('Сгенерированный дикторский текст для ролика.')
      expect(updated!.voiceoverScriptApproved).toBe(false)
    })

    it('should return 400 if project has no script', async () => {
      await withProject(projectId, (proj) => {
        proj.script = ''
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-vo-script`)
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/non-existent-project-id/montage/generate-vo-script')
        .expect(404)
    })
  })

  // ─── PUT /montage/vo-script ───────────────────────────────────────

  describe('PUT /montage/vo-script', () => {
    it('should save the voiceover script and reset approval', async () => {
      // First set approval to true
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Old text'
        proj.voiceoverScriptApproved = true
      })

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/vo-script`)
        .send({ voiceoverScript: 'Новый текст дикторской озвучки.' })
        .expect(200)

      expect(res.body.voiceoverScript).toBe('Новый текст дикторской озвучки.')
      expect(res.body.voiceoverScriptApproved).toBe(false)

      // Verify from storage
      const updated = await getProject(projectId)
      expect(updated!.voiceoverScript).toBe('Новый текст дикторской озвучки.')
      expect(updated!.voiceoverScriptApproved).toBe(false)
    })

    it('should return 400 if voiceoverScript is missing from body', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/vo-script`)
        .send({})
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .put('/api/projects/non-existent-project-id/montage/vo-script')
        .send({ voiceoverScript: 'Text' })
        .expect(404)
    })
  })

  // ─── POST /montage/approve-vo-script ──────────────────────────────

  describe('POST /montage/approve-vo-script', () => {
    it('should approve the voiceover script', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст для одобрения.'
        proj.voiceoverScriptApproved = false
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/approve-vo-script`)
        .expect(200)

      expect(res.body).toEqual({ approved: true })

      const updated = await getProject(projectId)
      expect(updated!.voiceoverScriptApproved).toBe(true)
    })

    it('should return 400 if voiceoverScript is empty', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = ''
        proj.voiceoverScriptApproved = false
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/approve-vo-script`)
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 400 if voiceoverScript is missing', async () => {
      // voiceoverScript is undefined by default
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = undefined
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/approve-vo-script`)
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/non-existent-project-id/montage/approve-vo-script')
        .expect(404)
    })
  })

  // ─── POST /montage/generate-voiceover ─────────────────────────────

  describe('POST /montage/generate-voiceover', () => {
    it('should generate voiceover audio via ElevenLabs when approved', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст для озвучки.'
        proj.voiceoverScriptApproved = true
      })

      // Write a settings file with ElevenLabs key
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
      const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
      await fs.writeFile(settingsPath, JSON.stringify({
        ...existingSettings,
        elevenLabsApiKey: 'test-eleven-labs-key',
        defaultVoiceoverVoiceId: 'test-voice-id',
      }, null, 2))

      // Mock the fetch for ElevenLabs
      const audioBuffer = Buffer.from('fake-audio-data')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => audioBuffer.buffer.slice(
          audioBuffer.byteOffset,
          audioBuffer.byteOffset + audioBuffer.byteLength,
        ),
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(200)

      expect(res.body).toHaveProperty('voiceoverFile')
      expect(res.body.voiceoverFile).toBe('montage/voiceover.mp3')
      expect(res.body.provider).toBe('elevenlabs')

      // Verify fetch was called with correct ElevenLabs params
      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('https://api.elevenlabs.io/v1/text-to-speech/test-voice-id')
      expect(opts.method).toBe('POST')
      expect(opts.headers['xi-api-key']).toBe('test-eleven-labs-key')
      const body = JSON.parse(opts.body)
      expect(body.text).toBe('Текст для озвучки.')
      expect(body.model_id).toBe('eleven_multilingual_v2')

      // Verify file was saved
      const filePath = resolveProjectPath(projectId, 'montage', 'voiceover.mp3')
      const stat = await fs.stat(filePath)
      expect(stat.isFile()).toBe(true)

      // Verify project updated
      const updated = await getProject(projectId)
      expect(updated!.voiceoverFile).toBe('montage/voiceover.mp3')
      expect(updated!.voiceoverProvider).toBe('elevenlabs')
    })

    it('should return 400 if voiceover script not approved', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст.'
        proj.voiceoverScriptApproved = false
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(400)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 400 if no ElevenLabs API key configured', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст.'
        proj.voiceoverScriptApproved = true
      })

      // Overwrite settings with no ElevenLabs key
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
      const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
      await fs.writeFile(settingsPath, JSON.stringify({
        ...existingSettings,
        elevenLabsApiKey: '',
      }, null, 2))

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(400)

      expect(res.body.error).toContain('ElevenLabs')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/non-existent-project-id/montage/generate-voiceover')
        .expect(404)
    })
  })

  // ─── GET /montage/voiceover ───────────────────────────────────────

  describe('GET /montage/voiceover', () => {
    it('should stream the voiceover file with audio/mpeg content type', async () => {
      // Create voiceover file manually
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      const voPath = path.join(montageDir, 'voiceover.mp3')
      await fs.writeFile(voPath, Buffer.from('fake-mp3-data'))

      await withProject(projectId, (proj) => {
        proj.voiceoverFile = 'montage/voiceover.mp3'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/voiceover`)
        .expect(200)

      expect(res.headers['content-type']).toContain('audio/mpeg')
      expect(res.body).toBeTruthy()
    })

    it('should return 404 if voiceover file does not exist', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/voiceover`)
        .expect(404)

      expect(res.body.error).toBeTruthy()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .get('/api/projects/non-existent-project-id/montage/voiceover')
        .expect(404)
    })
  })
})
