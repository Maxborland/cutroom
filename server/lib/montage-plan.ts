import type {
  MontagePlan,
  MontageReview,
  Project,
  TimelineEntry,
  TransitionEntry,
  LowerThird,
  ShotMeta,
  SemanticBlock,
} from './storage.js';
import { buildSemanticBlockClips, buildSemanticBlocks } from './semantic-block-planner.js';

// ── Area detection keywords ──────────────────────────────────────────

const EXTERIOR_KEYWORDS = ['exterior', 'экстерьер', 'фасад', 'двор', 'улиц', 'аэриал', 'дрон', 'бассейн', 'парк', 'площад', 'панорам'];
const INTERIOR_KEYWORDS = ['interior', 'интерьер', 'лобби', 'гостин', 'кухн', 'спальн', 'ванн', 'холл', 'ресепшн', 'коридор', 'лифт'];
const AERIAL_KEYWORDS = ['дрон', 'аэриал', 'панорам', 'фасад', 'exterior'];
const DETAIL_KEYWORDS = ['деталь', 'крупный', 'текстур', 'close'];

// ── Helpers ──────────────────────────────────────────────────────────

function sceneLower(scene: string): string {
  return scene.toLowerCase();
}

function isExterior(scene: string): boolean {
  const s = sceneLower(scene);
  return EXTERIOR_KEYWORDS.some(kw => s.includes(kw));
}

function isInterior(scene: string): boolean {
  const s = sceneLower(scene);
  return INTERIOR_KEYWORDS.some(kw => s.includes(kw));
}

function isAerial(scene: string): boolean {
  const s = sceneLower(scene);
  return AERIAL_KEYWORDS.some(kw => s.includes(kw));
}

function isDetail(scene: string): boolean {
  const s = sceneLower(scene);
  return DETAIL_KEYWORDS.some(kw => s.includes(kw));
}

/** Extract a rough "area" label from scene text for lower-third detection */
function detectArea(scene: string): string {
  const s = sceneLower(scene);
  if (isInterior(s)) return 'interior';
  if (isExterior(s)) return 'exterior';
  return 'other';
}

/** Extract a human-readable area name from scene text for lower thirds */
function extractAreaLabel(scene: string): string {
  // Take first meaningful phrase from scene description
  const words = scene.split(/\s+/).slice(0, 4).join(' ');
  return words || scene;
}

type PlannedShot = {
  shot: ShotMeta;
  clipId: string;
  anchorId?: string;
  semanticBlockId?: string;
  selectedMoment?: NonNullable<ShotMeta['videoDescription']>['moments'][number];
  anchorStatus?: 'matched' | 'weak_match';
  semanticBlock?: SemanticBlock;
  pacingDurationSec?: number;
};

function makeFallbackClipId(shot: ShotMeta): string {
  return `clip-${shot.id}`;
}

function buildPlannedShots(project: Project, approvedShots: ShotMeta[]): PlannedShot[] {
  const shotById = new Map(approvedShots.map((shot) => [shot.id, shot]));
  const anchorOrder = new Map((project.narrationAnchors ?? []).map((anchor) => [anchor.id, anchor.order]));
  const usedShotIds = new Set<string>();
  const plannedShots: PlannedShot[] = [];

  const orderedMatches = [...(project.anchorMatches ?? [])]
    .sort((left, right) => (anchorOrder.get(left.anchorId) ?? Number.MAX_SAFE_INTEGER) - (anchorOrder.get(right.anchorId) ?? Number.MAX_SAFE_INTEGER));

  for (const match of orderedMatches) {
    if (match.status === 'unmatched' || !match.selectedShotId) {
      continue;
    }

    const shot = shotById.get(match.selectedShotId);
    if (!shot) {
      continue;
    }

    const selectedMoment = match.selectedMomentId
      ? shot.videoDescription?.moments.find((moment) => moment.id === match.selectedMomentId)
      : undefined;

    plannedShots.push({
      shot,
      clipId: match.anchorId ? `clip-${match.anchorId}` : `clip-${shot.id}`,
      anchorId: match.anchorId,
      selectedMoment,
      anchorStatus: match.status,
    });
    usedShotIds.add(shot.id);
  }

  for (const shot of approvedShots) {
    if (!usedShotIds.has(shot.id)) {
      plannedShots.push({ shot, clipId: makeFallbackClipId(shot) });
    }
  }

  return plannedShots.length > 0
    ? plannedShots
    : approvedShots.map((shot) => ({ shot, clipId: makeFallbackClipId(shot) }));
}

// ── Transition heuristics ────────────────────────────────────────────

function selectTransition(
  prevShot: ShotMeta | null,
  currentShot: ShotMeta,
  isFirstAfterIntro: boolean,
): { type: TransitionEntry['type']; durationSec: number } {
  const scene = currentShot.scene;

  // Rule 1: first shot after intro -> fade 0.5s
  if (isFirstAfterIntro) {
    return { type: 'fade', durationSec: 0.5 };
  }

  // Rule 2: aerial/drone/panorama/facade/exterior -> fade 0.5s
  if (isAerial(scene)) {
    return { type: 'fade', durationSec: 0.5 };
  }

  // Rule 3: detail/close-up/texture -> cut 0s
  if (isDetail(scene)) {
    return { type: 'cut', durationSec: 0 };
  }

  // Rule 4: interior <-> exterior switch -> crossfade 0.8s
  if (prevShot) {
    const prevIsInterior = isInterior(prevShot.scene);
    const prevIsExterior = isExterior(prevShot.scene);
    const currIsInterior = isInterior(scene);
    const currIsExterior = isExterior(scene);

    if ((prevIsInterior && currIsExterior) || (prevIsExterior && currIsInterior)) {
      return { type: 'crossfade', durationSec: 0.8 };
    }
  }

  // Rule 5: default -> crossfade 0.5s
  return { type: 'crossfade', durationSec: 0.5 };
}

function cloneTimelineEntry(entry: TimelineEntry): TimelineEntry {
  return {
    ...entry,
  }
}

function cloneSemanticBlocks(blocks?: SemanticBlock[]): SemanticBlock[] | undefined {
  if (!blocks) {
    return undefined
  }

  return blocks.map((block) => ({
    ...block,
    segments: block.segments.map((segment) => ({ ...segment })),
    explanation: block.explanation ? [...block.explanation] : undefined,
    alternatives: block.alternatives ? block.alternatives.map((alternative) => ({ ...alternative })) : undefined,
  }))
}

function selectFresherAlternative(block: SemanticBlock | undefined, currentShotId: string) {
  return block?.alternatives?.find((alternative) => alternative.shotId !== currentShotId)
}

function rebuildTimeline(plan: MontagePlan, timeline: TimelineEntry[], shotById: Map<string, ShotMeta>): MontagePlan {
  const clonedTimeline = timeline.map((entry) => cloneTimelineEntry(entry))
  const startSec = clonedTimeline[0]?.startSec ?? 0
  let currentSec = startSec

  const normalizedTimeline = clonedTimeline.map((entry) => {
    const normalized = {
      ...entry,
      startSec: currentSec,
    }
    currentSec += entry.durationSec
    return normalized
  })

  const transitions: TransitionEntry[] = normalizedTimeline.map((entry, index) => {
    const currentShot = shotById.get(entry.shotId) ?? ({
      id: entry.shotId,
      order: index,
      scene: '',
      audioDescription: '',
      imagePrompt: '',
      videoPrompt: '',
      duration: entry.durationSec,
      assetRefs: [],
      status: 'approved',
      generatedImages: [],
      enhancedImages: [],
      selectedImage: null,
      videoFile: null,
    } as ShotMeta)
    const prevEntry = index > 0 ? normalizedTimeline[index - 1] : undefined
    const prevShot = prevEntry ? (shotById.get(prevEntry.shotId) ?? ({
      id: prevEntry.shotId,
      order: index - 1,
      scene: '',
      audioDescription: '',
      imagePrompt: '',
      videoPrompt: '',
      duration: prevEntry.durationSec,
      assetRefs: [],
      status: 'approved',
      generatedImages: [],
      enhancedImages: [],
      selectedImage: null,
      videoFile: null,
    } as ShotMeta)) : null
    const { type, durationSec } = selectTransition(prevShot, currentShot, index === 0)

    return {
      fromClipId: index === 0 ? 'intro' : prevEntry?.clipId,
      toClipId: entry.clipId,
      fromShotId: index === 0 ? 'intro' : prevShot?.id ?? prevEntry?.shotId ?? 'intro',
      toShotId: currentShot.id,
      type,
      durationSec,
    }
  })

  return {
    ...plan,
    timeline: normalizedTimeline,
    transitions,
  }
}

function updateSemanticBlockForSwap(
  blocks: SemanticBlock[] | undefined,
  blockId: string | undefined,
  previousShotId: string,
  nextShotId: string,
  nextMomentId?: string,
): SemanticBlock[] | undefined {
  if (!blocks || !blockId) {
    return blocks
  }

  return blocks.map((block) => {
    if (block.id !== blockId) {
      return block
    }

    const segments = block.segments.map((segment) => {
      if (segment.shotId !== previousShotId) {
        return segment
      }

      return {
        ...segment,
        shotId: nextShotId,
        momentId: nextMomentId ?? segment.momentId,
      }
    })

    return {
      ...block,
      segments,
    }
  })
}

export function applyMontageReviewAutoFixes(project: Project, montagePlan: MontagePlan, review: MontageReview): MontagePlan {
  if (!review.autoFixes.length) {
    return montagePlan
  }

  const shotById = new Map((project.shots ?? []).map((shot) => [shot.id, shot]))
  let timeline = montagePlan.timeline.map((entry) => cloneTimelineEntry(entry))
  let semanticBlocks = cloneSemanticBlocks(montagePlan.semanticBlocks)

  for (const autoFix of review.autoFixes) {
    if (autoFix.applied) {
      continue
    }

    const affectedClipId = autoFix.affectedClipIds[0]
    if (!affectedClipId) {
      continue
    }

    const index = timeline.findIndex((entry) => entry.clipId === affectedClipId)
    if (index < 0) {
      continue
    }

    if (autoFix.type === 'move_repeat') {
      const nextIndex = index + 1
      if (nextIndex < timeline.length) {
        ;[timeline[index], timeline[nextIndex]] = [timeline[nextIndex], timeline[index]]
      }
      continue
    }

    if (autoFix.type === 'swap_candidate') {
      const entry = timeline[index]
      const block = semanticBlocks?.find((candidate) => candidate.id === entry.semanticBlockId)
      const fresherAlternative = selectFresherAlternative(block, entry.shotId)
      if (!fresherAlternative) {
        continue
      }

      timeline[index] = {
        ...entry,
        shotId: fresherAlternative.shotId,
        clipFile: `montage/normalized/${fresherAlternative.shotId}.mp4`,
        selectedMomentId: fresherAlternative.momentId ?? entry.selectedMomentId,
      }
      semanticBlocks = updateSemanticBlockForSwap(
        semanticBlocks,
        entry.semanticBlockId,
        entry.shotId,
        fresherAlternative.shotId,
        fresherAlternative.momentId,
      )
      continue
    }

    if (autoFix.type === 'split_clip') {
      const entry = timeline[index]
      if (entry.durationSec <= 0) {
        continue
      }

      const firstDuration = Math.max(Math.round(entry.durationSec / 2), 1)
      const secondDuration = Math.max(entry.durationSec - firstDuration, 1)
      const duplicate: TimelineEntry = {
        ...entry,
        clipId: entry.clipId ? `${entry.clipId}-split` : `clip-${entry.shotId}-split`,
        durationSec: secondDuration,
      }

      timeline[index] = {
        ...entry,
        durationSec: firstDuration,
      }

      const insertAt = Math.min(index + 2, timeline.length)
      timeline.splice(insertAt, 0, duplicate)
      continue
    }

    if (autoFix.type === 'change_block_strategy') {
      const affectedClipIds = new Set(autoFix.affectedClipIds)
      const targetBlockId = timeline.find((entry) => {
        const clipId = entry.clipId ?? `clip-${entry.shotId}`
        return affectedClipIds.has(clipId)
      })?.semanticBlockId

      if (!targetBlockId) {
        continue
      }

      let retainedCount = 0
      timeline = timeline.map((entry) => {
        if (entry.semanticBlockId !== targetBlockId) {
          return entry
        }

        retainedCount += 1
        if (retainedCount <= 2) {
          return entry
        }

        return {
          ...entry,
          semanticBlockId: undefined,
        }
      })

      semanticBlocks = semanticBlocks?.map((block) => {
        if (block.id !== targetBlockId) {
          return block
        }

        return {
          ...block,
          strategy: 'pair',
          segments: block.segments.slice(0, 2).map((segment) => ({ ...segment })),
        }
      })
    }
  }

  return rebuildTimeline(
    {
      ...montagePlan,
      semanticBlocks,
    },
    timeline,
    shotById,
  )
}

// ── Main generation function ─────────────────────────────────────────

export function generateMontagePlan(project: Project, voiceoverDurationSec: number): MontagePlan {
  // Step 1: Filter and sort approved shots
  const approvedShots = project.shots
    .filter(s => s.status === 'approved')
    .sort((a, b) => a.order - b.order);

  if (approvedShots.length === 0) {
    throw new Error('No approved shots to generate montage plan');
  }

  const INTRO_DURATION = 3;
  const OUTRO_DURATION = 4;
  const MIN_CLIP_DURATION = 2;
  const semanticBlocks = buildSemanticBlocks(project, approvedShots);
  const semanticBlockClips = buildSemanticBlockClips(project, approvedShots);
  const plannedShots = semanticBlockClips.length > 0
    ? (() => {
      const usedShotIds = new Set(semanticBlockClips.map((clip) => clip.shot.id));
      const fallbackShots = approvedShots
        .filter((shot) => !usedShotIds.has(shot.id))
        .map((shot) => ({
          shot,
          clipId: `clip-${shot.id}`,
        }));

      return [
        ...semanticBlockClips.map((clip) => ({
          shot: clip.shot,
          clipId: clip.clipId,
          anchorId: clip.anchorId,
          semanticBlockId: clip.semanticBlockId,
          selectedMoment: clip.selectedMoment,
          semanticBlock: clip.semanticBlock,
          pacingDurationSec: clip.pacingDurationSec,
        })),
        ...fallbackShots,
      ];
    })()
    : buildPlannedShots(project, approvedShots);

  // Step 2: Total available time for shots = voiceover duration
  const availableTime = voiceoverDurationSec;

  // Step 3: Calculate total source shot durations
  const totalShotDuration = plannedShots.reduce((sum, entry) => sum + (entry.pacingDurationSec ?? entry.shot.duration), 0);

  // Step 4: Distribute durations proportionally with minimum floor
  // Guard: if total minimum exceeds available time, expand available time
  const minTotal = plannedShots.length * MIN_CLIP_DURATION;
  const effectiveAvailable = Math.max(availableTime, minTotal);

  let allocatedDurations = plannedShots.map(({ shot, pacingDurationSec }) => {
    const sourceDuration = pacingDurationSec ?? shot.duration;
    const proportional = (sourceDuration / totalShotDuration) * effectiveAvailable;
    return Math.max(proportional, MIN_CLIP_DURATION);
  });

  // Normalize to fit exactly into effectiveAvailable
  const totalAllocated = allocatedDurations.reduce((sum, d) => sum + d, 0);
  if (totalAllocated !== effectiveAvailable && totalAllocated > 0) {
    const scale = effectiveAvailable / totalAllocated;
    allocatedDurations = allocatedDurations.map(d => {
      const scaled = d * scale;
      return Math.max(scaled, MIN_CLIP_DURATION);
    });
    // Final pass: adjust to sum exactly
    const finalTotal = allocatedDurations.reduce((sum, d) => sum + d, 0);
    if (finalTotal !== effectiveAvailable && allocatedDurations.length > 0) {
      allocatedDurations[0] += effectiveAvailable - finalTotal;
    }
  }

  // Step 5: Build timeline entries
  let currentSec = INTRO_DURATION;
  const timeline: TimelineEntry[] = [];

  for (let i = 0; i < plannedShots.length; i++) {
    const plannedShot = plannedShots[i];
    const shot = plannedShot.shot;
    const duration = allocatedDurations[i];

    const entry: TimelineEntry = {
      clipId: plannedShot.clipId,
      shotId: shot.id,
      anchorId: plannedShot.anchorId,
      semanticBlockId: plannedShot.semanticBlockId,
      selectedMomentId: plannedShot.selectedMoment?.id,
      clipFile: `montage/normalized/${shot.id}.mp4`,
      startSec: currentSec,
      durationSec: duration,
    };

    if (plannedShot.selectedMoment) {
      if (plannedShot.selectedMoment.startSec !== undefined) {
        entry.trimStartSec = plannedShot.selectedMoment.startSec;
      }
      if (plannedShot.selectedMoment.endSec !== undefined) {
        entry.trimEndSec = plannedShot.selectedMoment.endSec;
      }
    }

    // If source is shorter, mark as needing extension (hold last frame)
    if (shot.duration < duration) {
      entry.motionEffect = 'ken_burns';
    }

    // If source is longer, store the absolute media out-point in seconds.
    if (!plannedShot.selectedMoment && shot.duration > duration) {
      entry.trimEndSec = duration;
    }

    timeline.push(entry);
    currentSec += duration;
  }

  // Step 6: Build transitions
  const transitions: TransitionEntry[] = [];

  for (let i = 0; i < plannedShots.length; i++) {
    const prevPlannedShot = i === 0 ? null : plannedShots[i - 1];
    const prevShot = prevPlannedShot?.shot ?? null;
    const currentPlannedShot = plannedShots[i];
    const currentShot = currentPlannedShot.shot;
    const isFirstAfterIntro = i === 0;

    const { type, durationSec } = selectTransition(prevShot, currentShot, isFirstAfterIntro);

    transitions.push({
      fromClipId: i === 0 ? 'intro' : prevPlannedShot!.clipId,
      toClipId: currentPlannedShot.clipId,
      fromShotId: i === 0 ? 'intro' : prevShot!.id,
      toShotId: currentShot.id,
      type,
      durationSec,
    });
  }

  // Step 7: Detect area changes for lower thirds
  const lowerThirds: LowerThird[] = [];
  let lastArea = '';

  for (let i = 0; i < plannedShots.length; i++) {
    const shot = plannedShots[i].shot;
    const area = detectArea(shot.scene);

    if (area !== lastArea) {
      lowerThirds.push({
        shotId: shot.id,
        text: extractAreaLabel(shot.scene),
        position: 'bottom_left',
        appearAtSec: 0.5,
        durationSec: 3,
      });
      lastArea = area;
    }
  }

  // Step 8: Build the full plan
  const plan: MontagePlan = {
    version: 1,
    format: {
      width: 3840,
      height: 2160,
      fps: 30,
    },
    timeline,
    transitions,
    motionGraphics: {
      intro: {
        title: project.name,
        durationSec: INTRO_DURATION,
        animation: 'fade_in',
      },
      lowerThirds,
      outro: {
        title: project.name,
        durationSec: OUTRO_DURATION,
        animation: 'fade_in',
      },
    },
    audio: {
      voiceover: {
        file: project.voiceoverFile || '',
        gainDb: 0,
      },
      music: {
        file: project.musicFile || '',
        gainDb: -18,
        duckingDb: -10,
        duckFadeMs: 500,
      },
    },
    semanticBlocks: semanticBlocks.length > 0 ? semanticBlocks : undefined,
    style: {
      preset: 'premium',
      fontFamily: 'Montserrat',
      primaryColor: '#1a1a2e',
      secondaryColor: '#e2b44d',
      textColor: '#ffffff',
    },
  };

  return plan;
}
