import path from 'node:path';
import { probeDuration } from './normalize.js';
import { resolveProjectPath, type Project as CutRoomProject, type ShotMeta, type TransitionEntry } from './storage.js';

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
  volume?: number;
}): OpenReelClip {
  const duration = clampPositiveNumber(params.duration, DEFAULT_VIDEO_DURATION_SEC);
  return {
    id: params.id,
    mediaId: params.mediaId,
    trackId: params.trackId,
    startTime: Math.max(params.startTime, 0),
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    audioEffects: [],
    transform: DEFAULT_TRANSFORM,
    volume: clampPositiveNumber(params.volume ?? 1, 1),
    keyframes: [],
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

function getOrderedApprovedShots(project: CutRoomProject): ShotMeta[] {
  const approvedWithVideo = project.shots
    .filter((shot) => shot.status === 'approved' && Boolean(shot.videoFile));

  if (!project.montagePlan?.timeline?.length) {
    return [...approvedWithVideo].sort((a, b) => a.order - b.order);
  }

  const byId = new Map(approvedWithVideo.map((shot) => [shot.id, shot]));
  const used = new Set<string>();
  const ordered: ShotMeta[] = [];

  const timelineOrdered = [...project.montagePlan.timeline].sort((a, b) => {
    const aStart = Number.isFinite(a.startSec) ? a.startSec : 0;
    const bStart = Number.isFinite(b.startSec) ? b.startSec : 0;
    return aStart - bStart;
  });

  for (const entry of timelineOrdered) {
    const shot = byId.get(entry.shotId);
    if (!shot || used.has(shot.id)) continue;
    ordered.push(shot);
    used.add(shot.id);
  }

  const remaining = approvedWithVideo
    .filter((shot) => !used.has(shot.id))
    .sort((a, b) => a.order - b.order);

  return [...ordered, ...remaining];
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

  const videoTrack = createTrack('track-video', 'video', 'Video');
  const orderedShots = getOrderedApprovedShots(project);
  const shotClipIds = new Map<string, string>();

  let videoCursor = 0;
  for (const shot of orderedShots) {
    const mediaId = `media-shot-${shot.id}`;
    const clipId = `clip-shot-${shot.id}`;
    const fallbackDuration = clampPositiveNumber(shot.duration, DEFAULT_VIDEO_DURATION_SEC);
    const shotPath = resolveShotVideoPath(project.id, shot);
    const duration = await readDurationOrFallback(shotPath, fallbackDuration);

    mediaItems.push(createMediaItem({
      id: mediaId,
      name: `${shot.id}${path.extname(shot.videoFile ?? '') || '.mp4'}`,
      type: 'video',
      duration,
      width,
      height,
      frameRate,
    }));

    mediaManifest[mediaId] = {
      url: `${cleanedBaseUrl}/shots/${encodeURIComponent(shot.id)}/video`,
      mimeType: guessMimeType(shot.videoFile ?? undefined, 'video'),
      kind: 'shot',
      shotId: shot.id,
    };

    videoTrack.clips.push(createClip({
      id: clipId,
      mediaId,
      trackId: videoTrack.id,
      startTime: videoCursor,
      duration,
      volume: 1,
    }));

    shotClipIds.set(shot.id, clipId);
    videoCursor += duration;
  }

  if (project.montagePlan?.transitions?.length) {
    for (const transition of project.montagePlan.transitions) {
      const mapped = mapCutRoomTransition(transition.type);
      if (!mapped) continue;

      const clipAId = shotClipIds.get(transition.fromShotId);
      const clipBId = shotClipIds.get(transition.toShotId);
      if (!clipAId || !clipBId) continue;

      videoTrack.transitions.push({
        id: `transition-${transition.fromShotId}-${transition.toShotId}`,
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

  let timelineDuration = videoCursor;

  let voiceoverDuration = 0;
  if (project.voiceoverFile) {
    const voiceoverPath = isExternalMediaRef(project.voiceoverFile)
      ? null
      : resolveProjectPath(project.id, project.voiceoverFile);

    voiceoverDuration = await readDurationOrFallback(
      voiceoverPath,
      Math.max(videoCursor, DEFAULT_VIDEO_DURATION_SEC),
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
  };
}
