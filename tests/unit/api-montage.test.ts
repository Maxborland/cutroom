import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/lib/api'
import type {
  GroundedMatchClass,
  GroundedScriptBlock,
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
    } satisfies Awaited<ReturnType<(typeof api.montage)['assembleDraft']>>

    expect(assembledDraftResponse.summary.directBlocks).toBe(1)
    expect(assembledDraftResponse.summary.groundedBlocks?.[0].id).toBe(sampleScriptBlock.id)
    expect(assembledDraftResponse.summary.groundedBlocks?.[0].grounding.fallbackMode).toBe('atmospheric_broll')
    expect(assembledDraftResponse.summary.visualBlocks).toBe(1)
    expect(sampleGroundedMatchClass).toBe('visual')
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
