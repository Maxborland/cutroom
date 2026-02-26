/**
 * Integration tests for montage endpoints.
 * Tests the full HTTP flow with mocked external dependencies (LLM, TTS, render).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from './setup.js'
import {
  createProject,
  deleteProject,
  withProject,
  resolveProjectPath,
  ensureDir,
  type Project,
} from '../../server/lib/storage.js'

// Mock external dependencies
vi.mock('../../server/lib/openrouter.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Mocked LLM response'),
  generateImage: vi.fn(),
}))

vi.mock('../../server/lib/render-worker.js', () => ({
  startRender: vi.fn().mockResolvedValue('render-test-job-preview'),
  getRenderJob: vi.fn(),
  deleteRenderJob: vi.fn(),
}))

vi.mock('../../server/lib/normalize.js', () => ({
  normalizeClips: vi.fn().mockResolvedValue(new Map()),
  probeDuration: vi.fn().mockResolvedValue(30),
}))

vi.mock('../../server/lib/montage-plan.js', () => ({
  generateMontagePlan: vi.fn().mockReturnValue({
    version: 1,
    format: { width: 3840, height: 2160, fps: 30 },
    timeline: [{ shotId: 'shot-1', clipFile: 'montage/normalized/shot-1.mp4', startSec: 3, durationSec: 10 }],
    transitions: [],
    motionGraphics: { intro: { title: 'Test', durationSec: 3, animation: 'fade_in' }, lowerThirds: [], outro: { title: 'End', durationSec: 3, animation: 'fade_in' } },
    audio: { voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 }, music: { file: 'montage/music.mp3', gainDb: -12, duckingDb: -18, duckFadeMs: 300 } },
    style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#1a1a2e', secondaryColor: '#d4af37', textColor: '#ffffff' },
  }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const app = createApp()

describe('Montage Integration', () => {
  let projectId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    // Write test settings
    const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    const existing = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
    await fs.writeFile(settingsPath, JSON.stringify({
      ...existing,
      openRouterApiKey: 'test-key',
      elevenLabsApiKey: 'test-eleven-key',
    }, null, 2))

    const p = await createProject('Montage Integration Test')
    projectId = p.id
    await withProject(projectId, (proj) => {
      proj.script = 'Scene 1: Drone above. Scene 2: Lobby.'
      proj.brief.targetDuration = 30
      proj.stage = 'review'
      proj.shots = [
        {
          id: 'shot-1',
          order: 1,
          scene: 'exterior',
          audioDescription: 'Drone rises',
          imagePrompt: '',
          videoPrompt: '',
          duration: 5,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: null,
        },
      ]
    })
  })

  afterEach(async () => {
    try { await deleteProject(projectId) } catch { /* ignore */ }
  })

  // ─── Voiceover Script ─────────────────────────────────────────────

  describe('POST /montage/generate-vo-script', () => {
    it('returns 200 with generated voiceover script', async () => {
      const { chatCompletion } = await import('../../server/lib/openrouter.js')
      vi.mocked(chatCompletion).mockResolvedValueOnce('Narrator text here.')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-vo-script`)
        .expect(200)

      expect(res.body.voiceoverScript).toBe('Narrator text here.')
    })

    it('returns 400 when project has no script', async () => {
      await withProject(projectId, (proj) => { proj.script = '' })

      await request(app)
        .post(`/api/projects/${projectId}/montage/generate-vo-script`)
        .expect(400)
    })

    it('returns 404 for non-existent project', async () => {
      await request(app)
        .post('/api/projects/nonexistent/montage/generate-vo-script')
        .expect(404)
    })
  })

  describe('PUT /montage/vo-script', () => {
    it('updates voiceover script and resets approval', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScriptApproved = true
      })

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/vo-script`)
        .send({ voiceoverScript: 'Edited text' })
        .expect(200)

      expect(res.body.voiceoverScript).toBe('Edited text')
      expect(res.body.voiceoverScriptApproved).toBe(false)
    })

    it('returns 400 without voiceoverScript field', async () => {
      await request(app)
        .put(`/api/projects/${projectId}/montage/vo-script`)
        .send({})
        .expect(400)
    })
  })

  describe('POST /montage/approve-vo-script', () => {
    it('approves existing voiceover script', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Ready text'
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/approve-vo-script`)
        .expect(200)

      expect(res.body.approved).toBe(true)
    })

    it('returns 400 when no script exists', async () => {
      await request(app)
        .post(`/api/projects/${projectId}/montage/approve-vo-script`)
        .expect(400)
    })
  })

  // ─── Voiceover Audio ──────────────────────────────────────────────

  describe('POST /montage/generate-voiceover', () => {
    it('calls ElevenLabs and saves audio file', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Script for TTS'
        proj.voiceoverScriptApproved = true
      })

      const audioData = Buffer.from('fake-mp3-data')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)),
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(200)

      expect(res.body.voiceoverFile).toBe('montage/voiceover.mp3')
      expect(res.body.provider).toBe('elevenlabs')
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('returns 400 when script not approved', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Draft text'
        proj.voiceoverScriptApproved = false
      })

      await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(400)
    })

    it('returns 500 when ElevenLabs returns error', async () => {
      await withProject(projectId, (proj) => {
        proj.voiceoverScript = 'Script'
        proj.voiceoverScriptApproved = true
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-voiceover`)
        .expect(500)

      expect(res.body.error).toContain('ElevenLabs API error')
    })
  })

  describe('GET /montage/voiceover', () => {
    it('streams voiceover file', async () => {
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      await fs.writeFile(path.join(montageDir, 'voiceover.mp3'), 'audio-bytes')
      await withProject(projectId, (proj) => {
        proj.voiceoverFile = 'montage/voiceover.mp3'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/voiceover`)
        .expect(200)

      expect(res.headers['content-type']).toContain('audio/mpeg')
    })

    it('returns 404 when no voiceover exists', async () => {
      await request(app)
        .get(`/api/projects/${projectId}/montage/voiceover`)
        .expect(404)
    })
  })

  // ─── Music ────────────────────────────────────────────────────────

  describe('POST /montage/generate-music-prompt', () => {
    it('generates music prompt via LLM', async () => {
      const { chatCompletion } = await import('../../server/lib/openrouter.js')
      vi.mocked(chatCompletion).mockResolvedValueOnce('Cinematic piano, rising tempo...')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-music-prompt`)
        .expect(200)

      expect(res.body.musicPrompt).toBe('Cinematic piano, rising tempo...')
    })
  })

  describe('PUT /montage/music-prompt', () => {
    it('updates music prompt', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/music-prompt`)
        .send({ musicPrompt: 'Edited prompt' })
        .expect(200)

      expect(res.body.musicPrompt).toBe('Edited prompt')
    })

    it('returns 400 without musicPrompt', async () => {
      await request(app)
        .put(`/api/projects/${projectId}/montage/music-prompt`)
        .send({})
        .expect(400)
    })
  })

  describe('POST /montage/upload-music', () => {
    it('uploads music file', async () => {
      const audioBuf = Buffer.from('fake-audio-data')

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .attach('music', audioBuf, { filename: 'track.mp3', contentType: 'audio/mpeg' })
        .expect(200)

      expect(res.body.musicFile).toBe('montage/music.mp3')
      expect(res.body.provider).toBe('manual')
    })

    it('rejects non-audio file', async () => {
      const textBuf = Buffer.from('not audio')

      await request(app)
        .post(`/api/projects/${projectId}/montage/upload-music`)
        .attach('music', textBuf, { filename: 'file.txt', contentType: 'text/plain' })
        .expect(400)
    })
  })

  describe('GET /montage/music', () => {
    it('streams music file', async () => {
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      await fs.writeFile(path.join(montageDir, 'music.mp3'), 'music-bytes')
      await withProject(projectId, (proj) => {
        proj.musicFile = 'montage/music.mp3'
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(200)

      expect(res.headers['content-type']).toContain('audio/mpeg')
    })

    it('returns 404 when no music exists', async () => {
      await request(app)
        .get(`/api/projects/${projectId}/montage/music`)
        .expect(404)
    })
  })

  // ─── Montage Plan ─────────────────────────────────────────────────

  describe('POST /montage/generate-plan', () => {
    it('generates plan from approved shots', async () => {
      // Set up voiceover file for duration probing
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      await fs.writeFile(path.join(montageDir, 'voiceover.mp3'), 'audio')
      await withProject(projectId, (proj) => {
        proj.voiceoverFile = 'montage/voiceover.mp3'
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-plan`)
        .expect(200)

      expect(res.body.montagePlan).toBeDefined()
      expect(res.body.montagePlan.version).toBe(1)
      expect(res.body.montagePlan.timeline).toBeInstanceOf(Array)
    })

    it('returns 400 with no approved shots', async () => {
      await withProject(projectId, (proj) => {
        proj.shots = proj.shots.map(s => ({ ...s, status: 'draft' }))
      })

      await request(app)
        .post(`/api/projects/${projectId}/montage/generate-plan`)
        .expect(400)
    })
  })

  describe('PUT /montage/plan', () => {
    it('updates montage plan', async () => {
      const plan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: { voiceover: { file: '', gainDb: 0 }, music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 } },
        style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#000', secondaryColor: '#fff', textColor: '#fff' },
      }

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/plan`)
        .send({ montagePlan: plan })
        .expect(200)

      expect(res.body.montagePlan.version).toBe(1)
    })

    it('returns 400 with missing required fields', async () => {
      await request(app)
        .put(`/api/projects/${projectId}/montage/plan`)
        .send({ montagePlan: { version: 1 } })
        .expect(400)
    })
  })

  describe('POST /montage/refine-plan', () => {
    it('refines plan via LLM', async () => {
      const plan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: { voiceover: { file: '', gainDb: 0 }, music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 } },
        style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#000', secondaryColor: '#fff', textColor: '#fff' },
      }
      await withProject(projectId, (proj) => { proj.montagePlan = plan as any })

      const refined = { ...plan, version: 2 }
      const { chatCompletion } = await import('../../server/lib/openrouter.js')
      vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(refined))

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({ feedback: 'Make transitions shorter' })
        .expect(200)

      expect(res.body.montagePlan.version).toBe(2)
    })

    it('returns 400 when no plan exists', async () => {
      await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({ feedback: 'Fix it' })
        .expect(400)
    })

    it('returns 400 with empty feedback', async () => {
      await withProject(projectId, (proj) => {
        proj.montagePlan = { version: 1, format: {}, timeline: [], transitions: [], motionGraphics: { lowerThirds: [] }, audio: {}, style: {} } as any
      })

      await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({ feedback: '' })
        .expect(400)
    })
  })

  // ─── Render ───────────────────────────────────────────────────────

  describe('POST /montage/render', () => {
    it('starts a render job', async () => {
      await withProject(projectId, (proj) => {
        proj.montagePlan = {
          version: 1,
          format: { width: 3840, height: 2160, fps: 30 },
          timeline: [],
          transitions: [],
          motionGraphics: { lowerThirds: [] },
          audio: { voiceover: { file: '', gainDb: 0 }, music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 } },
          style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#000', secondaryColor: '#fff', textColor: '#fff' },
        } as any
      })

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({ quality: 'preview' })
        .expect(200)

      expect(res.body.jobId).toBe('render-test-job-preview')
      expect(res.body.status).toBe('queued')
      expect(res.body.quality).toBe('preview')
    })

    it('returns 400 when no plan exists', async () => {
      await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({ quality: 'preview' })
        .expect(400)
    })
  })

  describe('GET /montage/render/:jobId', () => {
    it('returns render job status', async () => {
      const { getRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(getRenderJob).mockResolvedValueOnce({
        id: 'job-1',
        createdAt: new Date().toISOString(),
        quality: 'preview',
        resolution: '1280x720',
        status: 'done',
        progress: 100,
        outputFile: 'montage/renders/job-1.mp4',
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/job-1`)
        .expect(200)

      expect(res.body.id).toBe('job-1')
      expect(res.body.status).toBe('done')
    })

    it('returns 404 for unknown job', async () => {
      const { getRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(getRenderJob).mockResolvedValueOnce(null)

      await request(app)
        .get(`/api/projects/${projectId}/montage/render/unknown`)
        .expect(404)
    })
  })

  describe('DELETE /montage/render/:jobId', () => {
    it('deletes a render job', async () => {
      const { deleteRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(deleteRenderJob).mockResolvedValueOnce(true)

      const res = await request(app)
        .delete(`/api/projects/${projectId}/montage/render/job-1`)
        .expect(200)

      expect(res.body.deleted).toBe(true)
    })

    it('returns 404 for unknown job', async () => {
      const { deleteRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(deleteRenderJob).mockResolvedValueOnce(false)

      await request(app)
        .delete(`/api/projects/${projectId}/montage/render/unknown`)
        .expect(404)
    })

    it('returns 409 when job is currently rendering', async () => {
      const { deleteRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(deleteRenderJob).mockRejectedValueOnce(
        new Error('Cannot delete a render job that is currently rendering')
      )

      const res = await request(app)
        .delete(`/api/projects/${projectId}/montage/render/active-job`)
        .expect(409)

      expect(res.body.error).toContain('currently rendering')
    })
  })

  describe('GET /montage/render/:jobId/download', () => {
    it('streams rendered video file', async () => {
      const { getRenderJob } = await import('../../server/lib/render-worker.js')
      const rendersDir = resolveProjectPath(projectId, 'montage', 'renders')
      await ensureDir(rendersDir)
      const videoContent = Buffer.from('fake-mp4-content')
      await fs.writeFile(path.join(rendersDir, 'job-1.mp4'), videoContent)

      vi.mocked(getRenderJob).mockResolvedValueOnce({
        id: 'job-1',
        createdAt: new Date().toISOString(),
        quality: 'preview',
        resolution: '1280x720',
        status: 'done',
        progress: 100,
        outputFile: 'montage/renders/job-1.mp4',
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/job-1/download`)
        .expect(200)

      expect(res.headers['content-type']).toContain('video/mp4')
      expect(Buffer.from(res.body).toString()).toBe('fake-mp4-content')
    })

    it('returns 400 when render not complete', async () => {
      const { getRenderJob } = await import('../../server/lib/render-worker.js')
      vi.mocked(getRenderJob).mockResolvedValueOnce({
        id: 'job-1',
        createdAt: new Date().toISOString(),
        quality: 'preview',
        resolution: '1280x720',
        status: 'rendering',
        progress: 50,
      })

      await request(app)
        .get(`/api/projects/${projectId}/montage/render/job-1/download`)
        .expect(400)
    })
  })
})
