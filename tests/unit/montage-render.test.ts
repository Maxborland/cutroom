import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../integration/setup.js'
import {
  createProject,
  deleteProject,
  withProject,
  resolveProjectPath,
  ensureDir,
  type Project,
  type ShotMeta,
  type MontagePlan,
} from '../../server/lib/storage.js'

// Mock render-worker to avoid actual Remotion rendering
vi.mock('../../server/lib/render-worker.js', () => ({
  startRender: vi.fn().mockResolvedValue('render-test-123-preview'),
  getRenderJob: vi.fn(),
  deleteRenderJob: vi.fn(),
}))

import { startRender, getRenderJob, deleteRenderJob } from '../../server/lib/render-worker.js'

const mockStartRender = startRender as unknown as Mock
const mockGetRenderJob = getRenderJob as unknown as Mock
const mockDeleteRenderJob = deleteRenderJob as unknown as Mock

const app = createApp()

// ── Helpers ──────────────────────────────────────────────────────────

function makeShot(overrides: Partial<ShotMeta> & { id: string; order: number }): ShotMeta {
  return {
    scene: 'Test scene',
    audioDescription: '',
    imagePrompt: 'test',
    videoPrompt: 'test',
    duration: 5,
    assetRefs: [],
    status: 'approved',
    generatedImages: [],
    enhancedImages: [],
    selectedImage: null,
    videoFile: null,
    ...overrides,
  }
}

function makePlan(): MontagePlan {
  return {
    version: 1,
    format: { width: 3840, height: 2160, fps: 30 },
    timeline: [
      { shotId: 'shot-001', clipFile: 'montage/normalized/shot-001.mp4', startSec: 3, durationSec: 10 },
    ],
    transitions: [
      { fromShotId: 'intro', toShotId: 'shot-001', type: 'fade', durationSec: 0.5 },
    ],
    motionGraphics: {
      intro: { title: 'Test Project', durationSec: 3, animation: 'fade_in' },
      lowerThirds: [],
      outro: { title: 'Test Project', durationSec: 4, animation: 'fade_in' },
    },
    audio: {
      voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
      music: { file: 'montage/music.mp3', gainDb: -18, duckingDb: -10, duckFadeMs: 500 },
    },
    style: {
      preset: 'premium',
      fontFamily: 'Montserrat',
      primaryColor: '#1a1a2e',
      secondaryColor: '#e2b44d',
      textColor: '#ffffff',
    },
  }
}

async function setupProject(plan?: MontagePlan): Promise<string> {
  const project = await createProject('Test Render Project')
  await withProject(project.id, (p) => {
    p.shots = [makeShot({ id: 'shot-001', order: 0 })]
    p.montagePlan = plan ?? null
    p.stage = plan ? 'montage_draft' : 'review'
  })
  return project.id
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Montage Render (Phase 5)', () => {
  const createdIds: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    for (const id of createdIds) {
      try { await deleteProject(id) } catch { /* ignore */ }
    }
    createdIds.length = 0
  })

  describe('POST /montage/render', () => {
    it('should return 400 if no montage plan exists', async () => {
      const projectId = await setupProject()
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({ quality: 'preview' })
        .expect(400)

      expect(res.body.error).toMatch(/plan/i)
    })

    it('should start a render job and return jobId', async () => {
      const plan = makePlan()
      const projectId = await setupProject(plan)
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({ quality: 'preview' })
        .expect(200)

      expect(res.body.jobId).toBe('render-test-123-preview')
      expect(res.body.status).toBe('queued')
      expect(res.body.quality).toBe('preview')
      expect(mockStartRender).toHaveBeenCalledWith(projectId, plan, 'preview')
    })

    it('should default to preview quality', async () => {
      const plan = makePlan()
      const projectId = await setupProject(plan)
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({})
        .expect(200)

      expect(res.body.quality).toBe('preview')
    })

    it('should accept final quality', async () => {
      const plan = makePlan()
      const projectId = await setupProject(plan)
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/render`)
        .send({ quality: 'final' })
        .expect(200)

      expect(res.body.quality).toBe('final')
      expect(mockStartRender).toHaveBeenCalledWith(projectId, plan, 'final')
    })
  })

  describe('GET /montage/render/:jobId', () => {
    it('should return 404 if job not found', async () => {
      const projectId = await setupProject(makePlan())
      createdIds.push(projectId)
      mockGetRenderJob.mockResolvedValueOnce(null)

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/nonexistent`)
        .expect(404)

      expect(res.body.error).toMatch(/not found/i)
    })

    it('should return job status', async () => {
      const projectId = await setupProject(makePlan())
      createdIds.push(projectId)

      mockGetRenderJob.mockResolvedValueOnce({
        id: 'render-test-123-preview',
        createdAt: '2026-02-26T08:00:00Z',
        quality: 'preview',
        resolution: '1280x720',
        status: 'rendering',
        progress: 45,
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/render-test-123-preview`)
        .expect(200)

      expect(res.body.status).toBe('rendering')
      expect(res.body.progress).toBe(45)
    })
  })

  describe('GET /montage/render/:jobId/download', () => {
    it('should return 400 if render not complete', async () => {
      const projectId = await setupProject(makePlan())
      createdIds.push(projectId)

      mockGetRenderJob.mockResolvedValueOnce({
        id: 'render-test-123-preview',
        status: 'rendering',
        progress: 50,
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/render-test-123-preview/download`)
        .expect(400)

      expect(res.body.error).toMatch(/not complete/i)
    })

    it('should stream file when render is done', async () => {
      const projectId = await setupProject(makePlan())
      createdIds.push(projectId)

      // Create a fake rendered file
      const renderDir = resolveProjectPath(projectId, 'montage', 'renders')
      await ensureDir(renderDir)
      await fs.writeFile(path.join(renderDir, 'render-done.mp4'), 'fake-video-data')

      mockGetRenderJob.mockResolvedValueOnce({
        id: 'render-done',
        status: 'done',
        outputFile: 'montage/renders/render-done.mp4',
      })

      const res = await request(app)
        .get(`/api/projects/${projectId}/montage/render/render-done/download`)
        .expect(200)

      expect(res.headers['content-type']).toContain('video/mp4')
      expect(res.body.toString()).toBe('fake-video-data')
    })
  })

  // ── Unit tests: plan-reader ────────────────────────────────────

  describe('plan-reader: resolvePlan()', () => {
    it('should convert seconds to frames correctly', async () => {
      const { resolvePlan } = await import('../../server/remotion/src/lib/plan-reader.js')
      const plan = makePlan()
      const resolved = resolvePlan(plan, '/data/projects/test-id')

      expect(resolved.fps).toBe(30)
      expect(resolved.width).toBe(3840)
      expect(resolved.height).toBe(2160)

      // Intro: 3s * 30fps = 90 frames
      expect(resolved.introFrames).toBe(90)
      // Outro: 4s * 30fps = 120 frames
      expect(resolved.outroFrames).toBe(120)

      // Clip: starts at 3s (90 frames), duration 10s (300 frames)
      expect(resolved.clips[0].startFrame).toBe(90)
      expect(resolved.clips[0].durationFrames).toBe(300)

      // Total: clip end (90+300=390) + outro (120) = 510 frames
      expect(resolved.totalDurationFrames).toBe(510)
    })

    it('should resolve file paths relative to project dir', async () => {
      const { resolvePlan } = await import('../../server/remotion/src/lib/plan-reader.js')
      const plan = makePlan()
      const resolved = resolvePlan(plan, '/data/projects/test-id')

      expect(resolved.clips[0].file).toBe('/data/projects/test-id/montage/normalized/shot-001.mp4')
      expect(resolved.voiceoverFile).toBe('/data/projects/test-id/montage/voiceover.mp3')
      expect(resolved.musicFile).toBe('/data/projects/test-id/montage/music.mp3')
    })

    it('should resolve transitions with frame-based positions', async () => {
      const { resolvePlan } = await import('../../server/remotion/src/lib/plan-reader.js')
      const plan = makePlan()
      const resolved = resolvePlan(plan, '/data/projects/test-id')

      expect(resolved.transitions).toHaveLength(1)
      expect(resolved.transitions[0].type).toBe('fade')
      expect(resolved.transitions[0].durationFrames).toBe(15) // 0.5s * 30fps
      expect(resolved.transitions[0].startFrame).toBe(90) // starts at clip start
    })

    it('should handle empty audio files gracefully', async () => {
      const { resolvePlan } = await import('../../server/remotion/src/lib/plan-reader.js')
      const plan = makePlan()
      plan.audio.voiceover.file = ''
      plan.audio.music.file = ''
      const resolved = resolvePlan(plan, '/data/projects/test-id')

      expect(resolved.voiceoverFile).toBe('')
      expect(resolved.musicFile).toBe('')
    })
  })
})
