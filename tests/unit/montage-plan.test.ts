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
  type SemanticBlock,
  type ShotMeta,
  type MontagePlan,
  type MontageReview,
} from '../../server/lib/storage.js'
import { buildSemanticBlocks } from '../../server/lib/semantic-block-planner.js'
import { applyMontageReviewAutoFixes } from '../../server/lib/montage-plan.js'

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

function makeSemanticBlock(overrides: Partial<SemanticBlock> & {
  id: string
  anchorId: string
  anchorText: string
  anchorLabel: string
  strategy: SemanticBlock['strategy']
  confidence: number
  segments: SemanticBlock['segments']
}): SemanticBlock {
  return {
    ...overrides,
  }
}

function makePlan(
  entries: Array<{
    shotId: string
    startSec: number
    durationSec: number
    clipId?: string
    selectedMomentId?: string
    semanticBlockId?: string
  }>,
  semanticBlocks: SemanticBlock[] = [],
): MontagePlan {
  return {
    version: 1,
    format: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline: entries.map((entry) => ({
      clipId: entry.clipId,
      shotId: entry.shotId,
      clipFile: `montage/normalized/${entry.shotId}.mp4`,
      startSec: entry.startSec,
      durationSec: entry.durationSec,
      selectedMomentId: entry.selectedMomentId,
      semanticBlockId: entry.semanticBlockId,
    })),
    transitions: [],
    semanticBlocks,
    motionGraphics: {
      lowerThirds: [],
    },
    audio: {
      voiceover: { file: '', gainDb: 0 },
      music: { file: '', gainDb: 0, duckingDb: 0, duckFadeMs: 0 },
    },
    style: {
      preset: 'premium',
      fontFamily: 'Montserrat',
      primaryColor: '#111111',
      secondaryColor: '#222222',
      textColor: '#ffffff',
    },
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

describe('applyMontageReviewAutoFixes()', () => {
  it('moves a repeated clip farther away without reordering the story block', () => {
    const project = {
      shots: [
        makeShot({ id: 'shot-a', order: 0, scene: 'Фасад', duration: 6 }),
        makeShot({ id: 'shot-b', order: 1, scene: 'Терраса', duration: 6 }),
        makeShot({ id: 'shot-d', order: 3, scene: 'Лобби', duration: 6 }),
      ],
    } as Project
    const plan = makePlan([
      { shotId: 'shot-a', startSec: 3, durationSec: 4, clipId: 'clip-a', semanticBlockId: 'block-1' },
      { shotId: 'shot-b', startSec: 7, durationSec: 4, clipId: 'clip-b', semanticBlockId: 'block-1' },
      { shotId: 'shot-a', startSec: 11, durationSec: 4, clipId: 'clip-a-repeat', semanticBlockId: 'block-1' },
      { shotId: 'shot-d', startSec: 15, durationSec: 4, clipId: 'clip-d', semanticBlockId: 'block-1' },
    ], [
      {
        id: 'block-1',
        anchorId: 'anchor-1',
        anchorText: 'Story block',
        anchorLabel: 'Story block',
        strategy: 'pair',
        confidence: 0.88,
        segments: [
          { shotId: 'shot-a', durationSec: 4, weight: 0.9, reason: 'primary' },
          { shotId: 'shot-b', durationSec: 4, weight: 0.8, reason: 'secondary' },
        ],
      },
    ])

    const review: MontageReview = {
      score: 0.6,
      summary: { issues: 1, autoFixes: 1, blockingRequests: 0 },
      issues: [],
      autoFixes: [
        {
          id: 'fix-move',
          type: 'move_repeat',
          applied: false,
          affectedClipIds: ['clip-a-repeat'],
          explanation: 'Move the repeated clip later to reduce close reuse.',
        },
      ],
      suggestedShotRequests: [],
    }

    const fixedPlan = applyMontageReviewAutoFixes(project, plan, review)

    expect(fixedPlan.timeline.map((entry) => entry.shotId)).toEqual(['shot-a', 'shot-b', 'shot-d', 'shot-a'])
    expect(fixedPlan.timeline[3].startSec).toBeGreaterThan(fixedPlan.timeline[2].startSec)
    expect(fixedPlan.timeline[3].clipId).toBe('clip-a-repeat')
  })

  it('swaps a repeated clip for a fresher candidate', () => {
    const project = {
      shots: [
        makeShot({ id: 'shot-a', order: 0, scene: 'Фасад', duration: 6 }),
        makeShot({ id: 'shot-b', order: 1, scene: 'Терраса', duration: 6 }),
        makeShot({ id: 'shot-c', order: 2, scene: 'Интерьер', duration: 6 }),
      ],
    } as Project
    const plan = makePlan([
      { shotId: 'shot-a', startSec: 3, durationSec: 4, clipId: 'clip-a', semanticBlockId: 'block-1' },
      { shotId: 'shot-b', startSec: 7, durationSec: 4, clipId: 'clip-b', semanticBlockId: 'block-1' },
    ], [
      {
        id: 'block-1',
        anchorId: 'anchor-1',
        anchorText: 'Story block',
        anchorLabel: 'Story block',
        strategy: 'pair',
        confidence: 0.88,
        segments: [
          { shotId: 'shot-a', durationSec: 4, weight: 0.9, reason: 'primary' },
          { shotId: 'shot-b', durationSec: 4, weight: 0.8, reason: 'secondary' },
        ],
        alternatives: [
          { shotId: 'shot-c', confidence: 0.74, reason: 'fresher candidate', rejectedBecause: 'duplicate' },
        ],
      },
    ])

    const review: MontageReview = {
      score: 0.6,
      summary: { issues: 1, autoFixes: 1, blockingRequests: 0 },
      issues: [],
      autoFixes: [
        {
          id: 'fix-swap',
          type: 'swap_candidate',
          applied: false,
          affectedClipIds: ['clip-b'],
          explanation: 'Swap the repeated clip for a fresher candidate.',
        },
      ],
      suggestedShotRequests: [],
    }

    const fixedPlan = applyMontageReviewAutoFixes(project, plan, review)

    expect(fixedPlan.timeline.map((entry) => entry.shotId)).toEqual(['shot-a', 'shot-c'])
    expect(fixedPlan.timeline[1].semanticBlockId).toBe('block-1')
  })

  it('splits an overlong clip into separated uses', () => {
    const project = {
      shots: [
        makeShot({ id: 'shot-long', order: 0, scene: 'Гостиная', duration: 14 }),
        makeShot({ id: 'shot-support', order: 1, scene: 'Терраса', duration: 6 }),
      ],
    } as Project
    const plan = makePlan([
      { shotId: 'shot-long', startSec: 3, durationSec: 10, clipId: 'clip-long', semanticBlockId: 'block-1' },
      { shotId: 'shot-support', startSec: 13, durationSec: 4, clipId: 'clip-support', semanticBlockId: 'block-1' },
    ])

    const review: MontageReview = {
      score: 0.4,
      summary: { issues: 1, autoFixes: 1, blockingRequests: 0 },
      issues: [],
      autoFixes: [
        {
          id: 'fix-split',
          type: 'split_clip',
          applied: false,
          affectedClipIds: ['clip-long'],
          explanation: 'Split the overlong clip into two separated uses.',
        },
      ],
      suggestedShotRequests: [],
    }

    const fixedPlan = applyMontageReviewAutoFixes(project, plan, review)

    expect(fixedPlan.timeline.map((entry) => entry.shotId)).toEqual(['shot-long', 'shot-support', 'shot-long'])
    expect(fixedPlan.timeline[0].durationSec).toBeLessThan(plan.timeline[0].durationSec)
    expect(fixedPlan.timeline[2].durationSec).toBeLessThan(plan.timeline[0].durationSec)
    expect(fixedPlan.timeline[2].semanticBlockId).toBe('block-1')
  })

  it('switches a block strategy when variety improves', () => {
    const plan = makePlan([
      { shotId: 'shot-1', startSec: 3, durationSec: 4, clipId: 'clip-1', semanticBlockId: 'block-1' },
      { shotId: 'shot-2', startSec: 7, durationSec: 4, clipId: 'clip-2', semanticBlockId: 'block-1' },
      { shotId: 'shot-3', startSec: 11, durationSec: 4, clipId: 'clip-3', semanticBlockId: 'block-1' },
    ], [
      {
        id: 'block-1',
        anchorId: 'anchor-1',
        anchorText: 'Block with variety',
        anchorLabel: 'Block',
        strategy: 'cascade',
        confidence: 0.77,
        segments: [
          { shotId: 'shot-1', durationSec: 4, weight: 0.9, reason: 'first' },
          { shotId: 'shot-2', durationSec: 4, weight: 0.8, reason: 'second' },
          { shotId: 'shot-3', durationSec: 4, weight: 0.6, reason: 'third' },
        ],
      },
    ])

    const review: MontageReview = {
      score: 0.5,
      summary: { issues: 1, autoFixes: 1, blockingRequests: 0 },
      issues: [],
      autoFixes: [
        {
          id: 'fix-strategy',
          type: 'change_block_strategy',
          applied: false,
          affectedClipIds: ['clip-1', 'clip-2', 'clip-3'],
          explanation: 'Switch the block strategy to improve visual variety.',
        },
      ],
      suggestedShotRequests: [],
    }

    const fixedPlan = applyMontageReviewAutoFixes({} as Project, plan, review)

    expect(fixedPlan.semanticBlocks?.[0].strategy).toBe('pair')
    expect(fixedPlan.timeline.map((entry) => entry.shotId)).toEqual(['shot-1', 'shot-2', 'shot-3'])
    expect(fixedPlan.timeline[2].semanticBlockId).toBeUndefined()
  })

  it('detaches split clones from the semantic block when strategy is compressed to pair', () => {
    const project = {
      shots: [
        makeShot({ id: 'shot-1', order: 0, scene: 'Фасад', duration: 12 }),
        makeShot({ id: 'shot-2', order: 1, scene: 'Терраса', duration: 6 }),
        makeShot({ id: 'shot-3', order: 2, scene: 'Лобби', duration: 6 }),
      ],
    } as Project
    const plan = makePlan([
      { shotId: 'shot-1', startSec: 3, durationSec: 10, clipId: 'clip-1', semanticBlockId: 'block-1' },
      { shotId: 'shot-2', startSec: 13, durationSec: 4, clipId: 'clip-2', semanticBlockId: 'block-1' },
      { shotId: 'shot-3', startSec: 17, durationSec: 4, clipId: 'clip-3', semanticBlockId: 'block-1' },
    ], [
      {
        id: 'block-1',
        anchorId: 'anchor-1',
        anchorText: 'Block with variety',
        anchorLabel: 'Block',
        strategy: 'cascade',
        confidence: 0.77,
        segments: [
          { shotId: 'shot-1', durationSec: 10, weight: 0.9, reason: 'first' },
          { shotId: 'shot-2', durationSec: 4, weight: 0.8, reason: 'second' },
          { shotId: 'shot-3', durationSec: 4, weight: 0.6, reason: 'third' },
        ],
      },
    ])

    const review: MontageReview = {
      score: 0.5,
      summary: { issues: 2, autoFixes: 2, blockingRequests: 0 },
      issues: [],
      autoFixes: [
        {
          id: 'fix-split',
          type: 'split_clip',
          applied: false,
          affectedClipIds: ['clip-1'],
          explanation: 'Split the overlong clip into two separated uses.',
        },
        {
          id: 'fix-strategy',
          type: 'change_block_strategy',
          applied: false,
          affectedClipIds: ['clip-1', 'clip-2', 'clip-3'],
          explanation: 'Switch the block strategy to improve visual variety.',
        },
      ],
      suggestedShotRequests: [],
    }

    const fixedPlan = applyMontageReviewAutoFixes(project, plan, review)
    const blockTimelineEntries = fixedPlan.timeline.filter((entry) => entry.semanticBlockId === 'block-1')

    expect(fixedPlan.semanticBlocks?.[0].strategy).toBe('pair')
    expect(blockTimelineEntries).toHaveLength(2)
    expect(fixedPlan.timeline.some((entry) => entry.clipId === 'clip-1-split' && entry.semanticBlockId === 'block-1')).toBe(false)
  })
})

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
      expect(plan.timeline[0].clipId).toBe('clip-semantic-block-anchor-1')
      expect(plan.timeline[1].clipId).toBe('clip-semantic-block-anchor-2')
      expect(plan.timeline[0].anchorId).toBe('anchor-1')
      expect(plan.timeline[1].anchorId).toBe('anchor-2')
      expect(plan.timeline[0].selectedMomentId).toBe('moment-terrace')
      expect(plan.timeline[1].selectedMomentId).toBe('moment-sunset')
      expect(plan.timeline[0].shotId).toBe('shot-001')
      expect(plan.timeline[1].shotId).toBe('shot-001')
      expect(plan.transitions.map((transition) => [transition.fromClipId, transition.toClipId])).toEqual([
        ['intro', 'clip-semantic-block-anchor-1'],
        ['clip-semantic-block-anchor-1', 'clip-semantic-block-anchor-2'],
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

    it('stores absolute trimEndSec for non-moment clips that are shortened to fit the plan', () => {
      const project = {
        id: 'test-project',
        name: 'Test',
        shots: [
          makeShot({ id: 'shot-001', order: 0, scene: 'Фасад', duration: 5, videoFile: 'shots/shot-001.mp4' }),
          makeShot({ id: 'shot-002', order: 1, scene: 'Терраса', duration: 5, videoFile: 'shots/shot-002.mp4' }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
      } as unknown as Project

      const plan = generateMontagePlan(project, 6)

      expect(plan.timeline).toHaveLength(2)
      expect(plan.timeline[0].durationSec).toBe(3)
      expect(plan.timeline[0].trimStartSec).toBeUndefined()
      expect(plan.timeline[0].trimEndSec).toBe(3)
      expect(plan.timeline[1].durationSec).toBe(3)
      expect(plan.timeline[1].trimStartSec).toBeUndefined()
      expect(plan.timeline[1].trimEndSec).toBe(3)
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

    it('builds semantic timeline entries from raw anchor matches and keeps fallback approved shots', () => {
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
          targetDuration: 14,
        },
        script: 'Терраса с видом и дополнительный ракурс.',
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
            scene: 'Терраса с видом на город',
            duration: 6,
            videoFile: 'shots/shot-001.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с панорамным видом.',
              tags: ['терраса', 'вид'],
              matchHints: ['терраса с видом'],
              moments: [
                {
                  id: 'moment-terrace',
                  label: 'Терраса',
                  startSec: 0.5,
                  endSec: 3.5,
                  tags: ['терраса'],
                  summary: 'Терраса с видом на город.',
                },
              ],
            },
          }),
          makeShot({
            id: 'shot-002',
            order: 1,
            scene: 'Общий интерьер',
            duration: 5,
            videoFile: 'shots/shot-002.mp4',
            videoDescription: {
              version: 1,
              summary: 'Интерьерный общий план.',
              tags: ['интерьер'],
              matchHints: ['интерьер'],
              moments: [],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          {
            id: 'anchor-001',
            sourceText: 'Терраса с видом',
            label: 'Терраса',
            order: 0,
            intent: 'lifestyle',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-terrace',
            confidence: 0.96,
            status: 'matched',
            candidates: [
              {
                shotId: 'shot-001',
                momentId: 'moment-terrace',
                confidence: 0.96,
                reason: 'Сильное совпадение по террасе',
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

      const plan = generateMontagePlan(project, 14)

      expect(plan.semanticBlocks).toHaveLength(1)
      expect(plan.semanticBlocks?.[0].segments[0].reason).toContain('Сильное совпадение')
      expect(plan.timeline).toHaveLength(2)
      expect(plan.timeline.map((entry) => entry.shotId)).toEqual(['shot-001', 'shot-002'])
      expect(plan.timeline[0].semanticBlockId).toBe('semantic-block-anchor-001')
      expect(plan.timeline[1].semanticBlockId).toBeUndefined()
    })

    it('keeps one strong semantic block as solo', () => {
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
        script: 'Терраса с видом на город.',
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
            scene: 'Терраса с видом на город',
            duration: 6,
            videoFile: 'shots/shot-001.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с панорамным видом.',
              tags: ['терраса', 'вид'],
              matchHints: ['терраса с видом'],
              moments: [
                {
                  id: 'moment-terrace',
                  label: 'Терраса',
                  startSec: 0.5,
                  endSec: 3.5,
                  tags: ['терраса'],
                  summary: 'Терраса с видом на город.',
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
            sourceText: 'Терраса с видом',
            label: 'Терраса',
            order: 0,
            intent: 'lifestyle',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-001',
            selectedMomentId: 'moment-terrace',
            confidence: 0.96,
            status: 'matched',
            candidates: [],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 1,
          matchedAnchors: 1,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-001',
            anchorId: 'anchor-001',
            anchorText: 'Терраса с видом',
            anchorLabel: 'Терраса',
            strategy: 'solo',
            confidence: 0.96,
            segments: [
              {
                shotId: 'shot-001',
                momentId: 'moment-terrace',
                durationSec: 4,
                weight: 1,
                reason: 'Один сильный визуальный ракурс',
              },
            ],
          }),
        ],
      } satisfies Project

      const plan = generateMontagePlan(project, 12)

      const blockEntries = plan.timeline.filter((entry) => entry.semanticBlockId === 'semantic-block-001')

      expect(blockEntries).toHaveLength(1)
      expect(blockEntries[0]).toMatchObject({
        shotId: 'shot-001',
        selectedMomentId: 'moment-terrace',
      })
    })

    it('turns two strong distinct candidates into a pair or split block', () => {
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
          targetDuration: 16,
        },
        script: 'Терраса и закат.',
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
            id: 'shot-terrace',
            order: 0,
            scene: 'Терраса с видом на город',
            duration: 6,
            videoFile: 'shots/shot-terrace.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с видом на город.',
              tags: ['терраса', 'вид'],
              matchHints: ['терраса'],
              moments: [
                {
                  id: 'moment-terrace',
                  label: 'Терраса',
                  startSec: 0.5,
                  endSec: 3.0,
                  tags: ['терраса'],
                  summary: 'Терраса и вид на город.',
                },
              ],
            },
          }),
          makeShot({
            id: 'shot-sunset',
            order: 1,
            scene: 'Закат над городом',
            duration: 6,
            videoFile: 'shots/shot-sunset.mp4',
            videoDescription: {
              version: 1,
              summary: 'Закат и мягкий вечерний свет.',
              tags: ['закат', 'вечер'],
              matchHints: ['закат'],
              moments: [
                {
                  id: 'moment-sunset',
                  label: 'Закат',
                  startSec: 1,
                  endSec: 4,
                  tags: ['закат'],
                  summary: 'Закат над линией горизонта.',
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
            sourceText: 'Терраса и закат',
            label: 'Терраса и закат',
            order: 0,
            intent: 'feature',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-terrace',
            selectedMomentId: 'moment-terrace',
            confidence: 0.94,
            status: 'matched',
            candidates: [],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 1,
          matchedAnchors: 1,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-002',
            anchorId: 'anchor-001',
            anchorText: 'Терраса и закат',
            anchorLabel: 'Терраса и закат',
            strategy: 'pair',
            confidence: 0.91,
            segments: [
              {
                shotId: 'shot-terrace',
                momentId: 'moment-terrace',
                durationSec: 3,
                weight: 0.55,
                reason: 'Первый сильный ракурс блока',
              },
              {
                shotId: 'shot-sunset',
                momentId: 'moment-sunset',
                durationSec: 3,
                weight: 0.45,
                reason: 'Второй ракурс добавляет новый визуальный акцент',
              },
            ],
          }),
        ],
      } satisfies Project

      const plan = generateMontagePlan(project, 16)
      const blockEntries = plan.timeline.filter((entry) => entry.semanticBlockId === 'semantic-block-002')

      expect(blockEntries).toHaveLength(2)
      expect(blockEntries.map((entry) => entry.shotId)).toEqual(['shot-terrace', 'shot-sunset'])
    })

    it('rejects a weak second candidate instead of forcing a multi-clip block', () => {
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
          targetDuration: 16,
        },
        script: 'Терраса с видом.',
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
            id: 'shot-hero',
            order: 0,
            scene: 'Терраса с видом на город',
            duration: 6,
            videoFile: 'shots/shot-hero.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с видом на город.',
              tags: ['терраса', 'вид'],
              matchHints: ['терраса'],
              moments: [
                {
                  id: 'moment-hero',
                  label: 'Терраса',
                  startSec: 0.5,
                  endSec: 3.5,
                  tags: ['терраса'],
                  summary: 'Сильный визуальный ракурс террасы.',
                },
              ],
            },
          }),
          makeShot({
            id: 'shot-weak',
            order: 1,
            scene: 'Лобби и ресепшн',
            duration: 6,
            videoFile: 'shots/shot-weak.mp4',
            videoDescription: {
              version: 1,
              summary: 'Лобби и ресепшн.',
              tags: ['лобби'],
              matchHints: ['входная группа'],
              moments: [
                {
                  id: 'moment-weak',
                  label: 'Лобби',
                  startSec: 1,
                  endSec: 4,
                  tags: ['лобби'],
                  summary: 'Слабый вторичный ракурс без новой идеи.',
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
            sourceText: 'Терраса с видом',
            label: 'Терраса',
            order: 0,
            intent: 'lifestyle',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-hero',
            selectedMomentId: 'moment-hero',
            confidence: 0.9,
            status: 'matched',
            candidates: [],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 1,
          matchedAnchors: 1,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-003',
            anchorId: 'anchor-001',
            anchorText: 'Терраса с видом',
            anchorLabel: 'Терраса',
            strategy: 'solo',
            confidence: 0.9,
            segments: [
              {
                shotId: 'shot-hero',
                momentId: 'moment-hero',
                durationSec: 4,
                weight: 1,
                reason: 'Сильный основной ракурс',
              },
            ],
          }),
        ],
      } satisfies Project

      const plan = generateMontagePlan(project, 16)
      const blockEntries = plan.timeline.filter((entry) => entry.semanticBlockId === 'semantic-block-003')

      expect(blockEntries).toHaveLength(1)
      expect(blockEntries[0]?.shotId).toBe('shot-hero')
      expect(plan.timeline.map((entry) => entry.shotId)).toEqual(['shot-hero', 'shot-weak'])
      expect(plan.timeline[1]?.semanticBlockId).toBeUndefined()
    })

    it('caps a semantic block at three segments even when four strong candidates are available', () => {
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
          targetDuration: 20,
        },
        script: 'Фасад, терраса, лобби, двор.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Фасад комплекса',
            duration: 5,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Фасад комплекса.',
              tags: ['фасад'],
              matchHints: ['фасад'],
              moments: [
                { id: 'moment-1', label: 'Фасад', startSec: 0.5, endSec: 2.5, tags: ['фасад'], summary: 'Фасад с улицы.' },
              ],
            },
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Терраса',
            duration: 5,
            videoFile: 'shots/shot-2.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса.',
              tags: ['терраса'],
              matchHints: ['терраса'],
              moments: [
                { id: 'moment-2', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' },
              ],
            },
          }),
          makeShot({
            id: 'shot-3',
            order: 2,
            scene: 'Лобби',
            duration: 5,
            videoFile: 'shots/shot-3.mp4',
            videoDescription: {
              version: 1,
              summary: 'Лобби.',
              tags: ['лобби'],
              matchHints: ['лобби'],
              moments: [
                { id: 'moment-3', label: 'Лобби', startSec: 0.5, endSec: 2.5, tags: ['лобби'], summary: 'Входная зона.' },
              ],
            },
          }),
          makeShot({
            id: 'shot-4',
            order: 3,
            scene: 'Двор',
            duration: 5,
            videoFile: 'shots/shot-4.mp4',
            videoDescription: {
              version: 1,
              summary: 'Двор.',
              tags: ['двор'],
              matchHints: ['двор'],
              moments: [
                { id: 'moment-4', label: 'Двор', startSec: 0.5, endSec: 2.5, tags: ['двор'], summary: 'Дворовая территория.' },
              ],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          {
            id: 'anchor-001',
            sourceText: 'Фасад, терраса, лобби, двор',
            label: 'Комплекс',
            order: 0,
            intent: 'feature',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-1',
            selectedMomentId: 'moment-1',
            confidence: 0.95,
            status: 'matched',
            candidates: [],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 1,
          matchedAnchors: 1,
          weakMatches: 0,
          unmatchedAnchors: 0,
        },
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-004',
            anchorId: 'anchor-001',
            anchorText: 'Фасад, терраса, лобби, двор',
            anchorLabel: 'Комплекс',
            strategy: 'cascade',
            confidence: 0.88,
            segments: [
              {
                shotId: 'shot-1',
                momentId: 'moment-1',
                durationSec: 2,
                weight: 0.3,
                reason: 'Первый визуальный акцент',
              },
              {
                shotId: 'shot-2',
                momentId: 'moment-2',
                durationSec: 2,
                weight: 0.25,
                reason: 'Второй ракурс',
              },
              {
                shotId: 'shot-3',
                momentId: 'moment-3',
                durationSec: 2,
                weight: 0.25,
                reason: 'Третий ракурс',
              },
              {
                shotId: 'shot-4',
                momentId: 'moment-4',
                durationSec: 2,
                weight: 0.2,
                reason: 'Четвертый кандидат сверх лимита',
              },
            ],
          }),
        ],
      } satisfies Project

      const plan = generateMontagePlan(project, 20)
      const blockEntries = plan.timeline.filter((entry) => entry.semanticBlockId === 'semantic-block-004')

      expect(blockEntries).toHaveLength(3)
    })

    it('derives explanations and rejection reasons from raw anchor matches', () => {
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
          targetDuration: 20,
        },
        script: 'Фасад, терраса, лобби, двор.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Фасад комплекса',
            duration: 5,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Фасад комплекса.',
              tags: ['фасад'],
              matchHints: ['фасад'],
              moments: [{ id: 'moment-1', label: 'Фасад', startSec: 0.5, endSec: 2.5, tags: ['фасад'], summary: 'Фасад с улицы.' }],
            },
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Терраса',
            duration: 5,
            videoFile: 'shots/shot-2.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса.',
              tags: ['терраса'],
              matchHints: ['терраса'],
              moments: [{ id: 'moment-2', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' }],
            },
          }),
          makeShot({
            id: 'shot-3',
            order: 2,
            scene: 'Лобби',
            duration: 5,
            videoFile: 'shots/shot-3.mp4',
            videoDescription: {
              version: 1,
              summary: 'Лобби.',
              tags: ['лобби'],
              matchHints: ['лобби'],
              moments: [{ id: 'moment-3', label: 'Лобби', startSec: 0.5, endSec: 2.5, tags: ['лобби'], summary: 'Входная зона.' }],
            },
          }),
          makeShot({
            id: 'shot-4',
            order: 3,
            scene: 'Двор',
            duration: 5,
            videoFile: 'shots/shot-4.mp4',
            videoDescription: {
              version: 1,
              summary: 'Двор.',
              tags: ['двор'],
              matchHints: ['двор'],
              moments: [{ id: 'moment-4', label: 'Двор', startSec: 0.5, endSec: 2.5, tags: ['двор'], summary: 'Дворовая территория.' }],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-001',
            sourceText: 'Фасад, терраса, лобби, двор',
            label: 'Комплекс',
            order: 0,
            intent: 'feature',
          },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-001',
            selectedShotId: 'shot-1',
            selectedMomentId: 'moment-1',
            confidence: 0.95,
            status: 'matched',
            candidates: [
              { shotId: 'shot-1', momentId: 'moment-1', confidence: 0.95, reason: 'Первый сильный ракурс' },
              { shotId: 'shot-2', momentId: 'moment-2', confidence: 0.88, reason: 'Второй сильный ракурс' },
              { shotId: 'shot-3', momentId: 'moment-3', confidence: 0.8, reason: 'Третий сильный ракурс' },
              { shotId: 'shot-4', momentId: 'moment-4', confidence: 0.42, reason: 'Четвертый слабее и не нужен' },
            ],
          },
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].strategy).toBe('cascade')
      expect(blocks[0].segments).toHaveLength(3)
      expect(blocks[0].explanation?.join(' ')).toMatch(/3/i)
      expect(blocks[0].alternatives).toHaveLength(1)
      expect(blocks[0].alternatives?.[0]).toMatchObject({
        shotId: 'shot-4',
        rejectedBecause: expect.any(String),
      })
      expect(blocks[0].segments[0].reason).toMatch(/Первый сильный ракурс/)
    })

    it('reconciles block strategy with the normalized segment count', () => {
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
          targetDuration: 20,
        },
        script: 'Тестовый сценарий.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Фасад комплекса',
            duration: 5,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Фасад комплекса.',
              tags: ['фасад'],
              matchHints: ['фасад'],
              moments: [{ id: 'moment-1', label: 'Фасад', startSec: 0.5, endSec: 2.5, tags: ['фасад'], summary: 'Фасад с улицы.' }],
            },
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Терраса',
            duration: 5,
            videoFile: 'shots/shot-2.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса.',
              tags: ['терраса'],
              matchHints: ['терраса'],
              moments: [{ id: 'moment-2', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' }],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-001', sourceText: 'Фасад', label: 'Фасад', order: 0, intent: 'feature' },
        ],
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-001',
            anchorId: 'anchor-001',
            anchorText: 'Фасад',
            anchorLabel: 'Фасад',
            strategy: 'solo',
            confidence: 0.91,
            segments: [
              {
                shotId: 'shot-1',
                momentId: 'moment-1',
                durationSec: 3,
                weight: 0.6,
                reason: 'Первый ракурс',
              },
              {
                shotId: 'shot-2',
                momentId: 'moment-2',
                durationSec: 3,
                weight: 0.4,
                reason: 'Второй ракурс',
              },
            ],
          }),
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].strategy).toBe('pair')
    })

    it('drops near-duplicate segments from the same shot even with different moments', () => {
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
          targetDuration: 20,
        },
        script: 'Тестовый сценарий.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Терраса с видом на город',
            duration: 8,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с видом на город.',
              tags: ['терраса'],
              matchHints: ['терраса'],
              moments: [
                { id: 'moment-1', label: 'Начало', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Начало кадра террасы.' },
                { id: 'moment-2', label: 'Середина', startSec: 0.75, endSec: 2.75, tags: ['терраса'], summary: 'Почти тот же визуальный фрагмент.' },
                { id: 'moment-3', label: 'Другой ракурс', startSec: 5.2, endSec: 7.2, tags: ['терраса'], summary: 'Другой ракурс.' },
              ],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-001', sourceText: 'Терраса', label: 'Терраса', order: 0, intent: 'lifestyle' },
        ],
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-dup',
            anchorId: 'anchor-001',
            anchorText: 'Терраса',
            anchorLabel: 'Терраса',
            strategy: 'cascade',
            confidence: 0.95,
            segments: [
              {
                shotId: 'shot-1',
                momentId: 'moment-1',
                durationSec: 3,
                weight: 0.5,
                reason: 'Первый близкий фрагмент',
              },
              {
                shotId: 'shot-1',
                momentId: 'moment-2',
                durationSec: 3,
                weight: 0.5,
                reason: 'Почти тот же фрагмент',
              },
              {
                shotId: 'shot-1',
                momentId: 'moment-3',
                durationSec: 3,
                weight: 0.5,
                reason: 'Другой ракурс',
              },
            ],
          }),
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].segments).toHaveLength(2)
      expect(blocks[0].alternatives?.some((alternative) => alternative.momentId === 'moment-2')).toBe(true)
    })

    it('marks visual grounding explicitly in block explanations', () => {
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
        script: 'Терраса с видом.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Терраса',
            duration: 8,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с видом.',
              tags: ['терраса'],
              matchHints: ['терраса с видом'],
              moments: [
                { id: 'moment-1', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' },
              ],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-visual', sourceText: 'Терраса с видом', label: 'Терраса', order: 0, intent: 'lifestyle' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-visual',
            selectedShotId: 'shot-1',
            selectedMomentId: 'moment-1',
            confidence: 0.88,
            status: 'matched',
            candidates: [
              { shotId: 'shot-1', momentId: 'moment-1', confidence: 0.88, reason: 'Visual grounding' },
            ],
          },
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].explanation?.join(' ').toLowerCase()).toContain('визу')
    })

    it('prefers role diversity for the second segment when confidences are close', () => {
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
          targetDuration: 16,
        },
        script: 'Терраса и жизнь внутри.',
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
            id: 'shot-view-1',
            order: 0,
            scene: 'Терраса с видом на город',
            duration: 8,
            videoFile: 'shots/shot-view-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса с видом.',
              tags: ['терраса', 'панорамный вид'],
              matchHints: ['терраса с видом'],
              moments: [{ id: 'moment-view-1', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' }],
            },
          }),
          makeShot({
            id: 'shot-view-2',
            order: 1,
            scene: 'Панорамный вид на реку',
            duration: 8,
            videoFile: 'shots/shot-view-2.mp4',
            videoDescription: {
              version: 1,
              summary: 'Ещё один панорамный вид.',
              tags: ['вид', 'панорама'],
              matchHints: ['панорамный вид'],
              moments: [{ id: 'moment-view-2', label: 'Вид', startSec: 0.5, endSec: 2.5, tags: ['вид'], summary: 'Панорамный вид.' }],
            },
          }),
          makeShot({
            id: 'shot-interior',
            order: 2,
            scene: 'Гостиная с мягким светом',
            duration: 8,
            videoFile: 'shots/shot-interior.mp4',
            videoDescription: {
              version: 1,
              summary: 'Гостиная с мягким светом.',
              tags: ['гостиная', 'интерьер'],
              matchHints: ['уютный интерьер'],
              moments: [{ id: 'moment-interior', label: 'Гостиная', startSec: 0.5, endSec: 2.5, tags: ['интерьер'], summary: 'Уютная гостиная.' }],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-roles', sourceText: 'Терраса и жизнь внутри', label: 'Терраса', order: 0, intent: 'lifestyle' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-roles',
            selectedShotId: 'shot-view-1',
            selectedMomentId: 'moment-view-1',
            confidence: 0.93,
            status: 'matched',
            candidates: [
              { shotId: 'shot-view-1', momentId: 'moment-view-1', confidence: 0.93, reason: 'Visual grounding' },
              { shotId: 'shot-view-2', momentId: 'moment-view-2', confidence: 0.9, reason: 'Visual grounding' },
              { shotId: 'shot-interior', momentId: 'moment-interior', confidence: 0.84, reason: 'Visual grounding' },
            ],
          },
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].segments).toHaveLength(3)
      expect(blocks[0].segments[0].shotId).toBe('shot-view-1')
      expect(blocks[0].segments[1].shotId).toBe('shot-interior')
    })

    it('keeps atmospheric pairs montageable and labels them accordingly', () => {
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
          targetDuration: 16,
        },
        script: 'Я дома.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Гостиная в мягком свете',
            duration: 8,
            videoFile: 'shots/shot-1.mp4',
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Терраса вечером',
            duration: 8,
            videoFile: 'shots/shot-2.mp4',
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-home', sourceText: 'Я дома', label: 'Дом', order: 0, intent: 'lifestyle' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-home',
            selectedShotId: 'shot-1',
            confidence: 0.61,
            status: 'weak_match',
            candidates: [
              { shotId: 'shot-1', confidence: 0.61, reason: 'Atmospheric grounding' },
              { shotId: 'shot-2', confidence: 0.42, reason: 'Atmospheric grounding' },
            ],
          },
        ],
      } satisfies Project

      const blocks = buildSemanticBlocks(project)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].strategy).toBe('pair')
      expect(blocks[0].segments).toHaveLength(2)
      expect(blocks[0].explanation?.join(' ').toLowerCase()).toContain('атмос')
    })

    it('isolates fallback-only unresolved anchors instead of promoting them to semantic blocks', () => {
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
          targetDuration: 14,
        },
        script: 'Терраса. Атмосфера дома.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Терраса',
            duration: 8,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса.',
              tags: ['терраса'],
              matchHints: ['терраса с видом'],
              moments: [
                { id: 'moment-1', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса с видом.' },
              ],
            },
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Общий интерьер',
            duration: 8,
            videoFile: 'shots/shot-2.mp4',
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-visual', sourceText: 'Терраса', label: 'Терраса', order: 0, intent: 'feature' },
          { id: 'anchor-fallback', sourceText: 'Атмосфера дома', label: 'Дом', order: 1, intent: 'lifestyle' },
        ],
        anchorMatches: [
          {
            anchorId: 'anchor-visual',
            selectedShotId: 'shot-1',
            selectedMomentId: 'moment-1',
            confidence: 0.92,
            status: 'matched',
            candidates: [
              { shotId: 'shot-1', momentId: 'moment-1', confidence: 0.92, reason: 'Visual grounding' },
            ],
          },
          {
            anchorId: 'anchor-fallback',
            selectedShotId: 'shot-2',
            confidence: 0.38,
            status: 'weak_match',
            candidates: [
              { shotId: 'shot-2', confidence: 0.38, reason: 'Fallback grounding' },
            ],
          },
        ],
        anchorCoverageSummary: {
          totalAnchors: 2,
          matchedAnchors: 1,
          weakMatches: 1,
          unmatchedAnchors: 0,
        },
      } satisfies Project

      const blocks = buildSemanticBlocks(project)
      const plan = generateMontagePlan(project, 14)

      expect(blocks.map((block) => block.anchorId)).toEqual(['anchor-visual'])
      expect(plan.timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            shotId: 'shot-2',
            semanticBlockId: undefined,
          }),
        ]),
      )
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

    it('uses semantic segment pacing to vary clip duration', () => {
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
          targetDuration: 20,
        },
        script: 'Терраса и общий вид.',
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
            id: 'shot-1',
            order: 0,
            scene: 'Терраса',
            duration: 10,
            videoFile: 'shots/shot-1.mp4',
            videoDescription: {
              version: 1,
              summary: 'Терраса.',
              tags: ['терраса'],
              matchHints: ['терраса'],
              moments: [{ id: 'moment-1', label: 'Терраса', startSec: 0.5, endSec: 2.5, tags: ['терраса'], summary: 'Терраса.' }],
            },
          }),
          makeShot({
            id: 'shot-2',
            order: 1,
            scene: 'Общий вид',
            duration: 10,
            videoFile: 'shots/shot-2.mp4',
            videoDescription: {
              version: 1,
              summary: 'Общий вид.',
              tags: ['вид'],
              matchHints: ['вид'],
              moments: [{ id: 'moment-2', label: 'Общий вид', startSec: 0.5, endSec: 2.5, tags: ['вид'], summary: 'Общий вид.' }],
            },
          }),
        ],
        voiceoverFile: 'montage/voiceover.mp3',
        musicFile: 'montage/music.mp3',
        narrationAnchors: [
          { id: 'anchor-001', sourceText: 'Терраса и общий вид', label: 'Терраса и общий вид', order: 0, intent: 'feature' },
        ],
        semanticBlocks: [
          makeSemanticBlock({
            id: 'semantic-block-pace',
            anchorId: 'anchor-001',
            anchorText: 'Терраса и общий вид',
            anchorLabel: 'Терраса и общий вид',
            strategy: 'pair',
            confidence: 0.93,
            segments: [
              {
                shotId: 'shot-1',
                momentId: 'moment-1',
                durationSec: 3,
                weight: 0.15,
                reason: 'Короткий акцент',
              },
              {
                shotId: 'shot-2',
                momentId: 'moment-2',
                durationSec: 8,
                weight: 0.85,
                reason: 'Длинный акцент',
              },
            ],
          }),
        ],
      } satisfies Project

      const plan = generateMontagePlan(project, 20)
      const blockEntries = plan.timeline.filter((entry) => entry.semanticBlockId === 'semantic-block-pace')

      expect(blockEntries).toHaveLength(2)
      expect(blockEntries[0].durationSec).toBeLessThan(blockEntries[1].durationSec)
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
    let compareScoredCandidates: typeof import('../../server/lib/montage-anchor-matching.js').compareScoredCandidates

    beforeEach(async () => {
      const mod = await import('../../server/lib/' + 'montage-anchor-matching.js') as {
        matchNarrationAnchors: typeof matchNarrationAnchors
        compareScoredCandidates: typeof compareScoredCandidates
      }
      matchNarrationAnchors = mod.matchNarrationAnchors
      compareScoredCandidates = mod.compareScoredCandidates
    })

    it('keeps class precedence stable when scores tie', () => {
      const directCandidate = {
        shotId: 'shot-direct',
        momentId: undefined,
        confidence: 0.58,
        reason: 'direct',
        score: 0.58,
        matchClass: 'direct' as const,
      }
      const visualCandidate = {
        shotId: 'shot-visual',
        momentId: undefined,
        confidence: 0.58,
        reason: 'visual',
        score: 0.58,
        matchClass: 'visual' as const,
      }
      const atmosphericCandidate = {
        shotId: 'shot-atmospheric',
        momentId: undefined,
        confidence: 0.58,
        reason: 'atmospheric',
        score: 0.58,
        matchClass: 'atmospheric' as const,
      }

      expect(compareScoredCandidates(directCandidate, visualCandidate)).toBeLessThan(0)
      expect(compareScoredCandidates(visualCandidate, atmosphericCandidate)).toBeLessThan(0)
      expect([visualCandidate, atmosphericCandidate, directCandidate].sort(compareScoredCandidates)).toEqual([
        directCandidate,
        visualCandidate,
        atmosphericCandidate,
      ])
    })

    it('prefers a literal match over visual and fallback candidates', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-literal',
            order: 0,
            scene: 'Кухня с мраморным островом и высоким потолком',
            videoDescription: {
              version: 1,
              summary: 'Кухня с мраморным островом и высоким потолком.',
              tags: ['кухня'],
              matchHints: ['кухня с мраморным островом'],
              moments: [],
            },
          }),
          makeShot({
            id: 'shot-visual',
            order: 1,
            scene: 'Кухня с барной стойкой',
            videoDescription: {
              version: 1,
              summary: 'Современная кухня с барной стойкой и мягким светом.',
              tags: ['кухня', 'мрамор'],
              matchHints: ['барная стойка'],
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
        selectedShotId: 'shot-literal',
        status: 'matched',
      })
      expect(result.anchorMatches[0].candidates[0]).toMatchObject({
        shotId: 'shot-literal',
      })
      expect(result.anchorMatches[0].candidates[0].reason).toMatch(/literal/i)
      expect(result.anchorMatches[0].candidates[1]).toMatchObject({
        shotId: 'shot-visual',
      })
      expect(result.anchorMatches[0].candidates[0].confidence).toBeGreaterThan(result.anchorMatches[0].candidates[1].confidence)
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      })
    })

    it('lets a visual candidate beat a weak literal fallback', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-weak-literal',
            order: 0,
            scene: 'Домашняя зона отдыха',
          }),
          makeShot({
            id: 'shot-visual',
            order: 1,
            scene: 'Уютная гостиная',
            videoDescription: {
              version: 1,
              summary: 'Уютная гостиная с теплым светом и спокойной атмосферой.',
              tags: ['уютный интерьер'],
              matchHints: ['уютный интерьер'],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Домашняя зона отдыха',
            label: 'Домашняя зона',
            order: 1,
            intent: 'lifestyle',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-visual',
        status: 'matched',
      })
      expect(result.anchorMatches[0].candidates[0]?.reason).toMatch(/visual/i)
      expect(result.anchorMatches[0].candidates[1]?.shotId).toBe('shot-weak-literal')
      expect(result.anchorMatches[0].candidates[0].confidence).toBeGreaterThan(result.anchorMatches[0].candidates[1].confidence)
    })

    it('resolves emotional lines into an atmospheric weak match instead of unmatched', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-atmospheric',
            order: 0,
            scene: 'Тихая вечерняя сцена',
            videoDescription: {
              version: 1,
              summary: 'Тихая атмосфера и спокойствие.',
              tags: ['спокойствие'],
              matchHints: [],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Я дома, всё спокойно',
            label: 'Дома',
            order: 1,
            intent: 'lifestyle',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-atmospheric',
        status: 'weak_match',
      })
      expect(result.anchorMatches[0].candidates[0]?.reason).toMatch(/atmospheric/i)
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 0,
        weakMatches: 1,
        unmatchedAnchors: 0,
      })
    })

    it('keeps generic view shots below useful visual candidates', () => {
      const project = {
        id: 'test-project',
        name: 'Anchor matching',
        shots: [
          makeShot({
            id: 'shot-generic',
            order: 0,
            scene: 'Общий вид',
            videoDescription: {
              version: 1,
              summary: 'Общий вид комплекса.',
              tags: ['вид'],
              matchHints: ['вид'],
              moments: [],
            },
          }),
          makeShot({
            id: 'shot-visual',
            order: 1,
            scene: 'Терраса с видом на город',
            videoDescription: {
              version: 1,
              summary: 'Терраса с панорамным видом на город.',
              tags: ['терраса', 'панорамный вид'],
              matchHints: ['терраса с видом'],
              moments: [],
            },
          }),
        ],
        narrationAnchors: [
          {
            id: 'anchor-1',
            sourceText: 'Терраса с видом',
            label: 'Терраса',
            order: 1,
            intent: 'lifestyle',
          },
        ],
      } as unknown as Project

      const result = matchNarrationAnchors(project)

      expect(result.anchorMatches[0]).toMatchObject({
        anchorId: 'anchor-1',
        selectedShotId: 'shot-visual',
        status: 'matched',
      })
      expect(result.anchorMatches[0].candidates[0]?.shotId).toBe('shot-visual')
      expect(result.anchorMatches[0].candidates[1]?.shotId).toBe('shot-generic')
      expect(result.anchorMatches[0].candidates[0].confidence).toBeGreaterThan(result.anchorMatches[0].candidates[1].confidence)
      expect(result.anchorCoverageSummary).toEqual({
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      })
    })
  })
})
