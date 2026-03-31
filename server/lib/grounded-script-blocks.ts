import type { GroundedScriptBlock, GroundingPacket, ScriptBlock } from './storage.js'

const HOME_PATTERNS = ['я дома', 'дома', 'домаш']
const EVENING_PATTERNS = ['вечер', 'закат', 'золотом свете', 'теплом свете']
const TERRACE_PATTERNS = ['терраса', 'панорам']

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function hasPattern(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

function hasTerraceStyleView(text: string): boolean {
  return hasPattern(text, TERRACE_PATTERNS) || text.includes('вид на')
}

function inferFallbackMode(block: ScriptBlock): GroundingPacket['fallbackMode'] {
  // Intent drives the fallback mode; text only influences query expansion.
  if (block.intent === 'lifestyle') {
    return 'atmospheric_broll'
  }

  if (block.intent === 'hook' || block.intent === 'cta') {
    return 'visual_ok'
  }

  return 'direct_only'
}

function buildVisualQueries(block: ScriptBlock, normalizedText: string): string[] {
  const queries: string[] = [block.sourceText]

  if (hasPattern(normalizedText, HOME_PATTERNS)) {
    queries.push('уютный интерьер', 'теплый свет', 'гостиная')
  }

  if (hasPattern(normalizedText, EVENING_PATTERNS)) {
    queries.push('вечерний свет', 'закатный свет')
  }

  if (hasTerraceStyleView(normalizedText)) {
    queries.push('терраса', 'панорамный вид')
  }

  if (block.intent === 'hook') {
    queries.push('общий вид', 'сильный открывающий кадр')
  }

  if (block.intent === 'cta') {
    queries.push('финальный вид', 'брендовый завершающий кадр')
  }

  return unique(queries)
}

function buildMoodQueries(block: ScriptBlock, normalizedText: string): string[] {
  const queries: string[] = []

  if (hasPattern(normalizedText, HOME_PATTERNS)) {
    queries.push('уют', 'спокойствие', 'домашний комфорт')
  }

  if (hasPattern(normalizedText, EVENING_PATTERNS)) {
    queries.push('вечернее спокойствие', 'мягкая атмосфера')
  }

  if (block.intent === 'hook') {
    queries.push('впечатление', 'ожидание')
  } else if (block.intent === 'cta') {
    queries.push('завершение', 'уверенность')
  } else if (queries.length === 0) {
    queries.push('атмосфера сцены')
  }

  return unique(queries)
}

export function groundScriptBlock(block: ScriptBlock): GroundedScriptBlock {
  const normalizedText = normalizeText(block.sourceText)

  return {
    ...block,
    grounding: {
      literalQuery: block.sourceText,
      visualQueries: buildVisualQueries(block, normalizedText),
      moodQueries: buildMoodQueries(block, normalizedText),
      fallbackMode: inferFallbackMode(block),
    },
    summary: `Визуальное grounding для блока "${block.sourceText}"`,
  }
}
