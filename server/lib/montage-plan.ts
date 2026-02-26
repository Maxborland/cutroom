import type { Project, MontagePlan, TimelineEntry, TransitionEntry, LowerThird, ShotMeta } from './storage.js';

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

  // Step 2: Total available time for shots = voiceover duration
  const availableTime = voiceoverDurationSec;

  // Step 3: Calculate total source shot durations
  const totalShotDuration = approvedShots.reduce((sum, s) => sum + s.duration, 0);

  // Step 4: Distribute durations proportionally with minimum floor
  let allocatedDurations = approvedShots.map(shot => {
    const proportional = (shot.duration / totalShotDuration) * availableTime;
    return Math.max(proportional, MIN_CLIP_DURATION);
  });

  // Normalize to fit exactly into availableTime
  const totalAllocated = allocatedDurations.reduce((sum, d) => sum + d, 0);
  if (totalAllocated !== availableTime && totalAllocated > 0) {
    const scale = availableTime / totalAllocated;
    allocatedDurations = allocatedDurations.map(d => {
      const scaled = d * scale;
      return Math.max(scaled, MIN_CLIP_DURATION);
    });
    // Final pass: adjust to sum exactly
    const finalTotal = allocatedDurations.reduce((sum, d) => sum + d, 0);
    if (finalTotal !== availableTime && allocatedDurations.length > 0) {
      allocatedDurations[0] += availableTime - finalTotal;
    }
  }

  // Step 5: Build timeline entries
  let currentSec = INTRO_DURATION;
  const timeline: TimelineEntry[] = [];

  for (let i = 0; i < approvedShots.length; i++) {
    const shot = approvedShots[i];
    const duration = allocatedDurations[i];

    const entry: TimelineEntry = {
      shotId: shot.id,
      clipFile: `montage/normalized/${shot.id}.mp4`,
      startSec: currentSec,
      durationSec: duration,
    };

    // If source is shorter, mark as needing extension (hold last frame)
    if (shot.duration < duration) {
      entry.motionEffect = 'ken_burns';
    }

    // If source is longer, trim end
    if (shot.duration > duration) {
      entry.trimEndSec = shot.duration - duration;
    }

    timeline.push(entry);
    currentSec += duration;
  }

  // Step 6: Build transitions
  const transitions: TransitionEntry[] = [];

  for (let i = 0; i < approvedShots.length; i++) {
    const prevShot = i === 0 ? null : approvedShots[i - 1];
    const currentShot = approvedShots[i];
    const isFirstAfterIntro = i === 0;

    const { type, durationSec } = selectTransition(prevShot, currentShot, isFirstAfterIntro);

    transitions.push({
      fromShotId: i === 0 ? 'intro' : prevShot!.id,
      toShotId: currentShot.id,
      type,
      durationSec,
    });
  }

  // Step 7: Detect area changes for lower thirds
  const lowerThirds: LowerThird[] = [];
  let lastArea = '';

  for (let i = 0; i < approvedShots.length; i++) {
    const shot = approvedShots[i];
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
