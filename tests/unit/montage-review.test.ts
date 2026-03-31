import { describe, expect, it } from 'vitest'
import type { MontagePlan, Project, ShotMeta } from '../../server/lib/storage.js'
import { reviewMontageDraft } from '../../server/lib/montage-review.js'

function makeShot(overrides: Partial<ShotMeta>): ShotMeta {
  return {
    id: overrides.id ?? 'shot-1',
    order: overrides.order ?? 0,
    scene: overrides.scene ?? 'Сцена',
    audioDescription: overrides.audioDescription ?? '',
    imagePrompt: overrides.imagePrompt ?? '',
    videoPrompt: overrides.videoPrompt ?? '',
    duration: overrides.duration ?? 6,
    assetRefs: overrides.assetRefs ?? [],
    status: overrides.status ?? 'approved',
    generatedImages: overrides.generatedImages ?? [],
    enhancedImages: overrides.enhancedImages ?? [],
    selectedImage: overrides.selectedImage ?? null,
    videoFile: overrides.videoFile ?? `shots/${overrides.id ?? 'shot-1'}.mp4`,
    videoDescription: overrides.videoDescription,
  }
}

function makeProject(shots: ShotMeta[]): Project {
  return {
    id: 'project-1',
    name: 'Review Test Project',
    created: '2026-03-31T00:00:00.000Z',
    updated: '2026-03-31T00:00:00.000Z',
    stage: 'montage_draft',
    settings: {
      scriptwriterPrompt: '',
      shotSplitterPrompt: '',
      model: '',
      temperature: 0,
    },
    brief: {
      text: '',
      assets: [],
      targetDuration: 30,
    },
    script: 'Сценарий',
    shots,
  }
}

function makePlan(entries: Array<{ shotId: string; startSec: number; durationSec: number; clipFile?: string }>): MontagePlan {
  return {
    version: 1,
    format: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline: entries.map((entry) => ({
      shotId: entry.shotId,
      clipFile: entry.clipFile ?? `montage/normalized/${entry.shotId}.mp4`,
      startSec: entry.startSec,
      durationSec: entry.durationSec,
    })),
    transitions: [],
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

describe('reviewMontageDraft', () => {
  it('detects close reuse of the same shot as asset_overuse', () => {
    const project = makeProject([
      makeShot({ id: 'shot-1', order: 0, scene: 'Фасад', duration: 6 }),
      makeShot({ id: 'shot-2', order: 1, scene: 'Терраса', duration: 6 }),
    ])
    const plan = makePlan([
      { shotId: 'shot-1', startSec: 0, durationSec: 4 },
      { shotId: 'shot-2', startSec: 4, durationSec: 4 },
      { shotId: 'shot-1', startSec: 8, durationSec: 4 },
    ])

    const review = reviewMontageDraft(project, plan)

    expect(review.issues.some((issue) => issue.type === 'asset_overuse')).toBe(true)
    expect(review.summary.issues).toBeGreaterThan(0)
  })

  it('detects consecutive same-role clips as visual_repetition', () => {
    const project = makeProject([
      makeShot({
        id: 'shot-view-1',
        order: 0,
        scene: 'Терраса у воды вечером',
        duration: 5,
        videoDescription: { summary: '', tags: ['view'], matchHints: [], moments: [] },
      }),
      makeShot({
        id: 'shot-view-2',
        order: 1,
        scene: 'Панорама на реку с другого ракурса',
        duration: 5,
        videoDescription: { summary: '', tags: ['view'], matchHints: [], moments: [] },
      }),
      makeShot({
        id: 'shot-detail',
        order: 2,
        scene: 'Крупная деталь света',
        duration: 5,
        videoDescription: { summary: '', tags: ['detail'], matchHints: [], moments: [] },
      }),
    ])
    const plan = makePlan([
      { shotId: 'shot-view-1', startSec: 0, durationSec: 4 },
      { shotId: 'shot-view-2', startSec: 4, durationSec: 4 },
      { shotId: 'shot-detail', startSec: 8, durationSec: 4 },
    ])

    const review = reviewMontageDraft(project, plan)

    expect(review.issues.some((issue) => issue.type === 'visual_repetition')).toBe(true)
  })

  it('detects visually repetitive adjacent clips even without explicit role labels', () => {
    const project = makeProject([
      makeShot({ id: 'shot-view-1', order: 0, scene: 'Терраса у воды вечером', duration: 5 }),
      makeShot({ id: 'shot-view-2', order: 1, scene: 'Терраса у воды на закате', duration: 5 }),
      makeShot({ id: 'shot-detail', order: 2, scene: 'Крупная деталь света', duration: 5 }),
    ])
    const plan = makePlan([
      { shotId: 'shot-view-1', startSec: 0, durationSec: 4 },
      { shotId: 'shot-view-2', startSec: 4, durationSec: 4 },
      { shotId: 'shot-detail', startSec: 8, durationSec: 4 },
    ])

    const review = reviewMontageDraft(project, plan)

    expect(review.issues.some((issue) => issue.type === 'visual_repetition')).toBe(true)
  })

  it('handles legacy video descriptions without moments arrays', () => {
    const project = makeProject([
      makeShot({
        id: 'shot-legacy-1',
        order: 0,
        scene: 'Legacy view angle',
        duration: 5,
        videoDescription: { summary: 'Legacy view angle', tags: [], matchHints: [] } as ShotMeta['videoDescription'],
      }),
      makeShot({
        id: 'shot-legacy-2',
        order: 1,
        scene: 'Legacy view panorama',
        duration: 5,
        videoDescription: { summary: 'Legacy view panorama', tags: [], matchHints: [] } as ShotMeta['videoDescription'],
      }),
    ])
    const plan = makePlan([
      { shotId: 'shot-legacy-1', startSec: 0, durationSec: 4 },
      { shotId: 'shot-legacy-2', startSec: 4, durationSec: 4 },
    ])

    expect(() => reviewMontageDraft(project, plan)).not.toThrow()
  })

  it('detects a long single-shot block as pacing_drag', () => {
    const project = makeProject([
      makeShot({ id: 'shot-long', order: 0, scene: 'Гостиная', duration: 14 }),
    ])
    const plan = makePlan([
      { shotId: 'shot-long', startSec: 0, durationSec: 14 },
    ])

    const review = reviewMontageDraft(project, plan)

    expect(review.issues.some((issue) => issue.type === 'pacing_drag')).toBe(true)
    expect(review.issues.find((issue) => issue.type === 'pacing_drag')?.clipIds).toContain('clip-shot-long')
  })
})
