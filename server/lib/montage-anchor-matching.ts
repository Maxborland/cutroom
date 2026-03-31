import type {
  AnchorCoverageSummary,
  AnchorMatch,
  AnchorMatchCandidate,
  GroundedMatchClass,
  GroundingPacket,
  NarrationAnchor,
  Project,
  ShotMeta,
  ShotVideoDescriptionMoment,
} from './storage.js';
import { groundScriptBlock } from './grounded-script-blocks.js';

const STRONG_MATCH_THRESHOLD = 0.75;
const WEAK_MATCH_THRESHOLD = 0.35;

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'по', 'для', 'к', 'ко', 'у', 'о', 'об', 'от',
  'из', 'за', 'под', 'над', 'это', 'эта', 'этот', 'эти', 'или', 'но', 'а', 'же',
  'the', 'and', 'for', 'with', 'into', 'over',
]);

const GENERIC_QUERY_TOKENS = new Set([
  'вид',
  'виды',
  'общий',
  'общая',
  'общие',
  'план',
  'планы',
  'кадр',
  'кадры',
  'ракурс',
  'ракурсы',
  'сцена',
  'сцены',
  'обзор',
  'обзоры',
]);

const CLASS_ORDER: Record<GroundedMatchClass, number> = {
  direct: 4,
  visual: 3,
  atmospheric: 2,
  fallback: 1,
  unresolved: 0,
};

const CLASS_WEIGHTS: Record<Exclude<GroundedMatchClass, 'unresolved'>, number> = {
  direct: 1,
  visual: 0.88,
  atmospheric: 0.64,
  fallback: 0.48,
};

const FALLBACK_MODIFIERS: Record<NonNullable<GroundingPacket['fallbackMode']>, number> = {
  direct_only: 0.34,
  visual_ok: 0.42,
  atmospheric_broll: 0.38,
};

interface ScoredCandidate extends AnchorMatchCandidate {
  score: number;
  matchClass: GroundedMatchClass;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(values: string[]): string[] {
  return Array.from(new Set(values.flatMap((value) => tokenize(value))));
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) {
    return true;
  }

  const shortestLength = Math.min(queryToken.length, candidateToken.length);
  if (shortestLength < 5) {
    return false;
  }

  const shorter = queryToken.length <= candidateToken.length ? queryToken : candidateToken;
  const longer = queryToken.length <= candidateToken.length ? candidateToken : queryToken;

  return longer.startsWith(shorter);
}

function isGenericToken(token: string): boolean {
  return GENERIC_QUERY_TOKENS.has(token);
}

function scoreQueryAgainstValues(
  query: string,
  values: string[],
  weight: number,
  reason: string,
  matchClass: ScoredCandidate['matchClass'],
  moment?: ShotVideoDescriptionMoment,
): ScoredCandidate | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return null;
  }

  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  if (normalizedValues.length === 0) {
    return null;
  }

  const queryTokens = tokenize(query);
  const candidateTokens = uniqueTokens(normalizedValues);
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return null;
  }

  const exactPhrasePattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedQuery)}($|\\s)`, 'u');
  const exactPhraseMatch = normalizedValues.some((value) => exactPhrasePattern.test(normalizeText(value)));
  const matchedTokens = queryTokens.filter((queryToken) =>
    candidateTokens.some((candidateToken) => tokenMatches(queryToken, candidateToken)),
  );
  const specificQueryTokens = queryTokens.filter((token) => !isGenericToken(token));
  const specificMatchedTokens = matchedTokens.filter((token) => !isGenericToken(token));
  const genericMatchedTokens = matchedTokens.filter((token) => isGenericToken(token));
  const denominator = specificQueryTokens.length > 0 ? specificQueryTokens.length : queryTokens.length;

  let score = 0;
  if (exactPhraseMatch) {
    score = weight * (specificQueryTokens.length > 0 ? 1 : 0.2);
  } else if (specificMatchedTokens.length > 0) {
    const coverage = specificMatchedTokens.length / denominator;
    const floor = matchClass === 'direct'
      ? 0.58
      : matchClass === 'visual'
        ? 0.66
        : matchClass === 'atmospheric'
          ? 0.52
          : 0.32;
    score = weight * Math.max(floor, coverage);
  } else if (genericMatchedTokens.length > 0) {
    const genericFloor = matchClass === 'direct'
      ? 0.1
      : matchClass === 'visual'
        ? 0.08
        : matchClass === 'atmospheric'
          ? 0.06
          : 0.04;
    score = weight * genericFloor;
  } else {
    return null;
  }

  if (score <= 0) {
    return null;
  }

  return {
    shotId: '',
    momentId: moment?.id,
    confidence: Number(score.toFixed(2)),
    score,
    reason,
    matchClass,
  };
}

function bestOfQueries(
  queries: string[],
  values: string[],
  weight: number,
  reason: string,
  matchClass: ScoredCandidate['matchClass'],
  moment?: ShotVideoDescriptionMoment,
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;

  for (const query of queries) {
    const candidate = scoreQueryAgainstValues(query, values, weight, reason, matchClass, moment);
    if (!candidate) {
      continue;
    }

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function scoreTextValues(
  queries: string[],
  values: string[],
  weight: number,
  reason: string,
  matchClass: ScoredCandidate['matchClass'],
  moment?: ShotVideoDescriptionMoment,
): ScoredCandidate | null {
  return bestOfQueries(queries, values, weight, reason, matchClass, moment);
}

function scoreFallbackValues(
  queries: string[],
  values: string[],
  fallbackMode: NonNullable<GroundingPacket['fallbackMode']>,
  moment?: ShotVideoDescriptionMoment,
): ScoredCandidate | null {
  return bestOfQueries(
    queries,
    values,
    FALLBACK_MODIFIERS[fallbackMode],
    'Fallback grounding',
    'fallback',
    moment,
  );
}

export function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return CLASS_ORDER[right.matchClass] - CLASS_ORDER[left.matchClass];
}

function scoreShot(anchor: NarrationAnchor, shot: ShotMeta): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const videoDescription = shot.videoDescription;
  const groundedAnchor = groundScriptBlock({
    id: anchor.id,
    order: anchor.order,
    sourceText: anchor.sourceText,
    intent: anchor.intent,
  });

  const literalQueries = [anchor.label, anchor.sourceText];
  const visualQueries = groundedAnchor.grounding.visualQueries;
  const moodQueries = groundedAnchor.grounding.moodQueries;
  const fallbackQueries = [anchor.sourceText, anchor.label];

  if (videoDescription) {
    const descriptionValues = [
      ...videoDescription.matchHints,
      ...videoDescription.tags,
      videoDescription.summary,
    ];

    const literalCandidate = scoreTextValues(
      literalQueries,
      descriptionValues,
      CLASS_WEIGHTS.direct,
      'Literal grounding',
      'direct',
    );
    if (literalCandidate) {
      candidates.push(literalCandidate);
    }

    const visualCandidate = scoreTextValues(
      visualQueries,
      descriptionValues,
      CLASS_WEIGHTS.visual,
      'Visual grounding',
      'visual',
    );
    if (visualCandidate) {
      candidates.push(visualCandidate);
    }

    const moodCandidate = scoreTextValues(
      moodQueries,
      descriptionValues,
      CLASS_WEIGHTS.atmospheric,
      'Atmospheric grounding',
      'atmospheric',
    );
    if (moodCandidate) {
      candidates.push(moodCandidate);
    }

    for (const moment of videoDescription.moments) {
      const momentValues = [...moment.tags, moment.summary, moment.label];

      const momentLiteralCandidate = scoreTextValues(
        literalQueries,
        momentValues,
        CLASS_WEIGHTS.direct,
        'Literal grounding',
        'direct',
        moment,
      );
      if (momentLiteralCandidate) {
        candidates.push(momentLiteralCandidate);
      }

      const momentVisualCandidate = scoreTextValues(
        visualQueries,
        momentValues,
        CLASS_WEIGHTS.visual,
        'Visual grounding',
        'visual',
        moment,
      );
      if (momentVisualCandidate) {
        candidates.push(momentVisualCandidate);
      }

      const momentMoodCandidate = scoreTextValues(
        moodQueries,
        momentValues,
        CLASS_WEIGHTS.atmospheric,
        'Atmospheric grounding',
        'atmospheric',
        moment,
      );
      if (momentMoodCandidate) {
        candidates.push(momentMoodCandidate);
      }
    }
  }

  const fallbackCandidate = scoreFallbackValues(
    fallbackQueries,
    [shot.scene, shot.imagePrompt, shot.videoPrompt, shot.audioDescription],
    groundedAnchor.grounding.fallbackMode,
  );
  if (fallbackCandidate) {
    candidates.push(fallbackCandidate);
  }

  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      shotId: shot.id,
    }))
    .sort(compareScoredCandidates);

  return rankedCandidates.length > 0 ? [rankedCandidates[0]] : [];
}

function buildMatch(anchor: NarrationAnchor, shotCandidates: ScoredCandidate[]): AnchorMatch {
  const topCandidate = shotCandidates[0];
  if (!topCandidate || topCandidate.score < WEAK_MATCH_THRESHOLD) {
    return {
      anchorId: anchor.id,
      selectedShotId: undefined,
      selectedMomentId: undefined,
      confidence: 0,
      status: 'unmatched',
      candidates: [],
    };
  }

  return {
    anchorId: anchor.id,
    selectedShotId: topCandidate.shotId,
    selectedMomentId: topCandidate.momentId,
    confidence: topCandidate.confidence,
    status: topCandidate.score >= STRONG_MATCH_THRESHOLD ? 'matched' : 'weak_match',
    candidates: shotCandidates.map(({ shotId, momentId, confidence, reason }) => ({
      shotId,
      momentId,
      confidence,
      reason,
    })),
  };
}

export function summarizeAnchorCoverage(anchorMatches: AnchorMatch[]): AnchorCoverageSummary {
  return {
    totalAnchors: anchorMatches.length,
    matchedAnchors: anchorMatches.filter((match) => match.status === 'matched').length,
    weakMatches: anchorMatches.filter((match) => match.status === 'weak_match').length,
    unmatchedAnchors: anchorMatches.filter((match) => match.status === 'unmatched').length,
  };
}

export function matchNarrationAnchors(project: Project): {
  anchorMatches: AnchorMatch[];
  anchorCoverageSummary: AnchorCoverageSummary;
} {
  const anchors = [...(project.narrationAnchors ?? [])].sort((left, right) => left.order - right.order);
  const approvedShots = project.shots.filter((shot) => shot.status === 'approved');

  const anchorMatches = anchors.map((anchor) => {
    const shotCandidates = approvedShots
      .flatMap((shot) => scoreShot(anchor, shot))
      .sort(compareScoredCandidates)
      .slice(0, 3);

    return buildMatch(anchor, shotCandidates);
  });

  return {
    anchorMatches,
    anchorCoverageSummary: summarizeAnchorCoverage(anchorMatches),
  };
}
