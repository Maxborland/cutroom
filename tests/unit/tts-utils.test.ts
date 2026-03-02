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

  it('converts known stage directions in parentheses to ElevenLabs break tags', () => {
    const input = 'Светлая гостиная (пауза) с панорамой на парк.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('Светлая гостиная <break time="600ms"/> с панорамой на парк.')
  })

  it('converts known stage directions in brackets to ElevenLabs break tags', () => {
    const input = 'Премиальная кухня [длинная пауза] с островом.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toBe('Премиальная кухня <break time="1.5s"/> с островом.')
  })

  it('keeps unknown stage directions as-is', () => {
    const input = 'Светлая гостиная (тише) с панорамой на парк.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toContain('(тише)')
  })

  it('adds extra expressiveness on pass=2 compared to pass=1', () => {
    const input = 'Вы готовы? Поехали!'

    const pass1 = normalizeVoiceoverText(input, { pass: 1 })
    const pass2 = normalizeVoiceoverText(input, { pass: 2 })

    expect(pass1).toBe('Вы готовы? Поехали!')
    expect(pass2).toBe('Вы готовы?<break time="300ms"/> Поехали!<break time="200ms"/>')
    expect(pass2).not.toBe(pass1)
  })

  it('uses plain-text pauses for kokoro provider instead of XML break tags', () => {
    const input = 'Поехали! (пауза)'

    const normalized = normalizeVoiceoverText(input, { provider: 'kokoro', pass: 2 })

    expect(normalized).not.toContain('<break')
    expect(normalized).toContain('...')
    expect(normalized).toContain(',')
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

  it('preserves dates and version-like patterns', () => {
    const input = 'Проект сдан 01.02.2025, версия 2.1.3 этапа.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toContain('01.02.2025')
    expect(normalized).toContain('2.1.3')
  })

  it('handles negative numbers with sign', () => {
    const input = 'Парковка на -1 этаже, температура -5 градусов.'

    const normalized = normalizeVoiceoverText(input)

    expect(normalized).toContain('минус один')
    expect(normalized).toContain('минус пять')
    expect(normalized).not.toContain('-1')
    expect(normalized).not.toContain('-5')
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
