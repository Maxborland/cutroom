import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/lib/api'
import type {
  GroundedMatchClass,
  GroundedScriptBlock,
  MontageAutoFix,
  MontageReview,
  MontageReviewIssue,
  MontageShotRequest,
  ScriptBlock,
} from '../../src/types'

const sampleScriptBlock = {
  id: 'script-block-1',
  order: 1,
  sourceText: 'Сценарий о спокойном вечере',
  intent: 'atmosphere',
} satisfies ScriptBlock

const sampleGroundedBlock = {
  id: sampleScriptBlock.id,
  sourceText: sampleScriptBlock.sourceText,
  intent: sampleScriptBlock.intent,
  grounding: {
    literalQuery: 'спокойный вечер',
    visualQueries: ['вечерний свет', 'уютный интерьер'],
    moodQueries: ['уют', 'спокойствие'],
    fallbackMode: 'atmospheric_broll',
  },
  summary: 'Атмосферный блок для вечернего настроения',
} satisfies GroundedScriptBlock

const sampleAssemblySummary = {
  directBlocks: 1,
  visualBlocks: 1,
  atmosphericBlocks: 1,
  unresolvedBlocks: 0,
  blocks: 1,
  clips: 2,
  issues: ['ok'],
  steps: [],
  groundedBlocks: [sampleGroundedBlock],
} satisfies Awaited<ReturnType<(typeof api.montage)['assembleDraft']>>['summary']

const sampleGroundedMatchClass: GroundedMatchClass = 'visual'

const sampleMontageReviewIssue = {
  id: 'issue-1',
  type: 'asset_overuse',
  severity: 'medium',
  clipIds: ['clip-1'],
  message: 'Один и тот же кадр используется слишком близко к предыдущему повтору.',
  suggestedAction: 'Разнести повтор дальше по таймлайну.',
} satisfies MontageReviewIssue

const sampleMontageAutoFix = {
  id: 'autofix-1',
  type: 'move_repeat',
  applied: true,
  affectedClipIds: ['clip-1'],
  explanation: 'Повторный клип был перенесён дальше, чтобы уменьшить визуальную однообразность.',
} satisfies MontageAutoFix

const sampleMontageShotRequest = {
  id: 'request-1',
  blockId: sampleScriptBlock.id,
  priority: 'recommended',
  neededVisualRole: 'interior_detail',
  shotGoal: 'Добавить более свежий интерьерный ракурс для вечернего блока.',
  promptHints: ['warm light', 'premium interior', 'tactile materials'],
  recommendedCount: 2,
  canUseImageOnly: false,
} satisfies MontageShotRequest

const sampleMontageReview = {
  score: 0.78,
  summary: {
    issues: 1,
    autoFixes: 1,
    blockingRequests: 1,
  },
  issues: [sampleMontageReviewIssue],
  autoFixes: [sampleMontageAutoFix],
  suggestedShotRequests: [sampleMontageShotRequest],
} satisfies MontageReview

describe('api.montage contract', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ montagePlan: { version: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes grounded montage contract types', () => {
    const assembledDraftResponse = {
      montagePlan: { version: 1 },
      summary: sampleAssemblySummary,
      montageReview: sampleMontageReview,
    } satisfies Awaited<ReturnType<(typeof api.montage)['assembleDraft']>>

    expect(assembledDraftResponse.summary.directBlocks).toBe(1)
    expect(assembledDraftResponse.summary.groundedBlocks?.[0].id).toBe(sampleScriptBlock.id)
    expect(assembledDraftResponse.summary.groundedBlocks?.[0].grounding.fallbackMode).toBe('atmospheric_broll')
    expect(assembledDraftResponse.summary.visualBlocks).toBe(1)
    expect(sampleGroundedMatchClass).toBe('visual')
    expect(assembledDraftResponse.montageReview.issues[0].type).toBe('asset_overuse')
    expect(assembledDraftResponse.montageReview.autoFixes[0].type).toBe('move_repeat')
    expect(assembledDraftResponse.montageReview.suggestedShotRequests[0].neededVisualRole).toBe('interior_detail')
  })

  it('updates a timeline entry by clipId', async () => {
    await api.montage.updateTimelineEntry('project-1', 'clip-anchor-2', {
      durationSec: 8,
      trimEndSec: 3.5,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/montage/plan/timeline/clip-anchor-2',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          durationSec: 8,
          trimEndSec: 3.5,
        }),
        credentials: 'include',
      }),
    )
  })

  it('assembles a semantic draft in one call', async () => {
    const montageApi = api.montage as unknown as {
      assembleDraft: (projectId: string) => Promise<unknown>
    }

    await montageApi.assembleDraft('project-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/montage/assemble-draft',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    )
  })
})
