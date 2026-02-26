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

// Mock tts-providers to avoid real API calls
vi.mock('../../server/lib/tts-providers.js', () => ({
  getAvailableProviders: vi.fn().mockResolvedValue([
    { id: 'kokoro', name: 'Kokoro (fal.ai)', configured: true },
    { id: 'elevenlabs', name: 'ElevenLabs', configured: true },
  ]),
  getVoices: vi.fn().mockReturnValue([
    { id: 'af_heart', name: 'Heart', gender: 'female', language: 'en-US', provider: 'kokoro' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  ]),
  generateSpeech: vi.fn().mockResolvedValue({
    audioBuffer: Buffer.from('fake-tts-audio'),
    contentType: 'audio/mpeg',
    provider: 'elevenlabs',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
  }),
}))

// Mock global fetch (kept for any remaining direct fetch calls)
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
    it('should generate voiceover audio via TTS provider when approved', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст для озвучки.'
        proj.voiceoverScriptApproved = true
      })

      const { generateSpeech } = await import('../../server/lib/tts-providers.js')
      vi.mocked(generateSpeech).mockResolvedValueOnce({
        audioBuffer: Buffer.from('fake-audio-data'),
        contentType: 'audio/mpeg',
        provider: 'kokoro' as any,
        voiceId: 'af_heart',
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .send({ provider: 'kokoro', voiceId: 'af_heart' })
        .expect(200)

      expect(res.body).toHaveProperty('voiceoverFile')
      expect(res.body.voiceoverFile).toBe('montage/voiceover.mp3')
      expect(res.body.provider).toBe('kokoro')
      expect(res.body.voiceId).toBe('af_heart')

      // Verify generateSpeech was called correctly
      expect(generateSpeech).toHaveBeenCalledWith('Текст для озвучки.', 'kokoro', 'af_heart')

      // Verify project updated
      const updated = await getProject(projectId)
      expect(updated!.voiceoverFile).toBe('montage/voiceover.mp3')
      expect(updated!.voiceoverProvider).toBe('kokoro')
      expect(updated!.voiceoverVoiceId).toBe('af_heart')
    })

    it('should generate wav when Kokoro returns audio/wav', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'English text.'
        proj.voiceoverScriptApproved = true
      })

      const { generateSpeech } = await import('../../server/lib/tts-providers.js')
      vi.mocked(generateSpeech).mockResolvedValueOnce({
        audioBuffer: Buffer.from('fake-wav-data'),
        contentType: 'audio/wav',
        provider: 'kokoro' as any,
        voiceId: 'af_heart',
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .send({ provider: 'kokoro', voiceId: 'af_heart' })
        .expect(200)

      expect(res.body.voiceoverFile).toBe('montage/voiceover.wav')
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

    it('should return 400 if provider API key not configured', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Текст.'
        proj.voiceoverScriptApproved = true
        proj.voiceoverVoiceId = undefined as any
      })

      const { getAvailableProviders } = await import('../../server/lib/tts-providers.js')
      vi.mocked(getAvailableProviders).mockResolvedValueOnce([
        { id: 'kokoro', name: 'Kokoro (fal.ai)', configured: false },
        { id: 'elevenlabs', name: 'ElevenLabs', configured: false },
      ])

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .send({ provider: 'kokoro', voiceId: 'af_heart' })
        .expect(400)

      expect(res.body.error).toContain('API key')
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
