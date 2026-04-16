import { describe, expect, it } from 'vitest'
import { extractScriptBlocks } from '../../server/lib/script-blocks.js'

describe('extractScriptBlocks', () => {
  it('prefers voiceoverScript when available', () => {
    const blocks = extractScriptBlocks({
      script: 'Сценарий проекта.',
      voiceoverScript: 'Первая фраза. Вторая фраза.',
    })

    expect(blocks.map((block) => block.sourceText)).toEqual([
      'Первая фраза.',
      'Вторая фраза.',
    ])
  })

  it('falls back to script when voiceoverScript is missing', () => {
    const blocks = extractScriptBlocks({
      script: '  Первая строка.  Вторая строка.  ',
      voiceoverScript: '   ',
    })

    expect(blocks.map((block) => block.sourceText)).toEqual([
      'Первая строка.',
      'Вторая строка.',
    ])
    expect(blocks.map((block) => block.id)).toEqual([
      'script-block-1',
      'script-block-2',
    ])
  })

  it('preserves order and assigns stable coarse intents', () => {
    const blocks = extractScriptBlocks({
      script: 'Открытие ролика. Вторая мысль. Финальный акцент.',
    })

    expect(blocks.map((block) => block.order)).toEqual([1, 2, 3])
    expect(blocks.map((block) => block.intent)).toEqual([
      'hook',
      'feature',
      'cta',
    ])
  })

  it('keeps decimal-style punctuation inside the same block', () => {
    const blocks = extractScriptBlocks({
      script: 'Площадь 1.2 млн. Финальный акцент.',
    })

    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.sourceText).toContain('1.2')
    expect(blocks.map((block) => block.sourceText)).toEqual([
      'Площадь 1.2 млн.',
      'Финальный акцент.',
    ])
  })
})
