import path from 'node:path';
import { probeDuration } from './normalize.js';
import {
  resolveProjectPath,
  type Project as CutRoomProject,
  type ShotMeta,
  type TimelineEntry,
  type TransitionEntry,
} from './storage.js';

export type OpenReelTransitionType =
  | 'crossfade'
  | 'dipToBlack'
  | 'dipToWhite'
  | 'wipe'
  | 'slide'
  | 'zoom'
  | 'push';

export interface OpenReelProjectSettings {
  width: number;
  height: number;
  frameRate: number;
  sampleRate: number;
  channels: number;
}

export interface OpenReelMediaMetadata {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  sampleRate: number;
  channels: number;
  fileSize: number;
}

export interface OpenReelMediaItem {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  fileHandle: null;
  blob: null;
  metadata: OpenReelMediaMetadata;
  thumbnailUrl: string | null;
  waveformData: null;
  filmstripThumbnails?: Array<{ timestamp: number; url: string }>;
  isPlaceholder?: boolean;
  originalUrl?: string;
}

export interface OpenReelEffect {
  id: string;
  type: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface OpenReelTransform {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  anchor: { x: number; y: number };
  opacity: number;
}

export interface OpenReelKeyframe {
  id: string;
  time: number;
  property: string;
  value: unknown;
  easing: string;
}

export interface OpenReelClip {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: OpenReelEffect[];
  audioEffects: OpenReelEffect[];
  transform: OpenReelTransform;
  volume: number;
  keyframes: OpenReelKeyframe[];
  metadata?: Record<string, unknown>;
}

export interface OpenReelTransition {
  id: string;
  clipAId: string;
  clipBId: string;
  type: OpenReelTransitionType;
  duration: number;
  params: Record<string, unknown>;
}

export interface OpenReelTrack {
  id: string;
  type: 'video' | 'audio' | 'image' | 'text' | 'graphics';
  name: string;
  clips: OpenReelClip[];
  transitions: OpenReelTransition[];
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
}

export interface OpenReelSubtitle {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface OpenReelMarker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface OpenReelTimeline {
  tracks: OpenReelTrack[];
  subtitles: OpenReelSubtitle[];
  duration: number;
  markers: OpenReelMarker[];
}

export interface OpenReelProject {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  settings: OpenReelProjectSettings;
  mediaLibrary: {
    items: OpenReelMediaItem[];
  };
  timeline: OpenReelTimeline;
}

export interface OpenReelBundle {
  version: '1.0.0';
  project: OpenReelProject;
  mediaManifest: Record<string, {
    url: string;
    mimeType: string;
    kind: 'shot' | 'voiceover' | 'music';
    shotId?: string;
  }>;
  semanticSummary?: {
    anchors: number;
    matched: number;
    weak: number;
    unmatched: number;
  };
}

const DEFAULT_VIDEO_DURATION_SEC = 4;
const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_CHANNELS = 2;

const DEFAULT_TRANSFORM: OpenReelTransform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

function toTimestamp(value: string | undefined): number {
  if (!value) return Date.now();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

function guessMimeType(fileRef: string | undefined, type: 'video' | 'audio'): string {
  const ext = path.extname(fileRef ?? '').toLowerCase();
  if (type === 'video') {
    return VIDEO_MIME_BY_EXT[ext] || 'video/mp4';
  }
  return AUDIO_MIME_BY_EXT[ext] || 'audio/mpeg';
}

function clampPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dbToLinear(gainDb: number | undefined): number {
  if (!Number.isFinite(gainDb)) return 1;
  const linear = Math.pow(10, (gainDb as number) / 20);
  if (!Number.isFinite(linear) || linear < 0) return 1;
  return linear;
}

function createTrack(id: string, type: OpenReelTrack['type'], name: string): OpenReelTrack {
  return {
    id,
    type,
    name,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

function createClip(params: {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  volume?: number;
  metadata?: Record<string, unknown>;
}): OpenReelClip {
  const duration = clampPositiveNumber(params.duration, DEFAULT_VIDEO_DURATION_SEC);
  return {
    id: params.id,
    mediaId: params.mediaId,
    trackId: params.trackId,
    startTime: Math.max(params.startTime, 0),
    duration,
    inPoint: params.inPoint ?? 0,
    outPoint: params.outPoint ?? duration,
    effects: [],
    audioEffects: [],
    transform: DEFAULT_TRANSFORM,
    volume: clampPositiveNumber(params.volume ?? 1, 1),
    keyframes: [],
    metadata: params.metadata,
  };
}

function isLegacyTailTrimEntry(entry: TimelineEntry, sourceDuration: number): boolean {
  void sourceDuration;
  if (!Number.isFinite(entry.trimEndSec)) return false;
  if (Number.isFinite(entry.trimStartSec)) return false;
  if (entry.selectedMomentId) return false;
  return (entry.trimEndSec as number) >= 0 && (entry.trimEndSec as number) < entry.durationSec;
}

function resolveClipTiming(entry: TimelineEntry, sourceDuration: number) {
  const requestedStart = Number.isFinite(entry.trimStartSec) ? Math.max(entry.trimStartSec ?? 0, 0) : 0;
  const inPoint = Math.min(requestedStart, sourceDuration);
  const isLegacyTailTrim = isLegacyTailTrimEntry(entry, sourceDuration);
  const requestedEnd = Number.isFinite(entry.trimEndSec)
    ? Math.max(
      isLegacyTailTrim
        ? inPoint + clampPositiveNumber(entry.durationSec, sourceDuration)
        : (entry.trimEndSec ?? 0),
      inPoint,
    )
    : null;
  const boundedEnd = requestedEnd === null ? null : Math.min(requestedEnd, sourceDuration);
  const duration = boundedEnd === null
    ? clampPositiveNumber(entry.durationSec, sourceDuration)
    : Math.max(boundedEnd - inPoint, 0);
  const outPoint = boundedEnd === null ? Math.min(inPoint + duration, sourceDuration) : boundedEnd;

  return {
    startTime: Math.max(entry.startSec, 0),
    duration,
    inPoint,
    outPoint,
  };
}

function buildSemanticSummary(project: CutRoomProject): OpenReelBundle['semanticSummary'] | undefined {
  if (project.anchorCoverageSummary) {
    return {
      anchors: project.anchorCoverageSummary.totalAnchors,
      matched: project.anchorCoverageSummary.matchedAnchors,
      weak: project.anchorCoverageSummary.weakMatches,
      unmatched: project.anchorCoverageSummary.unmatchedAnchors,
    };
  }

  if (!project.anchorMatches || project.anchorMatches.length === 0) {
    return undefined;
  }

  return {
    anchors: project.anchorMatches.length,
    matched: project.anchorMatches.filter((match) => match.status === 'matched').length,
    weak: project.anchorMatches.filter((match) => match.status === 'weak_match').length,
    unmatched: project.anchorMatches.filter((match) => match.status === 'unmatched').length,
  };
}

function getTimelineEntryIdentity(entry: Pick<TimelineEntry, 'clipId' | 'shotId'>, index: number): string {
  const clipId = entry.clipId?.trim();
  if (clipId) return clipId;

  const shotId = entry.shotId?.trim();
  return shotId ? `clip-${shotId}-${index + 1}` : `clip-unknown-${index + 1}`;
}

function getExportTimelineEntries(project: CutRoomProject): Array<TimelineEntry & { clipId: string }> {
  if (!project.montagePlan?.timeline?.length) {
    return [];
  }

  return [...project.montagePlan.timeline]
    .sort((left, right) => {
      const leftStart = Number.isFinite(left.startSec) ? left.startSec : 0;
      const rightStart = Number.isFinite(right.startSec) ? right.startSec : 0;
      if (leftStart !== rightStart) return leftStart - rightStart;
      const leftId = left.clipId?.trim() || left.shotId;
      const rightId = right.clipId?.trim() || right.shotId;
      return leftId.localeCompare(rightId);
    })
    .map((entry, index) => ({
      ...entry,
      clipId: getTimelineEntryIdentity(entry, index),
    }));
}

function buildSemanticClipMetadata(
  project: CutRoomProject,
  entry: TimelineEntry & { clipId: string },
): Record<string, unknown> | undefined {
  if (!entry.anchorId && !entry.semanticBlockId) {
    return undefined;
  }

  const anchorById = new Map((project.narrationAnchors ?? []).map((anchor) => [anchor.id, anchor]));
  const matchByAnchorId = new Map((project.anchorMatches ?? []).map((match) => [match.anchorId, match]));
  const semanticBlocks = project.montagePlan?.semanticBlocks ?? project.semanticBlocks ?? [];
  const semanticBlockById = new Map(semanticBlocks.map((block) => [block.id, block]));
  const semanticBlock = entry.semanticBlockId ? semanticBlockById.get(entry.semanticBlockId) : undefined;
  const resolvedAnchorId = entry.anchorId ?? semanticBlock?.anchorId;
  const anchor = resolvedAnchorId ? anchorById.get(resolvedAnchorId) : undefined;
  const match = resolvedAnchorId ? matchByAnchorId.get(resolvedAnchorId) : undefined;

  const matchedCandidate = match?.candidates.find((candidate) => (
    candidate.shotId === entry.shotId
    && (candidate.momentId ?? undefined) === (entry.selectedMomentId ?? undefined)
  )) ?? match?.candidates.find((candidate) => candidate.shotId === entry.shotId);

  return {
    cutroomSemantic: {
      clipId: entry.clipId,
      anchorId: resolvedAnchorId,
      anchorLabel: anchor?.label ?? semanticBlock?.anchorLabel,
      anchorSourceText: anchor?.sourceText ?? semanticBlock?.anchorText,
      matchStatus: match?.status ?? (entry.selectedMomentId ? 'matched' : undefined),
      matchConfidence: match?.confidence,
      semanticBlockId: semanticBlock?.id ?? entry.semanticBlockId,
      semanticBlockStrategy: semanticBlock?.strategy,
      semanticBlockConfidence: semanticBlock?.confidence,
      selectedMomentId: entry.selectedMomentId,
      reason: matchedCandidate?.reason,
      trimStartSec: entry.trimStartSec,
      trimEndSec: entry.trimEndSec,
    },
  };
}

function createMediaItem(params: {
  id: string;
  name: string;
  type: 'video' | 'audio';
  duration: number;
  width?: number;
  height?: number;
  frameRate?: number;
}): OpenReelMediaItem {
  return {
    id: params.id,
    name: params.name,
    type: params.type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration: clampPositiveNumber(params.duration, DEFAULT_VIDEO_DURATION_SEC),
      width: params.width ?? 0,
      height: params.height ?? 0,
      frameRate: params.frameRate ?? 0,
      codec: '',
      sampleRate: params.type === 'audio' ? DEFAULT_SAMPLE_RATE : 0,
      channels: params.type === 'audio' ? DEFAULT_CHANNELS : 0,
      fileSize: 0,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]?/g) ?? [];
  const sentences = matches.map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length > 0) {
    return sentences;
  }

  const normalized = text.trim();
  return normalized ? [normalized] : [];
}

export function buildSubtitles(script: string, durationSec: number): OpenReelSubtitle[] {
  const sentences = splitIntoSentences(script);
  if (sentences.length === 0) {
    return [];
  }

  const totalDuration = clampPositiveNumber(durationSec, Math.max(1, sentences.length * 2));
  const weights = sentences.map((sentence) => Math.max(sentence.replace(/\s+/g, '').length, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return sentences.map((sentence, index) => {
    const isLast = index === sentences.length - 1;
    const portion = totalWeight > 0 ? weights[index] / totalWeight : 1 / sentences.length;
    const segmentDuration = isLast ? totalDuration - cursor : totalDuration * portion;
    const endTime = Math.min(totalDuration, Math.max(cursor, cursor + segmentDuration));

    const subtitle: OpenReelSubtitle = {
      id: `subtitle-${index + 1}`,
      text: sentence,
      startTime: cursor,
      endTime,
    };

    cursor = endTime;
    return subtitle;
  });
}

interface MappedTransition {
  type: OpenReelTransitionType;
  params: Record<string, unknown>;
}

export function mapCutRoomTransition(type: TransitionEntry['type']): MappedTransition | null {
  switch (type) {
    case 'cut':
      return null;
    case 'crossfade':
      return { type: 'crossfade', params: { curve: 'ease' } };
    case 'fade':
      return { type: 'dipToBlack', params: { holdDuration: 0.1 } };
    case 'slide_left':
      return { type: 'slide', params: { direction: 'left', pushOut: false } };
    case 'slide_right':
      return { type: 'slide', params: { direction: 'right', pushOut: false } };
    case 'zoom_blur':
      return { type: 'zoom', params: { scale: 2, center: { x: 0.5, y: 0.5 }, blur: true } };
    case 'wipe':
      return { type: 'wipe', params: { direction: 'right', softness: 0 } };
    default:
      return null;
  }
}

function getShotsByTimelineOrder(project: CutRoomProject): ShotMeta[] {
  const approvedWithVideo = project.shots
    .filter((shot) => shot.status === 'approved' && Boolean(shot.videoFile));

  if (!project.montagePlan?.timeline?.length) {
    return [...approvedWithVideo].sort((a, b) => a.order - b.order);
  }

  const byId = new Map(approvedWithVideo.map((shot) => [shot.id, shot]));
  const seen = new Set<string>();
  const ordered: ShotMeta[] = [];

  const timelineEntries = getExportTimelineEntries(project);
  for (const entry of timelineEntries) {
    const shot = byId.get(entry.shotId);
    if (!shot || seen.has(shot.id)) continue;
    ordered.push(shot);
    seen.add(shot.id);
  }

  const remaining = approvedWithVideo
    .filter((shot) => !seen.has(shot.id))
    .sort((a, b) => a.order - b.order);

  return [...ordered, ...remaining];
}

function getClipSources(project: CutRoomProject): Array<{ shot: ShotMeta; entry?: TimelineEntry & { clipId: string } }> {
  const approvedById = new Map(
    project.shots
      .filter((shot) => shot.status === 'approved' && Boolean(shot.videoFile))
      .map((shot) => [shot.id, shot]),
  );

  const timelineEntries = getExportTimelineEntries(project);
  if (timelineEntries.length > 0) {
    return timelineEntries.flatMap((entry) => {
      const shot = approvedById.get(entry.shotId);
      return shot ? [{ shot, entry }] : [];
    });
  }

  return [...approvedById.values()]
    .sort((left, right) => left.order - right.order)
    .map((shot) => ({ shot }));
}

function resolveShotVideoPath(projectId: string, shot: ShotMeta): string | null {
  if (!shot.videoFile || isExternalMediaRef(shot.videoFile)) return null;
  if (shot.videoFile.includes('/') || shot.videoFile.includes('\\')) {
    return resolveProjectPath(projectId, shot.videoFile);
  }
  return resolveProjectPath(projectId, 'shots', shot.id, 'video', shot.videoFile);
}

async function readDurationOrFallback(filePath: string | null, fallback: number): Promise<number> {
  if (!filePath) return fallback;
  try {
    const duration = await probeDuration(filePath);
    return clampPositiveNumber(duration, fallback);
  } catch {
    return fallback;
  }
}

export async function buildOpenReelBundle(
  project: CutRoomProject,
  baseUrl: string,
): Promise<OpenReelBundle> {
  const cleanedBaseUrl = sanitizeBaseUrl(baseUrl);
  const format = project.montagePlan?.format;
  const width = clampPositiveNumber(format?.width ?? 1920, 1920);
  const height = clampPositiveNumber(format?.height ?? 1080, 1080);
  const frameRate = clampPositiveNumber(format?.fps ?? 30, 30);

  const mediaManifest: OpenReelBundle['mediaManifest'] = {};
  const mediaItems: OpenReelMediaItem[] = [];
  const tracks: OpenReelTrack[] = [];
  const semanticSummary = buildSemanticSummary(project);

  const videoTrack = createTrack('track-video', 'video', 'Video');
  const timelineEntries = getExportTimelineEntries(project);
  const exportShots = getShotsByTimelineOrder(project);
  const clipSources = getClipSources(project);
  const shotClipIds = new Map<string, string>();
  const timelineClipIdsByIdentity = new Map<string, string>();
  const sourceDurationByShotId = new Map<string, number>();
  for (const entry of timelineEntries) {
    const clipId = entry.clipId?.trim();
    const shotId = entry.shotId?.trim();
    if (clipId) timelineClipIdsByIdentity.set(clipId, clipId);
    if (shotId && !timelineClipIdsByIdentity.has(shotId)) {
      timelineClipIdsByIdentity.set(shotId, clipId ?? `clip-${shotId}`);
    }
  }

  for (const shot of exportShots) {
    const mediaId = `media-shot-${shot.id}`;
    const fallbackDuration = clampPositiveNumber(shot.duration, DEFAULT_VIDEO_DURATION_SEC);
    const shotPath = resolveShotVideoPath(project.id, shot);
    const sourceDuration = await readDurationOrFallback(shotPath, fallbackDuration);
    sourceDurationByShotId.set(shot.id, sourceDuration);

    mediaItems.push(createMediaItem({
      id: mediaId,
      name: `${shot.id}${path.extname(shot.videoFile ?? '') || '.mp4'}`,
      type: 'video',
      duration: sourceDuration, // source media duration (full file)
      width,
      height,
      frameRate,
    }));

    const videoFilename = shot.videoFile ? path.basename(shot.videoFile) : `${shot.id}.mp4`;
    mediaManifest[mediaId] = {
      url: shot.videoFile && isExternalMediaRef(shot.videoFile)
        ? shot.videoFile
        : `${cleanedBaseUrl}/shots/${encodeURIComponent(shot.id)}/video/${encodeURIComponent(videoFilename)}`,
      mimeType: guessMimeType(shot.videoFile ?? undefined, 'video'),
      kind: 'shot',
      shotId: shot.id,
    };
  }

  for (const { shot, entry } of clipSources) {
    const mediaId = `media-shot-${shot.id}`;
    const clipId = entry?.clipId ?? `clip-shot-${shot.id}`;
    const sourceDuration = sourceDurationByShotId.get(shot.id)
      ?? clampPositiveNumber(shot.duration, DEFAULT_VIDEO_DURATION_SEC);

    const clipTiming = entry
      ? resolveClipTiming(entry, sourceDuration)
      : {
          startTime: videoTrack.clips.reduce((sum, clip) => sum + clip.duration, 0),
          duration: sourceDuration,
          inPoint: 0,
          outPoint: sourceDuration,
        };

    videoTrack.clips.push(createClip({
      id: clipId,
      mediaId,
      trackId: videoTrack.id,
      startTime: clipTiming.startTime,
      duration: clipTiming.duration,
      inPoint: clipTiming.inPoint,
      outPoint: clipTiming.outPoint,
      volume: 1,
      metadata: entry ? buildSemanticClipMetadata(project, entry) : undefined,
    }));

    if (!shotClipIds.has(shot.id)) {
      shotClipIds.set(shot.id, clipId);
    }
  }

  if (project.montagePlan?.transitions?.length) {
    for (const transition of project.montagePlan.transitions) {
      const mapped = mapCutRoomTransition(transition.type);
      if (!mapped) continue;

      const fromIdentity = transition.fromClipId?.trim() || transition.fromShotId;
      const toIdentity = transition.toClipId?.trim() || transition.toShotId;
      const clipAId = timelineClipIdsByIdentity.get(fromIdentity) ?? shotClipIds.get(transition.fromShotId);
      const clipBId = timelineClipIdsByIdentity.get(toIdentity) ?? shotClipIds.get(transition.toShotId);
      if (!clipAId || !clipBId) continue;
      if (clipAId === clipBId) continue;

      videoTrack.transitions.push({
        id: `transition-${fromIdentity}-${toIdentity}`,
        clipAId,
        clipBId,
        type: mapped.type,
        duration: clampPositiveNumber(transition.durationSec, 0.5),
        params: mapped.params,
      });
    }
  }

  if (videoTrack.clips.length > 0 || videoTrack.transitions.length > 0) {
    tracks.push(videoTrack);
  }

  const videoTimelineDuration = videoTrack.clips.reduce(
    (maxDuration, clip) => Math.max(maxDuration, clip.startTime + clip.duration),
    0,
  );
  let timelineDuration = videoTimelineDuration;

  let voiceoverDuration = 0;
  if (project.voiceoverFile) {
    const voiceoverPath = isExternalMediaRef(project.voiceoverFile)
      ? null
      : resolveProjectPath(project.id, project.voiceoverFile);

    voiceoverDuration = await readDurationOrFallback(
      voiceoverPath,
      Math.max(timelineDuration, DEFAULT_VIDEO_DURATION_SEC),
    );

    const mediaId = 'media-voiceover';
    const voiceoverTrack = createTrack('track-voiceover', 'audio', 'Voiceover');

    mediaItems.push(createMediaItem({
      id: mediaId,
      name: path.basename(project.voiceoverFile),
      type: 'audio',
      duration: voiceoverDuration,
    }));

    mediaManifest[mediaId] = {
      url: `${cleanedBaseUrl}/montage/voiceover`,
      mimeType: guessMimeType(project.voiceoverFile, 'audio'),
      kind: 'voiceover',
    };

    voiceoverTrack.clips.push(createClip({
      id: 'clip-voiceover',
      mediaId,
      trackId: voiceoverTrack.id,
      startTime: 0,
      duration: voiceoverDuration,
      volume: dbToLinear(project.montagePlan?.audio?.voiceover?.gainDb),
    }));

    tracks.push(voiceoverTrack);
    timelineDuration = Math.max(timelineDuration, voiceoverDuration);
  }

  if (project.musicFile) {
    const musicPath = isExternalMediaRef(project.musicFile)
      ? null
      : resolveProjectPath(project.id, project.musicFile);

    const fallbackDuration = Math.max(timelineDuration, DEFAULT_VIDEO_DURATION_SEC);
    const musicDuration = await readDurationOrFallback(musicPath, fallbackDuration);

    const mediaId = 'media-music';
    const musicTrack = createTrack('track-music', 'audio', 'Music');

    mediaItems.push(createMediaItem({
      id: mediaId,
      name: path.basename(project.musicFile),
      type: 'audio',
      duration: musicDuration,
    }));

    mediaManifest[mediaId] = {
      url: `${cleanedBaseUrl}/montage/music`,
      mimeType: guessMimeType(project.musicFile, 'audio'),
      kind: 'music',
    };

    musicTrack.clips.push(createClip({
      id: 'clip-music',
      mediaId,
      trackId: musicTrack.id,
      startTime: 0,
      duration: musicDuration,
      volume: dbToLinear(project.montagePlan?.audio?.music?.gainDb),
    }));

    tracks.push(musicTrack);
    timelineDuration = Math.max(timelineDuration, musicDuration);
  }

  const subtitles = project.voiceoverScript?.trim()
    ? buildSubtitles(
      project.voiceoverScript,
      voiceoverDuration > 0
        ? voiceoverDuration
        : Math.max(timelineDuration, DEFAULT_VIDEO_DURATION_SEC),
    )
    : [];

  const openReelProject: OpenReelProject = {
    id: project.id,
    name: project.name || 'Untitled Project',
    createdAt: toTimestamp(project.created),
    modifiedAt: toTimestamp(project.updated),
    settings: {
      width,
      height,
      frameRate,
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
    },
    mediaLibrary: {
      items: mediaItems,
    },
    timeline: {
      tracks,
      subtitles,
      duration: timelineDuration,
      markers: [],
    },
  };

  return {
    version: '1.0.0',
    project: openReelProject,
    mediaManifest,
    semanticSummary,
  };
}
