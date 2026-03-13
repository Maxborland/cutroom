import type {
  AnchorCoverageSummary,
  AnchorMatch,
  AnchorMatchCandidate,
  NarrationAnchor,
  Project,
  ShotMeta,
  ShotVideoDescriptionMoment,
} from './storage.js';

const STRONG_MATCH_THRESHOLD = 0.75;
const WEAK_MATCH_THRESHOLD = 0.35;

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'по', 'для', 'к', 'ко', 'у', 'о', 'об', 'от',
  'из', 'за', 'под', 'над', 'это', 'эта', 'этот', 'эти', 'или', 'но', 'а', 'же',
  'the', 'and', 'for', 'with', 'into', 'over',
]);

interface ScoredCandidate extends AnchorMatchCandidate {
  score: number;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function overlapRatio(anchorTokens: string[], candidateTokens: string[]): number {
  if (anchorTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const hits = anchorTokens.filter((token) => candidateSet.has(token)).length;
  return hits / anchorTokens.length;
}

function scoreTextValues(
  anchor: NarrationAnchor,
  values: string[],
  weight: number,
  reason: string,
  moment?: ShotVideoDescriptionMoment,
): ScoredCandidate | null {
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean);
  if (normalizedValues.length === 0) {
    return null;
  }

  const anchorPhrases = [anchor.label, anchor.sourceText]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const normalizedCandidates = normalizedValues.map((value) => normalizeText(value));
  const exactPhraseMatch = anchorPhrases.some((phrase) =>
    normalizedCandidates.some((candidate) => candidate.includes(phrase)),
  );

  const anchorTokens = uniqueTokens([anchor.label, anchor.sourceText]);
  const candidateTokens = uniqueTokens(normalizedValues);
  const ratio = overlapRatio(anchorTokens, candidateTokens);
  const score = Math.max(exactPhraseMatch ? weight : 0, ratio * weight);

  if (score <= 0) {
    return null;
  }

  return {
    shotId: '',
    momentId: moment?.id,
    confidence: Number(score.toFixed(2)),
    score,
    reason,
  };
}

function scoreShot(anchor: NarrationAnchor, shot: ShotMeta): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const videoDescription = shot.videoDescription;

  if (videoDescription) {
    const hintCandidate = scoreTextValues(anchor, videoDescription.matchHints, 1, 'Совпадение по videoDescription.matchHints');
    if (hintCandidate) candidates.push(hintCandidate);

    const tagCandidate = scoreTextValues(anchor, videoDescription.tags, 0.82, 'Совпадение по videoDescription.tags');
    if (tagCandidate) candidates.push(tagCandidate);

    const summaryCandidate = scoreTextValues(anchor, [videoDescription.summary], 0.72, 'Совпадение по videoDescription.summary');
    if (summaryCandidate) candidates.push(summaryCandidate);

    for (const moment of videoDescription.moments) {
      const momentTagsCandidate = scoreTextValues(
        anchor,
        moment.tags,
        0.76,
        'Совпадение по videoDescription.moments.tags',
        moment,
      );
      if (momentTagsCandidate) candidates.push(momentTagsCandidate);

      const momentSummaryCandidate = scoreTextValues(
        anchor,
        [moment.summary, moment.label],
        0.56,
        'Совпадение по videoDescription.moments.summary',
        moment,
      );
      if (momentSummaryCandidate) candidates.push(momentSummaryCandidate);
    }
  }

  const fallbackCandidate = scoreTextValues(
    anchor,
    [shot.scene, shot.imagePrompt, shot.videoPrompt, shot.audioDescription],
    0.34,
    'Совпадение по scene/imagePrompt/videoPrompt',
  );
  if (fallbackCandidate) candidates.push(fallbackCandidate);

  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      shotId: shot.id,
    }))
    .sort((left, right) => right.score - left.score);

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
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    return buildMatch(anchor, shotCandidates);
  });

  return {
    anchorMatches,
    anchorCoverageSummary: summarizeAnchorCoverage(anchorMatches),
  };
}
