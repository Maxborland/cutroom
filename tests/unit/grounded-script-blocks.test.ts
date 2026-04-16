import { describe, expect, it } from 'vitest'
import type { ScriptBlock } from '../../src/types'

describe('grounded script blocks', () => {
  it('derives literal, visual, and mood grounding for emotional homecoming copy', async () => {
    const { groundScriptBlock } = await import('../../server/lib/grounded-script-blocks.js')

    const block: ScriptBlock = {
      id: 'script-block-1',
      order: 1,
      sourceText: 'Вы впервые чувствуете: я дома.',
      intent: 'lifestyle',
    }

    const grounded = groundScriptBlock(block)

    expect(grounded.id).toBe(block.id)
    expect(grounded.grounding.literalQuery).toBe('Вы впервые чувствуете: я дома.')
    expect(grounded.grounding.visualQueries.length).toBeGreaterThanOrEqual(2)
    expect(grounded.grounding.visualQueries).toEqual(
      expect.arrayContaining(['уютный интерьер', 'теплый свет']),
    )
    expect(grounded.grounding.moodQueries).toEqual(
      expect.arrayContaining(['уют', 'спокойствие']),
    )
    expect(grounded.grounding.fallbackMode).toBe('atmospheric_broll')
  })

  it('grounds multiple blocks deterministically', async () => {
    const { groundScriptBlock } = await import('../../server/lib/grounded-script-blocks.js')

    const blocks = [
      {
        id: 'script-block-1',
        order: 1,
        sourceText: 'Общий вид проекта.',
        intent: 'hook',
      },
      {
        id: 'script-block-2',
        order: 2,
        sourceText: 'Планировка и детали интерьера.',
        intent: 'feature',
      },
      {
        id: 'script-block-3',
        order: 3,
        sourceText: 'Финальный акцент и бренд.',
        intent: 'cta',
      },
    ]
    const firstRun = blocks.map((block) => groundScriptBlock(block))
    const secondRun = blocks.map((block) => groundScriptBlock(block))

    expect(firstRun).toEqual(secondRun)
    expect(firstRun.map((block) => block.id)).toEqual(['script-block-1', 'script-block-2', 'script-block-3'])
    expect(firstRun[0]?.grounding.fallbackMode).toBe('visual_ok')
    expect(firstRun[0]?.grounding.visualQueries).not.toEqual(
      expect.arrayContaining(['терраса', 'панорамный вид']),
    )
    expect(firstRun[1]?.grounding.fallbackMode).toBe('direct_only')
    expect(firstRun[2]?.grounding.fallbackMode).toBe('visual_ok')
    expect(firstRun[2]?.grounding.visualQueries).toEqual(
      expect.arrayContaining(['финальный вид', 'брендовый завершающий кадр']),
    )
  })
})
