import type {
  MontageAutoFix,
  MontagePlan,
  MontageReview,
  MontageReviewIssue,
  MontageReviewSeverity,
  MontageShotRequest,
  MontageShotRequestPriority,
  MontageReviewIssueType,
  Project,
  ShotMeta,
} from './storage.js'
import { classifyVisualRole } from './semantic-block-planner.js'

interface TimelineClipContext {
  clipId: string
  shotId: string
  selectedMomentId?: string
  startSec: number
  durationSec: number
  endSec: number
  semanticBlockId?: string
  shot: ShotMeta
}

const ASSET_OVERUSE_GAP_SEC = 12
const PACE_DRAG_MIN_SEC = 10
const PACE_DRAG_MIN_SINGLE_SHOT_SEC = 9
const VISUAL_REPETITION_TOKEN_MIN_LENGTH = 3
const VISUAL_REPETITION_MIN_SHARED_TOKENS = 2
const VISUAL_REPETITION_STOPWORDS = new Set([
  'и',
  'в',
  'во',
  'на',
  'к',
  'ко',
  'с',
  'со',
  'у',
  'по',
  'от',
  'до',
  'из',
  'за',
  'для',
  'над',
  'под',
  'при',
  'через',
  'об',
  'о',
  'а',
  'но',
  'или',
  'то',
  'же',
  'ли',
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'at',
  'with',
  'for',
])

function normalizeText(value: string | undefined): string {
  return (value ?? '').toLowerCase()
}

function buildClipText(shot: ShotMeta): string {
  const momentText = (shot.videoDescription?.moments ?? [])
    .map((moment) => [moment.label, moment.summary, ...(moment.tags ?? [])].join(' '))
    .join(' ')

  return [
    shot.scene,
    shot.audioDescription,
    shot.imagePrompt,
    shot.videoPrompt,
    shot.videoDescription?.summary,
    ...(shot.videoDescription?.tags ?? []),
    ...(shot.videoDescription?.matchHints ?? []),
    momentText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
}

function getClipId(clip: Pick<TimelineClipContext, 'shotId'> & { clipId?: string }): string {
  return `clip-${clip.shotId}`
}

function severityForCount(count: number): MontageReviewSeverity {
  if (count >= 4) return 'high'
  if (count >= 2) return 'medium'
  return 'low'
}

function createIssue(
  type: MontageReviewIssueType,
  clipIds: string[],
  message: string,
  suggestedAction?: string,
): MontageReviewIssue {
  return {
    id: `${type}-${clipIds.join('-')}`,
    type,
    severity: severityForCount(clipIds.length),
    clipIds,
    message,
    suggestedAction,
  }
}

function buildTimelineContexts(project: Project, montagePlan: MontagePlan): TimelineClipContext[] {
  const shotById = new Map(project.shots.map((shot) => [shot.id, shot]))

  return [...montagePlan.timeline]
    .slice()
    .sort((left, right) => {
      if (left.startSec !== right.startSec) return left.startSec - right.startSec
      return left.durationSec - right.durationSec
    })
    .flatMap((entry) => {
      const shot = shotById.get(entry.shotId)
      if (!shot) return []
      return [{
        clipId: entry.clipId ?? getClipId(entry),
        shotId: entry.shotId,
        selectedMomentId: entry.selectedMomentId,
        startSec: entry.startSec,
        durationSec: entry.durationSec,
        endSec: entry.startSec + entry.durationSec,
        semanticBlockId: entry.semanticBlockId,
        shot,
      }]
    })
}

function tokenizeVisualText(shot: ShotMeta): string[] {
  return normalizeText(buildClipText(shot))
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= VISUAL_REPETITION_TOKEN_MIN_LENGTH)
    .filter((token) => !VISUAL_REPETITION_STOPWORDS.has(token))
}

function getSharedVisualTokenCount(left: ShotMeta, right: ShotMeta): number {
  const leftTokens = new Set(tokenizeVisualText(left))
  const rightTokens = new Set(tokenizeVisualText(right))
  let sharedCount = 0

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      sharedCount += 1
    }
  }

  return sharedCount
}

function detectAssetOveruse(clips: TimelineClipContext[]): MontageReviewIssue[] {
  const lastSeenByShot = new Map<string, TimelineClipContext>()
  const issues: MontageReviewIssue[] = []

  for (const clip of clips) {
    const previous = lastSeenByShot.get(clip.shotId)
    if (previous) {
      const reuseGap = clip.startSec - previous.endSec
      if (reuseGap <= ASSET_OVERUSE_GAP_SEC) {
        issues.push(createIssue(
          'asset_overuse',
          [previous.clipId, clip.clipId],
          'Один и тот же шот используется слишком близко к предыдущему повтору.',
          'Разнести повторный шот дальше по таймлайну или заменить его более свежим ракурсом.',
        ))
      }
    }

    lastSeenByShot.set(clip.shotId, clip)
  }

  return issues
}

function detectVisualRepetition(clips: TimelineClipContext[]): MontageReviewIssue[] {
  const issues: MontageReviewIssue[] = []

  for (let index = 0; index < clips.length - 1; index += 1) {
    const current = clips[index]
    const next = clips[index + 1]

    if (current.shotId === next.shotId) {
      continue
    }

    const currentRole = classifyVisualRole(current.shot, current.selectedMomentId)
    const nextRole = classifyVisualRole(next.shot, next.selectedMomentId)

    if (currentRole !== 'generic' && currentRole === nextRole) {
      issues.push(createIssue(
        'visual_repetition',
        [current.clipId, next.clipId],
        `Два соседних клипа занимают одну и ту же визуальную роль: ${currentRole}.`,
        'Развести соседние клипы по разным визуальным акцентам или добавить более свежий ракурс.',
      ))
      continue
    }

    const sharedVisualTokenCount = getSharedVisualTokenCount(current.shot, next.shot)
    if (sharedVisualTokenCount >= VISUAL_REPETITION_MIN_SHARED_TOKENS) {
      issues.push(createIssue(
        'visual_repetition',
        [current.clipId, next.clipId],
        'Два соседних клипа слишком похожи по визуальному описанию и читаются как повтор.',
        'Развести соседние клипы по разным визуальным акцентам или добавить более свежий ракурс.',
      ))
    }
  }

  return issues
}

function detectPacingDrag(clips: TimelineClipContext[]): MontageReviewIssue[] {
  if (clips.length === 0) {
    return []
  }

  const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSec, 0)
  const uniqueShotIds = new Set(clips.map((clip) => clip.shotId))
  const isSingleShotBlock = uniqueShotIds.size === 1 || clips.length === 1

  if (!isSingleShotBlock) {
    return []
  }

  if (totalDuration < PACE_DRAG_MIN_SEC && clips[0].durationSec < PACE_DRAG_MIN_SINGLE_SHOT_SEC) {
    return []
  }

  return [createIssue(
    'pacing_drag',
    clips.map((clip) => clip.clipId),
    'Один визуальный блок держится слишком долго без достаточной смены ритма.',
    'Разрезать блок на две части, добавить bridge-кадр или переключить стратегию на pair/split.',
  )]
}

function scoreReview(issues: MontageReviewIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    switch (issue.type) {
      case 'coverage_gap':
        return sum + 0.25
      case 'pacing_drag':
        return sum + 0.2
      case 'asset_overuse':
      case 'visual_repetition':
        return sum + 0.15
      case 'novelty_gap':
        return sum + 0.12
      default:
        return sum + 0.1
    }
  }, 0)

  return Math.max(0, Math.min(1, 1 - penalty))
}

function buildSummary(issues: MontageReviewIssue[]): MontageReview['summary'] {
  return {
    issues: issues.length,
    autoFixes: 0,
    blockingRequests: issues.filter((issue) => issue.type === 'coverage_gap').length,
  }
}

export function reviewMontageDraft(project: Project, montagePlan: MontagePlan): MontageReview {
  const clips = buildTimelineContexts(project, montagePlan)
  const issues = [
    ...detectAssetOveruse(clips),
    ...detectVisualRepetition(clips),
    ...detectPacingDrag(clips),
  ]

  return {
    score: scoreReview(issues),
    summary: buildSummary(issues),
    issues,
    autoFixes: [],
    suggestedShotRequests: [],
  }
}

export { detectAssetOveruse, detectPacingDrag, detectVisualRepetition }
