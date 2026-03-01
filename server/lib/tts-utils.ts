const ABBREVIATION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(?<!\p{L})кв\.\s*м\.(?!\p{L})/giu, replacement: 'квадратных метров' },
  { pattern: /(?<!\p{L})ул\.(?!\p{L})/giu, replacement: 'улица' },
  { pattern: /(?<!\p{L})д\.(?!\p{L})/giu, replacement: 'дом' },
  { pattern: /(?<!\p{L})пр\.(?!\p{L})/giu, replacement: 'проспект' },
  { pattern: /(?<!\p{L})пос\.(?!\p{L})/giu, replacement: 'поселок' },
]

const ONES_MALE = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const ONES_FEMALE = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

const SCALES: Array<{ value: number; forms: [string, string, string]; female: boolean }> = [
  { value: 1_000_000_000, forms: ['миллиард', 'миллиарда', 'миллиардов'], female: false },
  { value: 1_000_000, forms: ['миллион', 'миллиона', 'миллионов'], female: false },
  { value: 1_000, forms: ['тысяча', 'тысячи', 'тысяч'], female: true },
]

// Matches standalone numbers with optional sign and one decimal separator.
// Lookbehind (?<!\d[.,]) and lookahead (?![.,]\d) prevent matching tokens
// inside dotted sequences like dates (01.02.2025) or versions (2.1.3).
const NUMBER_TOKEN = /(?<![\p{L}\p{N}_])(?<!\d[.,])(-?\d+(?:[.,]\d+)?)(?![.,]\d)(?![\p{L}\p{N}_])/gu

function removeStageDirections(text: string): string {
  let result = text
  let prev = ''

  while (result !== prev) {
    prev = result
    result = result
      .replace(/\[[^[\]]*\]/g, ' ')
      .replace(/\([^()]*\)/g, ' ')
  }

  return result
}

function expandAbbreviations(text: string): string {
  let result = text
  for (const rule of ABBREVIATION_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}

function normalizeDashes(text: string): string {
  return text.replace(/\s*[—–]+\s*/g, ', ')
}

function fixEllipsis(text: string): string {
  return text
    .replace(/(?:\.{3,}|…)(?=\s|$)/g, ',.')
    .replace(/(?:\.{3,}|…)/g, ', ')
}

function cleanupSpacing(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function pluralForm(num: number, forms: [string, string, string]): string {
  const n = Math.abs(num) % 100
  const n1 = n % 10

  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

function tripletToWords(num: number, female = false): string {
  if (num === 0) return ''

  const words: string[] = []
  const hundreds = Math.floor(num / 100)
  const remainder = num % 100

  if (hundreds > 0) {
    words.push(HUNDREDS[hundreds])
  }

  if (remainder >= 10 && remainder <= 19) {
    words.push(TEENS[remainder - 10])
  } else {
    const tens = Math.floor(remainder / 10)
    const ones = remainder % 10
    if (tens > 0) words.push(TENS[tens])
    if (ones > 0) words.push((female ? ONES_FEMALE : ONES_MALE)[ones])
  }

  return words.filter(Boolean).join(' ')
}

function numberToRussianWords(num: number): string {
  if (!Number.isFinite(num)) return String(num)
  if (num === 0) return 'ноль'
  if (Math.abs(num) > 999_999_999_999) return String(num)

  const parts: string[] = []
  let value = Math.floor(Math.abs(num))

  for (const scale of SCALES) {
    if (value < scale.value) continue
    const chunk = Math.floor(value / scale.value)
    value %= scale.value

    const words = tripletToWords(chunk, scale.female)
    if (words) {
      parts.push(words)
      parts.push(pluralForm(chunk, scale.forms))
    }
  }

  if (value > 0) {
    parts.push(tripletToWords(value))
  }

  const result = parts.join(' ').replace(/\s+/g, ' ').trim()
  return num < 0 ? `минус ${result}` : result
}

function decimalToRussianWords(raw: string): string {
  const [intPartRaw, fracPartRaw] = raw.split(/[.,]/)
  const intPart = Number.parseInt(intPartRaw, 10)

  if (!Number.isFinite(intPart) || !fracPartRaw) {
    return raw
  }

  const fracWords = fracPartRaw
    .split('')
    .map((digit) => numberToRussianWords(Number.parseInt(digit, 10)))
    .join(' ')

  return `${numberToRussianWords(intPart)} запятая ${fracWords}`
}

function looksLikeDateOrVersion(token: string): boolean {
  // Multiple separators: 01.02.2025, 1.2.3, 192.168.1.1
  const separatorCount = (token.match(/[.,]/g) || []).length;
  if (separatorCount > 1) return true;
  // Date-like: DD.MM.YYYY or YYYY.MM.DD (2-4 digits, dot, 2 digits, dot, 2-4 digits)
  if (/^\d{2,4}[.,]\d{2}[.,]\d{2,4}$/.test(token)) return true;
  return false;
}

function convertNumbersToWords(text: string): string {
  return text.replace(NUMBER_TOKEN, (token) => {
    // Skip dates, versions, IPs
    if (looksLikeDateOrVersion(token)) return token;

    // Handle sign prefix
    const negative = token.startsWith('-');
    const unsigned = negative ? token.slice(1) : token;

    if (unsigned.includes('.') || unsigned.includes(',')) {
      const words = decimalToRussianWords(unsigned);
      return negative ? `минус ${words}` : words;
    }

    const parsed = Number.parseInt(unsigned, 10);
    if (!Number.isFinite(parsed)) return token;
    return numberToRussianWords(negative ? -parsed : parsed);
  })
}

function splitLongSentence(sentence: string, maxLen = 200): string[] {
  const chunks: string[] = []
  let remaining = sentence.trim()

  while (remaining.length > maxLen) {
    const minBreak = Math.floor(maxLen * 0.6)
    const window = remaining.slice(0, maxLen)

    let breakAt = -1
    const pauseRe = /[,;:](?=\s|$)/g
    let match: RegExpExecArray | null
    while ((match = pauseRe.exec(window)) !== null) {
      if (match.index >= minBreak) {
        breakAt = match.index + 1
      }
    }

    if (breakAt < 0) {
      for (let i = Math.min(maxLen - 1, remaining.length - 1); i >= minBreak; i--) {
        if (remaining[i] === ' ') {
          breakAt = i
          break
        }
      }
    }

    if (breakAt < 0) {
      breakAt = maxLen
    }

    const head = remaining.slice(0, breakAt).trim()
    if (head) chunks.push(head)
    remaining = remaining.slice(breakAt).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

function splitLongSentences(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const processedParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    // Split on sentence-ending punctuation, but NOT dots inside dates/versions
    // (dot followed by a digit is part of a number, not a sentence boundary)
    const sentences = paragraph.match(/(?:[^.!?]|\.(?=\d))+[.!?]*/g) ?? [paragraph]
    const rebuiltParts: string[] = []

    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (!trimmed) continue

      if (trimmed.length > 200) {
        const splitChunks = splitLongSentence(trimmed, 200)
        const longSentenceBlock = splitChunks.join('\n\n')
        rebuiltParts.push(longSentenceBlock)
      } else {
        rebuiltParts.push(trimmed)
      }
    }

    processedParagraphs.push(rebuiltParts.join(' '))
  }

  return processedParagraphs.join('\n\n')
}

export function normalizeVoiceoverText(text: string): string {
  if (!text || typeof text !== 'string') return ''

  const trailingPunctuation = text.trim().match(/[.!?]$/)?.[0]

  let normalized = text
  normalized = removeStageDirections(normalized)
  normalized = expandAbbreviations(normalized)
  normalized = normalizeDashes(normalized)
  normalized = fixEllipsis(normalized)
  normalized = convertNumbersToWords(normalized)
  normalized = cleanupSpacing(normalized)
  normalized = splitLongSentences(normalized)
  normalized = cleanupSpacing(normalized)

  if (normalized && trailingPunctuation && !/[.!?]$/.test(normalized)) {
    normalized = `${normalized}${trailingPunctuation}`
  }

  return normalized
}
