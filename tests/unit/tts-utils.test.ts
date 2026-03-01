import { describe, expect, it } from 'vitest'
import { normalizeVoiceoverText } from '../../server/lib/tts-utils.js'

describe('normalizeVoiceoverText', () => {
  it('expands common Russian abbreviations used in real estate scripts', () => {
    const input = 'ул. Ленина, д. 8, пр. Мира, пос. Сосновый, 42 кв.м.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('улица Ленина, дом восемь, проспект Мира, поселок Сосновый, сорок два квадратных метров.')
  })

  it('converts numbers to Russian words', () => {
    const input = 'В доме 1 подъезд, 12 этажей и 125 квартир.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('В доме один подъезд, двенадцать этажей и сто двадцать пять квартир.')
  })

  it('removes stage directions in brackets and parentheses', () => {
    const input = 'Светлая гостиная [камера медленно едет] с панорамой (пауза) на парк.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('Светлая гостиная с панорамой на парк.')
  })

  it('normalizes dashes into comma pauses', () => {
    const input = 'Пространство — свет — воздух.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('Пространство, свет, воздух.')
  })

  it('replaces ellipsis with comma-pause + period', () => {
    const input = 'Тишина и комфорт... Панорама на реку...'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('Тишина и комфорт,. Панорама на реку,.')
    expect(normalized).not.toContain('...')
  })

  it('splits very long sentences into paragraph breaks', () => {
    const input = 'Этот комплекс расположен в тихом районе рядом с набережной, где каждое утро начинается с мягкого света и вида на воду, а вечером пространство наполняется теплым свечением города, и каждая деталь — от лобби до террасы — подчеркивает статус и комфорт будущих жителей без лишней вычурности.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toContain('\n\n')
    const chunks = normalized.split('\n\n').map((c) => c.trim()).filter(Boolean)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200)
    }
  })
})
