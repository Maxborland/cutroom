import type {
  AnchorMatch,
  Project,
  SemanticBlock,
  SemanticBlockAlternative,
  SemanticBlockSegment,
  ShotMeta,
} from './storage.js';

export interface SemanticPlannedClip {
  shot: ShotMeta;
  clipId: string;
  anchorId?: string;
  semanticBlockId?: string;
  selectedMoment?: NonNullable<ShotMeta['videoDescription']>['moments'][number];
  semanticBlock?: SemanticBlock;
  pacingDurationSec?: number;
}

const MAX_BLOCK_SEGMENTS = 3;
const ROLE_DIVERSITY_CONFIDENCE_GAP = 0.07;
type NarrationAnchor = NonNullable<Project['narrationAnchors']>[number];
type PlannerMatchClass = 'direct' | 'visual' | 'atmospheric' | 'fallback' | 'unresolved';
export type PlannerVisualRole =
  | 'view'
  | 'interior'
  | 'detail'
  | 'transition'
  | 'lifestyle'
  | 'hero'
  | 'generic';

function getApprovedShots(project: Project, approvedShots?: ShotMeta[]): ShotMeta[] {
  if (approvedShots) {
    return approvedShots;
  }

  return project.shots
    .filter((shot) => shot.status === 'approved')
    .sort((left, right) => left.order - right.order);
}

function getAnchorOrderMap(project: Project): Map<string, number> {
  return new Map((project.narrationAnchors ?? []).map((anchor) => [anchor.id, anchor.order]));
}

function getAnchorById(project: Project, anchorId: string): NarrationAnchor | undefined {
  return (project.narrationAnchors ?? []).find((anchor) => anchor.id === anchorId);
}

function getShotById(approvedShots: ShotMeta[], shotId: string): ShotMeta | undefined {
  return approvedShots.find((shot) => shot.id === shotId);
}

function makeDefaultExplanation(block: SemanticBlock): string[] {
  const count = block.segments.length;
  if (count <= 1 || block.strategy === 'solo') {
    return [`Якорь "${block.anchorLabel}" собран одним сильным ракурсом`];
  }

  if (count === 2) {
    return [`Якорь "${block.anchorLabel}" собран из двух близких ракурсов`];
  }

  return [`Якорь "${block.anchorLabel}" собран из ${count} ракурсов`];
}

function cloneSegment(segment: SemanticBlockSegment): SemanticBlockSegment {
  return { ...segment };
}

function buildAlternativesFromOverflow(overflow: SemanticBlockSegment[]): SemanticBlockAlternative[] {
  return overflow.map((segment) => ({
    shotId: segment.shotId,
    momentId: segment.momentId,
    confidence: segment.weight,
    reason: segment.reason,
    rejectedBecause: 'Превышен лимит в 3 сегмента',
  }));
}

function resolveSegmentWindow(
  shot: ShotMeta | undefined,
  segment: SemanticBlockSegment,
): { startSec: number; endSec: number } | null {
  if (!shot) {
    return null;
  }

  if (!segment.momentId) {
    return {
      startSec: 0,
      endSec: shot.duration,
    };
  }

  const moment = shot.videoDescription?.moments.find((candidate) => candidate.id === segment.momentId);
  if (!moment) {
    return null;
  }

  const startSec = moment.startSec ?? 0;
  const endSec = moment.endSec ?? Math.max(startSec + segment.durationSec, startSec + 0.5);
  if (endSec <= startSec) {
    return null;
  }

  return { startSec, endSec };
}

function isNearDuplicateSegment(
  existing: SemanticBlockSegment,
  candidate: SemanticBlockSegment,
  shotById: Map<string, ShotMeta>,
): boolean {
  if (existing.shotId !== candidate.shotId) {
    return false;
  }

  if (existing.momentId && candidate.momentId && existing.momentId === candidate.momentId) {
    return true;
  }

  const shot = shotById.get(existing.shotId);
  const existingWindow = resolveSegmentWindow(shot, existing);
  const candidateWindow = resolveSegmentWindow(shot, candidate);
  if (!existingWindow || !candidateWindow) {
    return existing.momentId === candidate.momentId;
  }

  const overlap = Math.max(0, Math.min(existingWindow.endSec, candidateWindow.endSec) - Math.max(existingWindow.startSec, candidateWindow.startSec));
  const existingLength = existingWindow.endSec - existingWindow.startSec;
  const candidateLength = candidateWindow.endSec - candidateWindow.startSec;
  const shorterLength = Math.min(existingLength, candidateLength);
  const startGap = Math.abs(existingWindow.startSec - candidateWindow.startSec);
  const endGap = Math.abs(existingWindow.endSec - candidateWindow.endSec);

  return overlap >= shorterLength * 0.8 || (startGap <= 0.5 && endGap <= 0.5);
}

function dedupeSegments(
  segments: SemanticBlockSegment[],
  shotById: Map<string, ShotMeta>,
): { kept: SemanticBlockSegment[]; alternatives: SemanticBlockAlternative[] } {
  const seen = new Set<string>();
  const kept: SemanticBlockSegment[] = [];
  const alternatives: SemanticBlockAlternative[] = [];

  for (const segment of segments) {
    const key = `${segment.shotId}::${segment.momentId ?? ''}`;
    const duplicate = seen.has(key) || kept.some((existing) => isNearDuplicateSegment(existing, segment, shotById));
    if (duplicate) {
      alternatives.push({
        shotId: segment.shotId,
        momentId: segment.momentId,
        confidence: segment.weight,
        reason: segment.reason,
        rejectedBecause: seen.has(key) ? 'Дубликат сегмента' : 'Почти дубликат визуального слота',
      });
      continue;
    }

    seen.add(key);
    kept.push(cloneSegment(segment));
  }

  return { kept, alternatives };
}

function normalizeProvidedBlocks(project: Project, blocks: SemanticBlock[], approvedShots: ShotMeta[]): SemanticBlock[] {
  const anchorOrder = getAnchorOrderMap(project);
  const shotById = new Map(approvedShots.map((shot) => [shot.id, shot]));

  return [...blocks]
    .sort((left, right) => {
      const leftOrder = anchorOrder.get(left.anchorId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = anchorOrder.get(right.anchorId) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.id.localeCompare(right.id);
    })
    .map((block) => {
      const { kept, alternatives: duplicateAlternatives } = dedupeSegments(block.segments ?? [], shotById);
      const limited = kept.slice(0, MAX_BLOCK_SEGMENTS);
      const overflow = kept.slice(MAX_BLOCK_SEGMENTS);
      const explicitAlternatives = Array.isArray(block.alternatives) ? block.alternatives.map((alternative) => ({ ...alternative })) : [];
      const alternatives = [...explicitAlternatives, ...duplicateAlternatives, ...buildAlternativesFromOverflow(overflow)];
      const normalizedStrategy = limited.length <= 1
        ? 'solo'
        : limited.length === 2
          ? chooseStrategy(limited.length, limited.map((segment) => segment.weight))
          : 'cascade';

      return {
        ...block,
        strategy: normalizedStrategy,
        segments: limited,
        explanation: block.explanation?.length ? [...block.explanation] : makeDefaultExplanation({ ...block, strategy: normalizedStrategy, segments: limited }),
        alternatives: alternatives.length > 0 ? alternatives : block.alternatives,
      };
    });
}

function chooseStrategy(segmentCount: number, confidences: number[]): SemanticBlock['strategy'] {
  if (segmentCount <= 1) return 'solo';
  if (segmentCount === 2) {
    const gap = Math.abs((confidences[0] ?? 0) - (confidences[1] ?? 0));
    return gap <= 0.12 ? 'split' : 'pair';
  }
  return 'cascade';
}

function classifyCandidateReason(
  reason: string | undefined,
  fallbackClass: PlannerMatchClass,
): PlannerMatchClass {
  const normalizedReason = reason?.toLowerCase() ?? '';
  if (normalizedReason.includes('literal grounding')) return 'direct';
  if (normalizedReason.includes('visual grounding')) return 'visual';
  if (normalizedReason.includes('atmospheric grounding')) return 'atmospheric';
  if (normalizedReason.includes('fallback grounding')) return 'fallback';
  return fallbackClass;
}

function candidateClassRank(matchClass: PlannerMatchClass): number {
  switch (matchClass) {
    case 'direct':
      return 4;
    case 'visual':
      return 3;
    case 'atmospheric':
      return 2;
    case 'fallback':
      return 1;
    default:
      return 0;
  }
}

function buildGroundedExplanation(anchorLabel: string, matchClass: PlannerMatchClass, segmentCount: number): string[] {
  const matchLabel = matchClass === 'direct'
    ? 'прямым совпадением'
    : matchClass === 'visual'
      ? 'визуальным совпадением'
      : matchClass === 'atmospheric'
        ? 'атмосферным совпадением'
        : 'резервным совпадением';

  if (segmentCount <= 1) {
    return [`Якорь "${anchorLabel}" собран ${matchLabel}`];
  }

  return [`Якорь "${anchorLabel}" собран из ${segmentCount} сегментов с опорой на ${matchLabel}`];
}

export function classifyVisualRole(
  shot: ShotMeta,
  momentId?: string,
): PlannerVisualRole {
  const moment = momentId
    ? (shot.videoDescription?.moments ?? []).find((candidate) => candidate.id === momentId)
    : undefined;
  const roleText = [
    shot.scene,
    shot.videoDescription?.summary,
    ...(shot.videoDescription?.tags ?? []),
    ...(shot.videoDescription?.matchHints ?? []),
    moment?.label,
    moment?.summary,
    ...(moment?.tags ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  if (/(терраса|вид|панорам|река|город|фасад|экстерьер|дрон|закат)/u.test(roleText)) {
    return 'view';
  }

  if (/(гостиная|кухня|спальня|лобби|интерьер|холл|окна)/u.test(roleText)) {
    return 'interior';
  }

  if (/(деталь|крупный|текстур|декор|материал|светильник)/u.test(roleText)) {
    return 'detail';
  }

  if (/(вход|проход|лестниц|коридор|переход|между|walk|move|transition)/u.test(roleText)) {
    return 'transition';
  }

  if (/(уют|спокойств|домаш|lifestyle|атмосфер)/u.test(roleText)) {
    return 'lifestyle';
  }

  if (/(hero|главн|premium|престиж|шоукейс)/u.test(roleText)) {
    return 'hero';
  }

  return 'generic';
}

function buildMomentCandidate(
  shot: ShotMeta,
  momentId: string | undefined,
  confidence: number,
  reason: string,
): SemanticBlockSegment {
  return {
    shotId: shot.id,
    momentId,
    durationSec: Math.max(2, Math.round(shot.duration / 2)),
    weight: confidence,
    reason,
  };
}

function buildSegmentsFromMatch(project: Project, approvedShots: ShotMeta[], match: AnchorMatch): SemanticBlock[] {
  const shotById = new Map(approvedShots.map((shot) => [shot.id, shot]));
  const defaultMatchClass: PlannerMatchClass = match.status === 'matched' ? 'visual' : 'atmospheric';
  const rankedCandidates = [...(match.candidates ?? [])]
    .filter((candidate) => shotById.has(candidate.shotId))
    .sort((left, right) => {
      const classDelta = candidateClassRank(classifyCandidateReason(right.reason, defaultMatchClass))
        - candidateClassRank(classifyCandidateReason(left.reason, defaultMatchClass));
      if (classDelta !== 0) {
        return classDelta;
      }

      return right.confidence - left.confidence;
    });

  const selectedCandidate = match.selectedShotId
    ? rankedCandidates.find((candidate) => candidate.shotId === match.selectedShotId && (candidate.momentId ?? undefined) === (match.selectedMomentId ?? undefined))
    : undefined;

  const prioritizedCandidates = [
    ...(selectedCandidate && classifyCandidateReason(selectedCandidate.reason, defaultMatchClass) !== 'fallback' ? [selectedCandidate] : []),
    ...rankedCandidates.filter((candidate) => candidate !== selectedCandidate),
    ...(selectedCandidate && classifyCandidateReason(selectedCandidate.reason, defaultMatchClass) === 'fallback' ? [selectedCandidate] : []),
  ];

  const deduped: Array<{ shot: ShotMeta; momentId?: string; confidence: number; reason: string; matchClass: PlannerMatchClass; visualRole: PlannerVisualRole }> = [];
  const seen = new Set<string>();

  for (const candidate of prioritizedCandidates) {
    const shot = shotById.get(candidate.shotId);
    if (!shot) continue;
    const key = `${candidate.shotId}::${candidate.momentId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matchClass = classifyCandidateReason(candidate.reason, defaultMatchClass);
    deduped.push({
      shot,
      momentId: candidate.momentId,
      confidence: candidate.confidence,
      reason: candidate.reason,
      matchClass,
      visualRole: classifyVisualRole(shot, candidate.momentId),
    });
  }

  if (deduped.length === 0 && match.selectedShotId) {
    const shot = shotById.get(match.selectedShotId);
    if (shot) {
      deduped.push({
        shot,
        momentId: match.selectedMomentId,
        confidence: match.confidence || 0.5,
        reason: 'Выбранный шот по anchorMatches',
        matchClass: match.status === 'matched' ? 'visual' : 'atmospheric',
        visualRole: classifyVisualRole(shot, match.selectedMomentId),
      });
    }
  }

  const usableCandidates = deduped.filter((candidate) => candidate.matchClass !== 'fallback' && candidate.matchClass !== 'unresolved');
  if (usableCandidates.length === 0) {
    return [];
  }

  const topCandidates: typeof usableCandidates = []
  const deferredDuplicates: typeof usableCandidates = []
  const usedShotIds = new Set<string>()
  const usedRoles = new Set<PlannerVisualRole>()

  for (let index = 0; index < usableCandidates.length; index++) {
    const candidate = usableCandidates[index]
    if (topCandidates.length >= MAX_BLOCK_SEGMENTS) {
      break
    }

    const remainingCandidates = usableCandidates.slice(index + 1)
    const hasUnusedShotAlternative = remainingCandidates.some((alternative) => !usedShotIds.has(alternative.shot.id))
    const bestUnusedRoleAlternative = remainingCandidates.find((alternative) =>
      !usedRoles.has(alternative.visualRole) && alternative.visualRole !== 'generic',
    )

    if (usedShotIds.has(candidate.shot.id) && hasUnusedShotAlternative) {
      deferredDuplicates.push(candidate)
      continue
    }

    const shouldPreferRoleDiversity = Boolean(
      usedRoles.has(candidate.visualRole)
      && candidate.visualRole !== 'generic'
      && bestUnusedRoleAlternative
      && (candidate.confidence - bestUnusedRoleAlternative.confidence) <= ROLE_DIVERSITY_CONFIDENCE_GAP,
    )

    if (shouldPreferRoleDiversity) {
      deferredDuplicates.push(candidate)
      continue
    }

    topCandidates.push(candidate)
    usedShotIds.add(candidate.shot.id)
    usedRoles.add(candidate.visualRole)
  }

  for (const candidate of deferredDuplicates) {
    if (topCandidates.length >= MAX_BLOCK_SEGMENTS) {
      break
    }

    topCandidates.push(candidate)
  }

  if (topCandidates.length === 0) {
    return [];
  }

  const segmentCount = topCandidates.length;
  const strategy = chooseStrategy(segmentCount, topCandidates.map((candidate) => candidate.confidence));
  const anchor = getAnchorById(project, match.anchorId);
  const anchorLabel = anchor?.label ?? match.anchorId;
  const blockMatchClass = topCandidates[0]?.matchClass ?? 'visual';

  const segments = topCandidates.map(({ shot, momentId, confidence, reason }) =>
    buildMomentCandidate(shot, momentId, confidence, reason),
  );
  const overflow = usableCandidates.filter((candidate) => !topCandidates.includes(candidate));
  const alternatives = overflow.map((candidate) => ({
    shotId: candidate.shot.id,
    momentId: candidate.momentId,
    confidence: candidate.confidence,
    reason: candidate.reason,
    rejectedBecause: 'Превышен лимит в 3 сегмента',
  }));

  return [{
    id: `semantic-block-${match.anchorId}`,
    anchorId: match.anchorId,
    anchorText: anchor?.sourceText ?? anchorLabel,
    anchorLabel,
    strategy,
    confidence: topCandidates[0]?.confidence ?? match.confidence ?? 0,
    segments,
    explanation: buildGroundedExplanation(anchorLabel, blockMatchClass, segmentCount),
    alternatives,
  }];
}

function normalizeSemanticBlocks(project: Project, approvedShots?: ShotMeta[]): SemanticBlock[] {
  const resolvedApprovedShots = getApprovedShots(project, approvedShots);
  const explicitBlocks = project.semanticBlocks ?? [];
  if (explicitBlocks.length > 0) {
    return normalizeProvidedBlocks(project, explicitBlocks, resolvedApprovedShots);
  }

  const anchorOrder = getAnchorOrderMap(project);
  return [...(project.anchorMatches ?? [])]
    .sort((left, right) => (anchorOrder.get(left.anchorId) ?? Number.MAX_SAFE_INTEGER) - (anchorOrder.get(right.anchorId) ?? Number.MAX_SAFE_INTEGER))
    .flatMap((match) => buildSegmentsFromMatch(project, resolvedApprovedShots, match))
    .map((block) => normalizeProvidedBlocks(project, [block], resolvedApprovedShots)[0])
    .filter((block): block is SemanticBlock => Boolean(block));
}

export function buildSemanticBlocks(project: Project, approvedShots?: ShotMeta[]): SemanticBlock[] {
  return normalizeSemanticBlocks(project, approvedShots);
}

export function buildSemanticBlockClips(project: Project, approvedShots?: ShotMeta[]): SemanticPlannedClip[] {
  const resolvedApprovedShots = getApprovedShots(project, approvedShots);
  const normalizedBlocks = buildSemanticBlocks(project, resolvedApprovedShots);
  if (normalizedBlocks.length === 0) {
    return [];
  }

  const clips: SemanticPlannedClip[] = [];

  for (const block of normalizedBlocks) {
    const blockSegments = block.segments.slice(0, MAX_BLOCK_SEGMENTS);
    for (let index = 0; index < blockSegments.length; index++) {
      const segment = blockSegments[index];
      const shot = getShotById(resolvedApprovedShots, segment.shotId);
      if (!shot) continue;
      const selectedMoment = segment.momentId
        ? shot.videoDescription?.moments.find((moment) => moment.id === segment.momentId)
        : undefined;

      clips.push({
        shot,
        clipId: index === 0 ? `clip-${block.id}` : `clip-${block.id}-${index + 1}`,
        anchorId: block.anchorId,
        semanticBlockId: block.id,
        selectedMoment,
        semanticBlock: {
          ...block,
          segments: blockSegments,
        },
        pacingDurationSec: Math.max(2, segment.durationSec * Math.max(segment.weight, 0.25)),
      });
    }
  }

  return clips.sort((left, right) => {
    const leftOrder = anchorOrderForClip(project, left);
    const rightOrder = anchorOrderForClip(project, right);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.clipId.localeCompare(right.clipId);
  });
}

function anchorOrderForClip(project: Project, clip: SemanticPlannedClip): number {
  const anchorOrder = getAnchorOrderMap(project);
  return clip.anchorId ? anchorOrder.get(clip.anchorId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
}
