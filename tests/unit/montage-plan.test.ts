// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest'
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

// ── Mocks ────────────────────────────────────────────────────────────

// Mock child_process — namespace import so normalize.ts picks it up
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: vi.fn(),
  }
})

// Mock openrouter for refine-plan
vi.mock('../../server/lib/openrouter.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue('{}'),
  generateImage: vi.fn(),
}))

import * as childProcess from 'node:child_process'
import { chatCompletion } from '../../server/lib/openrouter.js'

const mockExecFile = childProcess.execFile as unknown as Mock

const app = createApp()

// ── Test helpers ─────────────────────────────────────────────────────

function makeShot(overrides: Partial<ShotMeta> & { id: string; order: number }): ShotMeta {
  return {
    scene: 'Общий вид фасада здания',
    audioDescription: '',
    imagePrompt: 'test prompt',
    videoPrompt: 'test video prompt',
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

async function setupProject(
  shots: ShotMeta[],
  extras?: Partial<Project>,
): Promise<string> {
  const project = await createProject('Test Montage Project')
  await withProject(project.id, (p) => {
    p.shots = shots
    p.script = extras?.script || 'Тестовый сценарий для озвучки голоса. Это премиальная недвижимость в центре города.'
    if (extras?.voiceoverFile !== undefined) p.voiceoverFile = extras.voiceoverFile
    if (extras?.musicFile !== undefined) p.musicFile = extras.musicFile
    if (extras?.montagePlan !== undefined) p.montagePlan = extras.montagePlan
    if (extras?.stage !== undefined) p.stage = extras.stage
  })
  return project.id
}

// Setup ffprobe mock to return a known duration
function mockFfprobe(durationSec: number) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      if (cmd.includes('ffprobe')) {
        cb(null, JSON.stringify({
          format: { duration: String(durationSec) },
          streams: [{
            codec_type: 'video',
            codec_name: 'h264',
            width: 3840,
            height: 2160,
            r_frame_rate: '30/1',
          }],
        }), '')
      } else if (cmd.includes('ffmpeg')) {
        // Mock ffmpeg normalization — just succeed
        cb(null, '', '')
      } else {
        cb(new Error(`Unexpected command: ${cmd}`), '', '')
      }
    },
  )
}

// Setup ffprobe mock that returns different resolution (needs normalization)
function mockFfprobeNeedsNormalize(durationSec: number) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      if (cmd.includes('ffprobe')) {
        cb(null, JSON.stringify({
          format: { duration: String(durationSec) },
          streams: [{
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '24/1',
          }],
        }), '')
      } else if (cmd.includes('ffmpeg')) {
        cb(null, '', '')
      } else {
        cb(new Error(`Unexpected command: ${cmd}`), '', '')
      }
    },
  )
}

// ── Test suite ───────────────────────────────────────────────────────

describe('Montage Plan Generation (Phase 4)', () => {
  let projectId: string
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

  // ── Unit tests: generateMontagePlan ──────────────────────────────

  describe('generateMontagePlan()', () => {
    // We import the function directly to test it in isolation
    let generateMontagePlan: typeof import('../../server/lib/montage-plan.js').generateMontagePlan

    beforeEach(async () => {
      // Dynamic import to get the real module
      const mod = await import('../../server/lib/montage-plan.js')
      generateMontagePlan = mod.generateMontagePlan
    })

    it('should generate a plan with intro, timeline entries, transitions, and outro', () => {
      const project = {
        id: 'test-project',
        name: 'ЖК Премиум',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Аэриал фасад здания дрон', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Лобби интерьер мрамор', duration: 4, videoFile: 'shots/shot-002.mp4' }),
          makeShot({ id: 'shot-003', order: 2, scene: 'Вид с балкона панорам', duration: 6, videoFile: 'shots/shot-003.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const voiceoverDurationSec = 30

      const plan = generateMontagePlan(project, voiceoverDurationSec)

      // Version
      expect(plan.version).toBe(1)

      // Format
      expect(plan.format).toEqual({ width: 3840, height: 2160, fps: 30 })

      // Intro present
      expect(plan.motionGraphics.intro).toBeDefined()
      expect(plan.motionGraphics.intro!.title).toBe('ЖК Премиум')
      expect(plan.motionGraphics.intro!.durationSec).toBe(3)
      expect(plan.motionGraphics.intro!.animation).toBe('fade_in')

      // Outro present
      expect(plan.motionGraphics.outro).toBeDefined()
      expect(plan.motionGraphics.outro!.title).toBe('ЖК Премиум')
      expect(plan.motionGraphics.outro!.durationSec).toBe(4)
      expect(plan.motionGraphics.outro!.animation).toBe('fade_in')

      // Timeline: 3 approved shots = 3 timeline entries
      expect(plan.timeline).toHaveLength(3)
      expect(plan.timeline.map((entry) => entry.clipId)).toEqual([
        'clip-shot-001',
        'clip-shot-002',
        'clip-shot-003',
      ])

      // Transitions: between each pair + intro->first shot = 3 transitions
      expect(plan.transitions).toHaveLength(3)
      expect(plan.transitions.map((transition) => [transition.fromClipId, transition.toClipId])).toEqual([
        ['intro', 'clip-shot-001'],
        ['clip-shot-001', 'clip-shot-002'],
        ['clip-shot-002', 'clip-shot-003'],
      ])
    })

    it('should only include approved shots, sorted by order', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-003', order: 2, scene: 'Interior', duration: 3, status: 'approved' }),
          makeShot({ id: 'shot-001', order: 0, scene: 'Exterior', duration: 5, status: 'approved' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Draft shot', duration: 4, status: 'draft' }),
          makeShot({ id: 'shot-004', order: 3, scene: 'Review', duration: 3, status: 'vid_review' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 20)

      // Only 2 approved shots
      expect(plan.timeline).toHaveLength(2)
      // Sorted by order: shot-001 first, shot-003 second
      expect(plan.timeline[0].shotId).toBe('shot-001')
      expect(plan.timeline[1].shotId).toBe('shot-003')
      expect(plan.timeline.map((entry) => entry.clipId)).toEqual([
        'clip-shot-001',
        'clip-shot-003',
      ])
      expect(plan.transitions.map((transition) => [transition.fromClipId, transition.toClipId])).toEqual([
        ['intro', 'clip-shot-001'],
        ['clip-shot-001', 'clip-shot-003'],
      ])
    })

    it('should keep repeated semantic clips when the same shot is matched to multiple anchors', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({
            id: 'shot-001',
            order: 0,
            scene: 'Терраса с видом на реку',
            duration: 6,
            videoFile: 'shots/shot-001.mp4',
            videoDescription: {
              version: 1,
              summary: 'Один ролик с двумя выразительными моментами',
              tags: ['terrace', 'sunset'],
              matchHints: ['терраса', 'вид на реку', 'закат'],
              moments: [
                { id: 'moment-terrace', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['terrace'], summary: 'Терраса и вид' },
                { id: 'moment-sunset', label: 'Закат', startSec: 2.5, endSec: 5.5, tags: ['sunset'], summary: 'Мягкий вечерний свет' },
              ],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-1', sourceText: 'Терраса с видом', label: 'Терраса', order: 1, intent: 'lifestyle' },
          { id: 'anchor-2', sourceText: 'Вечерний закат', label: 'Закат', order: 2, intent: 'feature' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-1',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-terrace',
            confidence: 0.94,
            status: 'matched',
            candidates: [],
          },
          {
            anchorId: 'anchor-2',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-sunset',
            confidence: 0.91,
            status: 'matched',
            candidates: [],
          },
        ],
      } as unknown as Project

      const plan = generateMontagePlan(project, 20)

      expect(plan.timeline).toHaveLength(2)
      expect(plan.timeline[0].clipId).toBe('clip-anchor-1')
      expect(plan.timeline[1].clipId).toBe('clip-anchor-2')
      expect(plan.timeline[0].anchorId).toBe('anchor-1')
      expect(plan.timeline[1].anchorId).toBe('anchor-2')
      expect(plan.timeline[0].selectedMomentId).toBe('moment-terrace')
      expect(plan.timeline[1].selectedMomentId).toBe('moment-sunset')
      expect(plan.timeline[0].shotId).toBe('shot-001')
      expect(plan.timeline[1].shotId).toBe('shot-001')
      expect(plan.transitions.map((transition) => [transition.fromClipId, transition.toClipId])).toEqual([
        ['intro', 'clip-anchor-1'],
        ['clip-anchor-1', 'clip-anchor-2'],
      ])
    })

    it('should assign stable clip ids to fallback approved-shot clips', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Exterior', duration: 5, status: 'approved' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Interior', duration: 4, status: 'approved' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 15)

      expect(plan.timeline.map((entry) => entry.clipId)).toEqual([
        'clip-shot-001',
        'clip-shot-002',
      ])
    })

    it('should distribute durations proportionally, summing to voiceover + intro + outro', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Фасад exterior', duration: 10, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Интерьер гостиная', duration: 5, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const voiceoverDuration = 30
      const plan = generateMontagePlan(project, voiceoverDuration)

      // Total timeline should be voiceover(30) + intro(3) + outro(4) = 37s
      // Available for shots = voiceover(30)
      // shot-001 gets 10/15 * 30 = 20s, shot-002 gets 5/15 * 30 = 10s
      const totalShotDuration = plan.timeline.reduce((sum, e) => sum + e.durationSec, 0)
      // Allow small floating point tolerance
      expect(totalShotDuration).toBeCloseTo(voiceoverDuration, 1)

      // shot-001 should be roughly 2x duration of shot-002
      expect(plan.timeline[0].durationSec).toBeCloseTo(20, 0)
      expect(plan.timeline[1].durationSec).toBeCloseTo(10, 0)
    })

    it('should enforce minimum 2s clip duration', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Main shot', duration: 100, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Tiny shot', duration: 1, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 10)

      // The tiny shot should get at least 2s
      expect(plan.timeline[1].durationSec).toBeGreaterThanOrEqual(2)
    })

    it('accepts semantic montage metadata on projects and shots without changing draft plan generation', () => {
      const project = {
        id: 'test-project',
        name: 'Semantic montage project',
        created: '2026-03-13T00:00:00.000Z',
        updated: '2026-03-13T00:00:00.000Z',
        stage: 'montage_draft',
        briefType: 'text',
        brief: {
          text: '',
          assets: [],
          targetDuration: 12,
        },
        script: 'Панорамные окна с видом на город.',
        settings: {
          textModel: 'openai/gpt-4o',
          imageModel: 'test-image-model',
          enhanceModel: 'test-enhance-model',
          masterPromptScriptwriter: '',
          masterPromptShotSplitter: '',
          masterPromptEnhance: '',
        },
        shots: [
          makeShot({
            id: 'shot-001',
            order: 0,
            scene: 'Панорамный фасад комплекса',
            duration: 6,
            videoFile: 'shots/shot-001.mp4',
            videoDescription: {
              version: 1,
              summary: 'Плавный пролет вдоль фасада с акцентом на панорамные окна',
              tags: ['фасад', 'панорамные окна', 'закат'],
              matchHints: ['панорамные окна', 'архитектура комплекса'],
              moments: [
                {
                  id: 'moment-001',
                  label: 'Окна и верхние этажи',
                  startSec: 1,
                  endSec: 4,
                  tags: ['панорамные окна'],
                  summary: 'Камера подчеркивает панорамные окна верхних этажей',
                },
              ],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          {
            id: 'anchor-001',
            sourceText: 'панорамные окна с видом на город',
            label: 'панорамные окна',
            order: 0,
            startSec: 0,
            endSec: 4,
            intent: 'feature',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-001',
            confidence: 0.93,
            status: 'matched',
            candidates: [
              {
                shotId: 'shot-001',
                momentId: 'moment-001',
                confidence: 0.93,
                reason: 'Совпадение по videoDescription.matchHints и moments.tags',
              },
            ],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 1,
          matchedAnchors: 1,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
      } satisfies Project

      const plan = generateMontagePlan(project, 12)

      expect(plan.timeline).toHaveLength(1)
      expect(plan.timeline[0].shotId).toBe('shot-001')
      expect(project.shots[0].videoDescription?.moments[0]?.id).toBe('moment-001')
      expect(project.narrationAnchors?.[0]?.label).toBe('панорамные окна')
      expect(project.anchorMatches?.[0]?.selectedShotId).toBe('shot-001')
      expect(project.anchorCoverageSummary?.matchedAnchors).toBe(1)
    })

    it('builds timeline in anchor-match order and drafts trims from selected moments', () => {
      const project = {
        id: 'test-project',
        name: 'Semantic montage project',
        created: '2026-03-13T00:00:00.000Z',
        updated: '2026-03-13T00:00:00.000Z',
        stage: 'montage_draft',
        briefType: 'text',
        brief: {
          text: '',
          assets: [],
          targetDuration: 18,
        },
        script: 'Панорамные окна. Терраса с видом.',
        settings: {
          textModel: 'openai/gpt-4o',
          imageModel: 'test-image-model',
          enhanceModel: 'test-enhance-model',
          masterPromptScriptwriter: '',
          masterPromptShotSplitter: '',
          masterPromptEnhance: '',
        },
        shots: [
          makeShot({
            id: 'shot-001',
            order: 1,
            scene: 'Фасад с панорамными окнами',
            duration: 8,
            videoFile: 'shots/shot-001.mp4',
            videoDescription: {
              version: 1,
              summary: 'Фасад и панорамные окна.',
              tags: ['фасад', 'панорамные окна'],
              matchHints: ['панорамные окна'],
              moments: [
                {
                  id: 'moment-windows',
                  label: 'Панорамные окна',
                  startSec: 1.5,
                  endSec: 4.5,
                  tags: ['панорамные окна'],
                  summary: 'Акцент на панорамных окнах.',
                },
              ],
            },
          }),
          makeShot({
            id: 'shot-002',
            order: 2,
            scene: 'Терраса с видом на реку',
            duration: 6,
            videoFile: 'shots/shot-002.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса и река.',
              tags: ['терраса'],
              matchHints: ['терраса с видом'],
              moments: [
                {
                  id: 'moment-terrace',
                  label: 'Терраса',
                  startSec: 0.5,
                  endSec: 3.5,
                  tags: ['терраса'],
                  summary: 'Выход на террасу с видом.',
                },
              ],
            },
          }),
          makeShot({
            id: 'shot-003',
            order: 3,
            scene: 'Лобби',
            duration: 5,
            videoFile: 'shots/shot-003.mp4',
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          {
            id: 'anchor-terrace',
            sourceText: 'Терраса с видом',
            label: 'Терраса',
            order: 1,
            intent: 'lifestyle',
          },
          {
            id: 'anchor-windows',
            sourceText: 'Панорамные окна',
            label: 'Панорамные окна',
            order: 2,
            intent: 'feature',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-terrace',
            selectedShotId: 'shot-002',
            selectedMomentId: 'moment-terrace',
            confidence: 0.94,
            status: 'matched',
            candidates: [],
          },
          {
            anchorId: 'anchor-windows',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-windows',
            confidence: 0.91,
            status: 'matched',
            candidates: [],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 2,
          matchedAnchors: 2,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
      } satisfies Project

      const plan = generateMontagePlan(project, 18)

      expect(plan.timeline.map((entry) => entry.shotId)).toEqual(['shot-002', 'shot-001', 'shot-003'])
      expect(plan.timeline[0]).toMatchObject({
        shotId: 'shot-002',
        trimStartSec: 0.5,
        trimEndSec: 3.5,
      })
      expect(plan.timeline[1]).toMatchObject({
        shotId: 'shot-001',
        trimStartSec: 1.5,
        trimEndSec: 4.5,
      })
    })

    it('falls back to remaining approved shots when matches are weak or missing', () => {
      const project = {
        id: 'test-project',
        name: 'Fallback montage project',
        shots: [
          makeShot({ id: 'shot-001', order: 1, scene: 'Фасад', duration: 6, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 2, scene: 'Спальня', duration: 5, videoFile: 'shots/shot-002.mp4' }),
          makeShot({ id: 'shot-003', order: 3, scene: 'Лобби', duration: 4, videoFile: 'shots/shot-003.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-1', sourceText: 'Спальня', label: 'Спальня', order: 1, intent: 'detail' },
          { id: 'anchor-2', sourceText: 'Детская игровая', label: 'Игровая', order: 2, intent: 'lifestyle' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-1',
            selectedShotId: 'shot-002',
            confidence: 0.48,
            status: 'weak_match',
            candidates: [],
          },
          {
            anchorId: 'anchor-2',
            confidence: 0,
            status: 'unmatched',
            candidates: [],
          },
        ],
      } as unknown as Project

      const plan = generateMontagePlan(project, 15)

      expect(plan.timeline.map((entry) => entry.shotId)).toEqual(['shot-002', 'shot-001', 'shot-003'])
      expect(plan.timeline).toHaveLength(3)
    })

    it('should select fade transition for aerial/drone scenes', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Аэриал дрон над зданием', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Панорама вид сверху', duration: 5, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 20)

      // First shot after intro gets fade
      const firstTransition = plan.transitions.find(t => t.toShotId === 'shot-001')
      expect(firstTransition).toBeDefined()
      expect(firstTransition!.type).toBe('fade')
      expect(firstTransition!.durationSec).toBe(0.5)

      // Second shot: панорам -> fade
      const secondTransition = plan.transitions.find(t => t.toShotId === 'shot-002')
      expect(secondTransition).toBeDefined()
      expect(secondTransition!.type).toBe('fade')
    })

    it('should select cut for detail/close-up scenes', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Общий план здания', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Деталь текстура мрамора крупный план', duration: 3, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 20)

      const detailTransition = plan.transitions.find(t => t.toShotId === 'shot-002')
      expect(detailTransition).toBeDefined()
      expect(detailTransition!.type).toBe('cut')
      expect(detailTransition!.durationSec).toBe(0)
    })

    it('should select crossfade for interior/exterior switch', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Фасад exterior здания', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Лобби interior мрамор', duration: 5, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 20)

      const switchTransition = plan.transitions.find(t => t.fromShotId === 'shot-001' && t.toShotId === 'shot-002')
      expect(switchTransition).toBeDefined()
      expect(switchTransition!.type).toBe('crossfade')
      expect(switchTransition!.durationSec).toBe(0.8)
    })

    it('should generate lower thirds for area changes', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Аэриал фасад exterior дрон', duration: 5 }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Лобби interior вход', duration: 4 }),
          makeShot({ id: 'shot-003', order: 2, scene: 'Лобби interior ресепшн', duration: 3 }),
          makeShot({ id: 'shot-004', order: 3, scene: 'Бассейн exterior двор', duration: 4 }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 30)

      // Lower thirds should be on first shot of each new area
      // shot-001: first area (exterior) -> lower third
      // shot-002: new area (interior) -> lower third
      // shot-003: same area (interior) -> no lower third
      // shot-004: new area (exterior again) -> lower third
      expect(plan.motionGraphics.lowerThirds.length).toBeGreaterThanOrEqual(3)

      const lowerThirdShotIds = plan.motionGraphics.lowerThirds.map(lt => lt.shotId)
      expect(lowerThirdShotIds).toContain('shot-001')
      expect(lowerThirdShotIds).toContain('shot-002')
      expect(lowerThirdShotIds).toContain('shot-004')
    })

    it('should set correct audio settings', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Test', duration: 5 }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 10)

      expect(plan.audio.voiceover.gainDb).toBe(0)
      expect(plan.audio.voiceover.file).toBe('montage/voiceover.mp3')
      expect(plan.audio.music.gainDb).toBe(-18)
      expect(plan.audio.music.duckingDb).toBe(-10)
      expect(plan.audio.music.duckFadeMs).toBe(500)
      expect(plan.audio.music.file).toBe('montage/music.mp3')
    })

    it('should set correct style defaults', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Test', duration: 5 }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 10)

      expect(plan.style.preset).toBe('premium')
      expect(plan.style.fontFamily).toBe('Montserrat')
      expect(plan.style.primaryColor).toBe('#1a1a2e')
      expect(plan.style.secondaryColor).toBe('#e2b44d')
      expect(plan.style.textColor).toBe('#ffffff')
    })

    it('should handle startSec correctly (cumulative positioning)', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Scene A', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Scene B', duration: 5, videoFile: 'shots/shot-002.mp4' }),
          makeShot({ id: 'shot-003', order: 2, scene: 'Scene C', duration: 5, videoFile: 'shots/shot-003.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 30)

      // First clip starts after intro (3s)
      expect(plan.timeline[0].startSec).toBe(3)

      // Each subsequent clip starts after the previous one ends
      for (let i = 1; i < plan.timeline.length; i++) {
        expect(plan.timeline[i].startSec).toBeCloseTo(
          plan.timeline[i - 1].startSec + plan.timeline[i - 1].durationSec,
          1,
        )
      }
    })
  })

  // ── Endpoint tests: POST /montage/generate-plan ──────────────────

  describe('POST /montage/generate-plan', () => {
    it('should return 400 if no approved shots', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, status: 'draft', duration: 5 }),
      ])
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-plan`)
        .expect(400)

      expect(res.body.error).toMatch(/approved/i)
    })

    it('should generate plan using ffprobe voiceover duration and save to project', async () => {
      // Create project with approved shots and voiceover file
      projectId = await setupProject(
        [
          makeShot({ id: 'shot-001', order: 0, scene: 'Фасад exterior', duration: 5, videoFile: 'shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Интерьер гостиная', duration: 4, videoFile: 'shot-002.mp4' }),
        ],
        { voiceoverFile: 'montage/voiceover.mp3', musicFile: 'montage/music.mp3' },
      )
      createdIds.push(projectId)

      // Create fake video files so ffprobe can "find" them
      const montageDir = resolveProjectPath(projectId, 'montage')
      await ensureDir(montageDir)
      await fs.writeFile(path.join(montageDir, 'voiceover.mp3'), 'fake-audio')

      const shotOneVideoDir = resolveProjectPath(projectId, 'shots', 'shot-001', 'video')
      const shotTwoVideoDir = resolveProjectPath(projectId, 'shots', 'shot-002', 'video')
      await ensureDir(shotOneVideoDir)
      await ensureDir(shotTwoVideoDir)
      await fs.writeFile(path.join(shotOneVideoDir, 'shot-001.mp4'), 'fake-video')
      await fs.writeFile(path.join(shotTwoVideoDir, 'shot-002.mp4'), 'fake-video')

      // Mock ffprobe to return 45.2 seconds for voiceover, and video info for clips
      mockFfprobe(45.2)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-plan`)
        .expect(200)

      expect(res.body.montagePlan).toBeDefined()
      const plan: MontagePlan = res.body.montagePlan

      // Plan should have correct structure
      expect(plan.version).toBe(1)
      expect(plan.timeline).toHaveLength(2)
      expect(plan.motionGraphics.intro).toBeDefined()
      expect(plan.motionGraphics.outro).toBeDefined()

      // Verify plan was saved to project
      const { getProject } = await import('../../server/lib/storage.js')
      const updated = await getProject(projectId)
      expect(updated!.montagePlan).toBeDefined()
      expect(updated!.stage).toBe('montage_draft')
    })

    it('should estimate voiceover duration from script when no voiceover file', async () => {
      // ~14 words in Russian -> at 150 wpm -> ~5.6s
      const script = 'Тестовый сценарий для озвучки голоса. Это премиальная недвижимость в центре города. Великолепные виды и современная архитектура.'

      projectId = await setupProject(
        [
          makeShot({ id: 'shot-001', order: 0, scene: 'Test exterior', duration: 5, videoFile: 'shot-001.mp4' }),
        ],
        { script, musicFile: 'montage/music.mp3' },
      )
      createdIds.push(projectId)

      const shotVideoDir = resolveProjectPath(projectId, 'shots', 'shot-001', 'video')
      await ensureDir(shotVideoDir)
      await fs.writeFile(path.join(shotVideoDir, 'shot-001.mp4'), 'fake-video')

      // Mock ffprobe for video clips only (no voiceover file)
      mockFfprobe(5)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/generate-plan`)
        .expect(200)

      expect(res.body.montagePlan).toBeDefined()
      // Should have generated a plan even without voiceover file
      expect(res.body.montagePlan.timeline.length).toBeGreaterThan(0)
    })
  })

  // ── Endpoint tests: POST /montage/refine-plan ────────────────────

  describe('POST /montage/refine-plan', () => {
    it('should return 400 if no existing montage plan', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 }),
      ])
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({ feedback: 'Make transitions faster' })
        .expect(400)

      expect(res.body.error).toMatch(/plan/i)
    })

    it('should return 400 if no feedback provided', async () => {
      const existingPlan: MontagePlan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [{ shotId: 'shot-001', clipFile: 'normalized/shot-001.mp4', startSec: 3, durationSec: 10 }],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -18, duckingDb: -10, duckFadeMs: 500 },
        },
        style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#1a1a2e', secondaryColor: '#e2b44d', textColor: '#ffffff' },
      }

      projectId = await setupProject(
        [makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 })],
        { montagePlan: existingPlan },
      )
      createdIds.push(projectId)

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({})
        .expect(400)

      expect(res.body.error).toMatch(/feedback/i)
    })

    it('should call LLM and save refined plan', async () => {
      const existingPlan: MontagePlan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [{ shotId: 'shot-001', clipFile: 'normalized/shot-001.mp4', startSec: 3, durationSec: 10 }],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -18, duckingDb: -10, duckFadeMs: 500 },
        },
        style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#1a1a2e', secondaryColor: '#e2b44d', textColor: '#ffffff' },
      }

      // The refined plan the LLM returns
      const refinedPlan: MontagePlan = {
        ...existingPlan,
        transitions: [{ fromShotId: 'intro', toShotId: 'shot-001', type: 'cut', durationSec: 0 }],
      }

      ;(chatCompletion as Mock).mockResolvedValueOnce(JSON.stringify(refinedPlan))

      projectId = await setupProject(
        [makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 })],
        { montagePlan: existingPlan },
      )
      createdIds.push(projectId)

      // Ensure settings have API key
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      const existingSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8').catch(() => '{}'))
      await fs.writeFile(settingsPath, JSON.stringify({
        ...existingSettings,
        openRouterApiKey: 'test-key',
      }, null, 2))

      const res = await request(app)
        .post(`/api/projects/${projectId}/montage/refine-plan`)
        .send({ feedback: 'Make all transitions cuts' })
        .expect(200)

      expect(res.body.montagePlan).toBeDefined()
      expect(res.body.montagePlan.transitions).toHaveLength(1)
      expect(res.body.montagePlan.transitions[0].type).toBe('cut')

      // Verify chatCompletion was called with system prompt about video editor
      expect(chatCompletion).toHaveBeenCalledTimes(1)
      const [, messages] = (chatCompletion as Mock).mock.calls[0]
      expect(messages[0].content).toMatch(/video editor/i)
    })
  })

  // ── Endpoint tests: PUT /montage/plan ────────────────────────────

  describe('PUT /montage/plan', () => {
    it('should save a valid plan directly', async () => {
      const plan: MontagePlan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [{ shotId: 'shot-001', clipFile: 'normalized/shot-001.mp4', startSec: 3, durationSec: 10 }],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -18, duckingDb: -10, duckFadeMs: 500 },
        },
        style: { preset: 'premium', fontFamily: 'Montserrat', primaryColor: '#1a1a2e', secondaryColor: '#e2b44d', textColor: '#ffffff' },
      }

      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 }),
      ])
      createdIds.push(projectId)

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/plan`)
        .send({ montagePlan: plan })
        .expect(200)

      expect(res.body.montagePlan).toBeDefined()
      expect(res.body.montagePlan.version).toBe(1)

      // Verify saved
      const { getProject } = await import('../../server/lib/storage.js')
      const updated = await getProject(projectId)
      expect(updated!.montagePlan).toBeDefined()
      expect(updated!.montagePlan!.timeline).toHaveLength(1)
    })

    it('should return 400 if montagePlan is missing', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 }),
      ])
      createdIds.push(projectId)

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/plan`)
        .send({})
        .expect(400)

      expect(res.body.error).toMatch(/montagePlan/i)
    })

    it('should return 400 if montagePlan is missing required fields', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, status: 'approved', duration: 5 }),
      ])
      createdIds.push(projectId)

      const res = await request(app)
        .put(`/api/projects/${projectId}/montage/plan`)
        .send({ montagePlan: { version: 1 } }) // Missing timeline, format, etc.
        .expect(400)

      expect(res.body.error).toMatch(/invalid|required|missing/i)
    })
  })

  // ── Unit tests: normalizeClips ───────────────────────────────────

  describe('normalizeClips()', () => {
    let normalizeClips: typeof import('../../server/lib/normalize.js').normalizeClips

    beforeEach(async () => {
      const mod = await import('../../server/lib/normalize.js')
      normalizeClips = mod.normalizeClips
    })

    it('should return a map of shotId -> normalized file path', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, duration: 5, videoFile: 'shot-001.mp4' }),
      ])
      createdIds.push(projectId)

      const shotVideoDir = resolveProjectPath(projectId, 'shots', 'shot-001', 'video')
      await ensureDir(shotVideoDir)
      await fs.writeFile(path.join(shotVideoDir, 'shot-001.mp4'), 'fake-video')

      mockFfprobe(5)

      const result = await normalizeClips(projectId, [
        makeShot({ id: 'shot-001', order: 0, duration: 5, videoFile: 'shot-001.mp4' }),
      ])

      expect(result).toBeInstanceOf(Map)
      expect(result.has('shot-001')).toBe(true)
      expect(result.get('shot-001')).toContain('normalized')
      expect(result.get('shot-001')).toContain('shot-001.mp4')
    })

    it('should call ffmpeg for clips needing normalization', async () => {
      projectId = await setupProject([
        makeShot({ id: 'shot-001', order: 0, duration: 5, videoFile: 'shot-001.mp4' }),
      ])
      createdIds.push(projectId)

      const shotVideoDir = resolveProjectPath(projectId, 'shots', 'shot-001', 'video')
      await ensureDir(shotVideoDir)
      await fs.writeFile(path.join(shotVideoDir, 'shot-001.mp4'), 'fake-video')

      mockFfprobeNeedsNormalize(5)

      await normalizeClips(projectId, [
        makeShot({ id: 'shot-001', order: 0, duration: 5, videoFile: 'shot-001.mp4' }),
      ])

      // Should have called ffprobe then ffmpeg
      const calls = mockExecFile.mock.calls
      const ffprobeCalls = calls.filter((call) => String(call[0]).includes('ffprobe'))
      const ffmpegCalls = calls.filter((call) => String(call[0]).includes('ffmpeg'))
      expect(ffprobeCalls.length).toBeGreaterThanOrEqual(1)
      expect(ffmpegCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('should generate video from image for shots without videoFile', async () => {
      projectId = await setupProject([
        makeShot({
          id: 'shot-001',
          order: 0,
          duration: 5,
          videoFile: null,
          selectedImage: 'best.jpg',
          generatedImages: ['best.jpg'],
        }),
      ])
      createdIds.push(projectId)

      // Create fake image
      const imgDir = resolveProjectPath(projectId, 'shots', 'shot-001')
      await ensureDir(imgDir)
      await fs.writeFile(path.join(imgDir, 'best.jpg'), 'fake-image')

      mockExecFile.mockImplementation(
        (cmd: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          if (cmd.includes('ffmpeg')) {
            cb(null, '', '')
          } else {
            cb(null, '', '')
          }
        },
      )

      const result = await normalizeClips(projectId, [
        makeShot({
          id: 'shot-001',
          order: 0,
          duration: 5,
          videoFile: null,
          selectedImage: 'best.jpg',
          generatedImages: ['best.jpg'],
        }),
      ])

      expect(result.has('shot-001')).toBe(true)

      // Should have called ffmpeg with -loop 1 for image to video
      const ffmpegCalls = mockExecFile.mock.calls.filter((call) => String(call[0]).includes('ffmpeg'))
      expect(ffmpegCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('matchNarrationAnchors()', () => {
    let matchNarrationAnchors: (project: Project) => {
      anchorMatches: NonNullable<Project['anchorMatches']>
      anchorCoverageSummary: NonNullable<Project['anchorCoverageSummary']>
    }

    beforeEach(async () => {
      const mod = await import('../../server/lib/' + 'montage-anchor-matching.js') as {
        matchNarrationAnchors: typeof matchNarrationAnchors
      }
      matchNarrationAnchors = mod.matchNarrationAnchors
    })

    it('prefers videoDescription.matchHints over tags, summary, and fallback fields for a strong match', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-hints',
            order: 0,
            scene: 'Тихая спальня с мягким светом',
            imagePrompt: 'soft bedroom interior',
            videoPrompt: 'slow bedroom push-in',
            videoDescription: {
              version: 1,
              summary: 'Камера показывает спальню и текстуры отделки.',
              tags: ['спальня', 'интерьер'],
              matchHints: ['кухня с мраморным островом'],
              moments: [],
            },
          }),
          makeShot({
            id: 'shot-fallback',
            order: 1,
            scene: 'Кухня с мраморным островом и высоким потолком',
            imagePrompt: 'marble island kitchen',
            videoPrompt: 'camera glides through marble island kitchen',
            videoDescription: {
              version: 1,
              summary: 'Плавный пролет по фасаду и лобби.',
              tags: ['фасад'],
              matchHints: ['терраса'],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Кухня с мраморным островом',
            label: 'Кухня с островом',
            order: 1,
            intent: 'feature',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches).toHaveLength(1)
      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-hints',
        status: 'matched',
      })
      expect(result.anchorMatches[0].candidates[0]).toMatchObject({
        shotId: 'shot-hints',
      })
      expect(result.anchorMatches[0].candidates[0].reason).toMatch(/matchHints/i)
      expect(result.anchorMatches[0].candidates[1]).toMatchObject({
        shotId: 'shot-fallback',
      })
      expect(result.anchorMatches[0].candidates[0].confidence).toBeGreaterThan(result.anchorMatches[0].candidates[1].confidence)
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      })
    })

    it('matches anchors against videoDescription.tags when matchHints do not hit', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-tags',
            order: 0,
            scene: 'Спокойная зона отдыха',
            videoDescription: {
              version: 1,
              summary: 'Камера мягко скользит по lounge зоне.',
              tags: ['терраса на крыше'],
              matchHints: ['лобби'],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Терраса на крыше',
            label: 'Терраса',
            order: 1,
            intent: 'lifestyle',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-tags',
        status: 'matched',
      })
      expect(result.anchorMatches[0].candidates[0]?.reason).toMatch(/tags/i)
    })

    it('uses videoDescription.summary as a weak match when stronger signals are absent', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-summary',
            order: 0,
            scene: 'Нейтральный интерьер',
            imagePrompt: 'neutral interior',
            videoPrompt: 'neutral interior camera move',
            videoDescription: {
              version: 1,
              summary: 'Камера задерживается на приватном кабинете у окна и рабочем столе.',
              tags: ['интерьер'],
              matchHints: [],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Приватный кабинет у окна',
            label: 'Кабинет',
            order: 1,
            intent: 'detail',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-summary',
        status: 'weak_match',
      })
      expect(result.anchorMatches[0].candidates[0]?.reason).toMatch(/summary/i)
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 0,
        weakMatches: 1,
        unmatchedAnchors: 0,
      })
    })

    it('marks anchors as unmatched when no description or fallback signal is relevant', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-1',
            order: 0,
            scene: 'Фасад комплекса на рассвете',
            imagePrompt: 'sunrise exterior',
            videoPrompt: 'slow drone over facade',
            videoDescription: {
              version: 1,
              summary: 'Плавный пролет вдоль фасада и лобби.',
              tags: ['фасад', 'лобби'],
              matchHints: ['архитектура комплекса'],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Детская игровая комната',
            label: 'Игровая',
            order: 1,
            intent: 'lifestyle',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toEqual({
        anchorId: 'anchor-1',
        confidence: 0,
        status: 'unmatched',
        candidates: [],
      })
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 0,
        weakMatches: 0,
        unmatchedAnchors: 1,
      })
    })
  })
})
