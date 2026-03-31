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

  const overlongClips = clips.filter((clip) => clip.durationSec >= PACE_DRAG_MIN_SINGLE_SHOT_SEC)
  if (overlongClips.length > 0) {
    return overlongClips.map((clip) => createIssue(
      'pacing_drag',
      [clip.clipId],
      'Клип держится слишком долго без достаточной смены визуального ритма.',
      'Разрезать клип на два использования или вставить между ними более свежий ракурс.',
    ))
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

function buildAutoFixes(
  _project: Project,
  montagePlan: MontagePlan,
  clips: TimelineClipContext[],
  issues: MontageReviewIssue[],
): MontageAutoFix[] {
  const autoFixes: MontageAutoFix[] = []
  const blockById = new Map((montagePlan.semanticBlocks ?? []).map((block) => [block.id, block]))
  const clipById = new Map(clips.map((clip) => [clip.clipId, clip]))
  const clipIndexById = new Map(clips.map((clip, index) => [clip.clipId, index]))
  const seen = new Set<string>()

  const addFix = (fix: MontageAutoFix) => {
    if (seen.has(fix.id)) {
      return
    }
    seen.add(fix.id)
    autoFixes.push(fix)
  }

  for (const issue of issues) {
    if (issue.type === 'asset_overuse') {
      const repeatClipId = issue.clipIds[issue.clipIds.length - 1]
      const repeatIndex = repeatClipId ? clipIndexById.get(repeatClipId) : undefined
      if (repeatClipId && clipById.has(repeatClipId) && repeatIndex !== undefined && repeatIndex < clips.length - 1) {
        addFix({
          id: `move-repeat-${repeatClipId}`,
          type: 'move_repeat',
          applied: false,
          affectedClipIds: [repeatClipId],
          explanation: 'Разнести повторный клип дальше от его предыдущего использования.',
        })
      }
    }

    if (issue.type === 'visual_repetition') {
      const repeatClipId = issue.clipIds[issue.clipIds.length - 1]
      const clip = repeatClipId ? clipById.get(repeatClipId) : undefined
      const block = clip?.semanticBlockId ? blockById.get(clip.semanticBlockId) : undefined
      if (repeatClipId && block?.alternatives?.length) {
        const fresherAlternative = block.alternatives.find((alternative) => alternative.shotId !== clip?.shotId)
        if (fresherAlternative) {
          addFix({
            id: `swap-candidate-${repeatClipId}`,
            type: 'swap_candidate',
            applied: false,
            affectedClipIds: [repeatClipId],
            explanation: 'Заменить повторяющийся клип на более свежий кандидат из того же смыслового блока.',
          })
          continue
        }
      }

      const repeatIndex = repeatClipId ? clipIndexById.get(repeatClipId) : undefined
      if (repeatClipId && clip && repeatIndex !== undefined && repeatIndex < clips.length - 1) {
        addFix({
          id: `move-repeat-${repeatClipId}`,
          type: 'move_repeat',
          applied: false,
          affectedClipIds: [repeatClipId],
          explanation: 'Разнести повторный клип дальше, чтобы снизить визуальное повторение.',
        })
      }
    }

    if (issue.type === 'pacing_drag') {
      const clipId = issue.clipIds[0]
      if (clipId && clipById.has(clipId)) {
        addFix({
          id: `split-clip-${clipId}`,
          type: 'split_clip',
          applied: false,
          affectedClipIds: [clipId],
          explanation: 'Разрезать слишком длинный клип на два более коротких использования.',
        })
      }
    }
  }

  const hasSplitFix = autoFixes.some((fix) => fix.type === 'split_clip')
  if (!hasSplitFix) {
    const pacingIssues = issues.filter((issue) => issue.type === 'pacing_drag' && issue.clipIds.length > 0)
    for (const pacingIssue of pacingIssues) {
      addFix({
        id: `split-clip-${pacingIssue.clipIds[0]}`,
        type: 'split_clip',
        applied: false,
        affectedClipIds: [pacingIssue.clipIds[0]],
        explanation: 'Разрезать слишком длинный клип, чтобы убрать визуальную затяжку.',
      })
    }
  }

  const repetitionBlockIds = new Set(
    issues
      .filter((issue) => issue.type === 'visual_repetition')
      .flatMap((issue) => issue.clipIds)
      .map((clipId) => clipById.get(clipId)?.semanticBlockId)
      .filter((blockId): blockId is string => typeof blockId === 'string' && blockId.length > 0),
  )
  const hasStrategyFix = autoFixes.some((fix) => fix.type === 'change_block_strategy')
  if (!hasStrategyFix && repetitionBlockIds.size > 0) {
    for (const block of montagePlan.semanticBlocks ?? []) {
      if (!repetitionBlockIds.has(block.id)) {
        continue
      }
      if (block.strategy === 'cascade' && block.segments.length >= 3) {
        const affectedClipIds = clips
          .filter((clip) => clip.semanticBlockId === block.id)
          .map((clip) => clip.clipId)
        if (affectedClipIds.length >= 3) {
          addFix({
            id: `change-block-strategy-${block.id}`,
            type: 'change_block_strategy',
            applied: false,
            affectedClipIds,
            explanation: 'Сжать каскадный блок до более компактной пары, чтобы улучшить визуальное разнообразие.',
          })
          break
        }
      }
    }
  }

  return autoFixes
}

function getDominantRole(roles: string[]): string {
  const counts = new Map<string, number>()
  for (const role of roles) {
    const normalized = role.trim().toLowerCase()
    if (!normalized || normalized === 'generic') {
      continue
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  let dominantRole = 'generic'
  let dominantCount = 0
  for (const [role, count] of counts) {
    if (count > dominantCount) {
      dominantRole = role
      dominantCount = count
    }
  }

  return dominantRole
}

function complementRole(role: string): string {
  switch (role) {
    case 'view':
    case 'interior':
    case 'lifestyle':
    case 'hero':
      return 'detail'
    case 'detail':
    case 'transition':
      return 'interior'
    default:
      return 'detail'
  }
}

function buildPromptHints(
  blockLabel: string,
  neededVisualRole: string,
  kind: 'novelty' | 'atmospheric' | 'missing',
): string[] {
  if (kind === 'atmospheric') {
    return [
      `Блок: ${blockLabel}`,
      'Сохрани настроение, но добавь более конкретный жилой ракурс.',
      'Покажи материалы, свет и ощущение пространства.',
    ]
  }

  if (kind === 'missing') {
    return [
      `Блок: ${blockLabel}`,
      `Нужен недостающий ${neededVisualRole === 'interior' ? 'интерьерный' : 'детальный'} кадр.`,
      'Добавь контрапункт к текущим внешним ракурсам.',
    ]
  }

  return [
    `Блок: ${blockLabel}`,
    `Нужен свежий ${neededVisualRole === 'detail' ? 'детальный' : 'визуальный'} ракурс.`,
    'Избегай повторения уже использованных видов.',
  ]
}

function buildShotGoal(
  blockLabel: string,
  neededVisualRole: string,
  kind: 'novelty' | 'atmospheric' | 'missing',
): string {
  if (kind === 'atmospheric') {
    return `Уточнить атмосферу блока "${blockLabel}" через более конкретный жилой ракурс.`
  }

  if (kind === 'missing') {
    return `Доснять недостающий ${neededVisualRole} кадр для блока "${blockLabel}".`
  }

  return `Добавить новый ${neededVisualRole === 'detail' ? 'детальный' : 'визуально свежий'} кадр для блока "${blockLabel}".`
}

function buildSuggestedShotRequests(
  montagePlan: MontagePlan,
  clips: TimelineClipContext[],
  issues: MontageReviewIssue[],
): MontageShotRequest[] {
  const requests: MontageShotRequest[] = []
  const clipById = new Map(clips.map((clip) => [clip.clipId, clip]))
  const seen = new Set<string>()

  const addRequest = (request: MontageShotRequest) => {
    if (seen.has(request.id)) {
      return
    }
    seen.add(request.id)
    requests.push(request)
  }

  for (const block of montagePlan.semanticBlocks ?? []) {
    const blockClips = clips.filter((clip) => clip.semanticBlockId === block.id)
    if (blockClips.length === 0) {
      continue
    }

    const roles = blockClips.map((clip) => classifyVisualRole(clip.shot, clip.selectedMomentId))
    const dominantRole = getDominantRole(roles)
    const blockLabel = block.anchorLabel || block.anchorText
    const selectedBlockText = [
      block.anchorText,
      block.anchorLabel,
      ...(block.explanation ?? []),
      ...(block.segments ?? []).map((segment) => segment.reason),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase()

    const blockIssues = issues.filter((issue) =>
      issue.clipIds.some((clipId) => clipById.get(clipId)?.semanticBlockId === block.id),
    )
    const visualRepetitionInBlock = blockIssues.some((issue) => issue.type === 'visual_repetition')
    const blockHasAnyIssue = blockIssues.length > 0

    const hasAtmosphericFallback = /(атмосфер|fallback)/u.test(selectedBlockText)
    const hasExteriorPattern = /(фасад|террас|вид|экстерьер|двор|панорам)/u.test(selectedBlockText)
    const hasInteriorPattern = /(интерьер|лобби|гостиная|кухн|спальн|холл|комнат)/u.test(selectedBlockText)

    let neededVisualRole: string | undefined
    let priority: MontageShotRequestPriority | undefined
    let canUseImageOnly = false
    let kind: 'novelty' | 'atmospheric' | 'missing' | undefined

    if (hasAtmosphericFallback) {
      neededVisualRole = 'interior_detail'
      priority = 'blocking'
      canUseImageOnly = true
      kind = 'atmospheric'
    } else if (blockHasAnyIssue && hasInteriorPattern && !roles.includes('detail')) {
      neededVisualRole = 'detail'
      priority = 'blocking'
      kind = 'missing'
    } else if (blockHasAnyIssue && hasExteriorPattern && !roles.includes('interior')) {
      neededVisualRole = 'interior'
      priority = 'blocking'
      kind = 'missing'
    } else if (visualRepetitionInBlock && dominantRole !== 'generic') {
      neededVisualRole = complementRole(dominantRole)
      priority = 'recommended'
      kind = 'novelty'
    }

    if (!neededVisualRole || !priority || !kind) {
      continue
    }

    addRequest({
      id: `shot-request-${block.id}-${neededVisualRole}`,
      blockId: block.id,
      priority,
      neededVisualRole,
      shotGoal: buildShotGoal(blockLabel, neededVisualRole, kind),
      promptHints: buildPromptHints(blockLabel, neededVisualRole, kind),
      recommendedCount: 1,
      canUseImageOnly,
    })
  }

  return requests
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

function buildSummary(issues: MontageReviewIssue[], autoFixes: MontageAutoFix[]): MontageReview['summary'] {
  return {
    issues: issues.length,
    autoFixes: autoFixes.length,
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
  const autoFixes = buildAutoFixes(project, montagePlan, clips, issues)
  const suggestedShotRequests = buildSuggestedShotRequests(montagePlan, clips, issues)

  return {
    score: scoreReview(issues),
    summary: buildSummary(issues, autoFixes),
    issues,
    autoFixes,
    suggestedShotRequests,
  }
}

export { detectAssetOveruse, detectPacingDrag, detectVisualRepetition }
