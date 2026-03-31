import type { Project, ScriptBlock } from './storage.js'

function pickScriptSource(project: Pick<Project, 'script' | 'voiceoverScript'>): string {
  const voiceoverScript = project.voiceoverScript?.trim()
  if (voiceoverScript) {
    return voiceoverScript
  }

  return project.script?.trim() || ''
}

function splitScriptIntoBlocks(text: string): string[] {
  const normalized = text.trim()
  if (!normalized) {
    return []
  }

  // Preserve decimal/version-style dots so punctuation inside numbers stays in the same block.
  const blocks = normalized.match(/(?:[^.!?]|\.(?=\d))+[.!?]*/g) ?? [normalized]

  return blocks
    .map((part) => part.trim())
    .filter(Boolean)
}

function deriveBlockIntent(index: number, total: number): ScriptBlock['intent'] {
  if (total <= 1) {
    return 'hook'
  }

  if (index === 0) {
    return 'hook'
  }

  if (index === total - 1) {
    return 'cta'
  }

  return 'feature'
}

function buildScriptBlocksFromText(text: string): ScriptBlock[] {
  const parts = splitScriptIntoBlocks(text)

  return parts.map((part, index) => ({
    id: `script-block-${index + 1}`,
    order: index + 1,
    sourceText: part,
    intent: deriveBlockIntent(index, parts.length),
  }))
}

// Grounding layers consume these plain script blocks downstream.
export function extractScriptBlocks(project: Pick<Project, 'script' | 'voiceoverScript'>): ScriptBlock[] {
  const sourceText = pickScriptSource(project)
  return buildScriptBlocksFromText(sourceText)
}
