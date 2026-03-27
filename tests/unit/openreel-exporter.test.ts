import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../server/lib/storage.js';

vi.mock('../../server/lib/normalize.js', () => ({
  probeDuration: vi.fn(),
}));

import { probeDuration } from '../../server/lib/normalize.js';
import { buildOpenReelBundle, mapCutRoomTransition } from '../../server/lib/openreel-exporter.js';

const mockedProbeDuration = vi.mocked(probeDuration);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'OpenReel Export Test',
    created: '2026-03-02T00:00:00.000Z',
    updated: '2026-03-02T00:00:00.000Z',
    stage: 'montage_draft',
    settings: {
      scriptwriterPrompt: '',
      shotSplitterPrompt: '',
      model: 'test-model',
      temperature: 0.5,
    },
    brief: {
      text: 'brief',
      assets: [],
      targetDuration: 30,
    },
    script: 'script',
    shots: [],
    ...overrides,
  };
}

describe('buildOpenReelBundle()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProbeDuration.mockRejectedValue(new Error('ffprobe unavailable in test'));
  });

  it('maps approved shots with video files to media library and video track clips', async () => {
    mockedProbeDuration.mockImplementation(async (filePath: string) => {
      if (filePath.includes('shot-1')) return 5;
      if (filePath.includes('shot-2')) return 7;
      throw new Error('missing');
    });

    const project = makeProject({
      shots: [
        {
          id: 'shot-1',
          order: 0,
          scene: 'Scene A',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'a.mp4',
        },
        {
          id: 'shot-2',
          order: 1,
          scene: 'Scene B',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'b.mp4',
        },
      ],
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');

    expect(bundle.version).toBe('1.0.0');
    expect(bundle.project.mediaLibrary.items).toHaveLength(2);

    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack!.clips).toHaveLength(2);
    expect(videoTrack!.clips[0].startTime).toBe(0);
    expect(videoTrack!.clips[0].duration).toBe(5);
    expect(videoTrack!.clips[1].startTime).toBe(5);
    expect(videoTrack!.clips[1].duration).toBe(7);
  });

  it('exports one clip per semantic timeline entry even when the same shot repeats', async () => {
    mockedProbeDuration.mockResolvedValue(8);

    const project = makeProject({
      shots: [
        {
          id: 'shot-terrace',
          order: 1,
          scene: 'Терраса',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'terrace.mp4',
        },
      ],
      narrationAnchors: [
        {
          id: 'anchor-1',
          sourceText: 'Терраса с видом',
          label: 'Терраса',
          order: 1,
          intent: 'lifestyle',
        },
        {
          id: 'anchor-2',
          sourceText: 'Тот же ракурс снова',
          label: 'Повтор',
          order: 2,
          intent: 'feature',
        },
      ],
      anchorMatches: [
        {
          anchorId: 'anchor-1',
          selectedShotId: 'shot-terrace',
          selectedMomentId: 'moment-terrace',
          confidence: 0.91,
          status: 'matched',
          candidates: [
            {
              shotId: 'shot-terrace',
              momentId: 'moment-terrace',
              confidence: 0.91,
              reason: 'Первое совпадение по videoDescription',
            },
          ],
        },
        {
          anchorId: 'anchor-2',
          selectedShotId: 'shot-terrace',
          selectedMomentId: 'moment-terrace-repeat',
          confidence: 0.88,
          status: 'matched',
          candidates: [
            {
              shotId: 'shot-terrace',
              momentId: 'moment-terrace-repeat',
              confidence: 0.88,
              reason: 'Повторное совпадение по тому же источнику',
            },
          ],
        },
      ],
      anchorCoverageSummary: {
        totalAnchors: 2,
        matchedAnchors: 2,
        weakMatches: 0,
        unmatchedAnchors: 0,
      },
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-anchor-1',
            shotId: 'shot-terrace',
            clipFile: 'montage/normalized/shot-terrace.mp4',
            startSec: 0,
            durationSec: 3.5,
            trimStartSec: 1.2,
            trimEndSec: 4.7,
            anchorId: 'anchor-1',
            selectedMomentId: 'moment-terrace',
          },
          {
            clipId: 'clip-anchor-2',
            shotId: 'shot-terrace',
            clipFile: 'montage/normalized/shot-terrace.mp4',
            startSec: 3.5,
            durationSec: 2.5,
            trimStartSec: 4.7,
            trimEndSec: 7.2,
            anchorId: 'anchor-2',
            selectedMomentId: 'moment-terrace-repeat',
          },
        ],
        transitions: [
          {
            fromClipId: 'clip-anchor-1',
            toClipId: 'clip-anchor-2',
            fromShotId: 'shot-terrace',
            toShotId: 'shot-terrace',
            type: 'fade',
            durationSec: 0.5,
          },
        ],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');

    expect(videoTrack).toBeDefined();
    expect(videoTrack!.clips).toHaveLength(2);
    expect(videoTrack!.clips.map((clip) => clip.id)).toEqual(['clip-anchor-1', 'clip-anchor-2']);
    expect(videoTrack!.clips.map((clip) => clip.mediaId)).toEqual([
      'media-shot-shot-terrace',
      'media-shot-shot-terrace',
    ]);
    expect(videoTrack!.transitions[0]).toMatchObject({
      clipAId: 'clip-anchor-1',
      clipBId: 'clip-anchor-2',
    });
    expect(videoTrack!.clips[0].metadata).toMatchObject({
      cutroomSemantic: expect.objectContaining({
        clipId: 'clip-anchor-1',
        anchorId: 'anchor-1',
        selectedMomentId: 'moment-terrace',
      }),
    });
    expect(videoTrack!.clips[1].metadata).toMatchObject({
      cutroomSemantic: expect.objectContaining({
        clipId: 'clip-anchor-2',
        anchorId: 'anchor-2',
        selectedMomentId: 'moment-terrace-repeat',
      }),
    });
    expect(mockedProbeDuration).toHaveBeenCalledTimes(1);
  });

  it('skips self-referential fallback transitions when legacy endpoints collapse to the same clip', async () => {
    mockedProbeDuration.mockResolvedValue(8);

    const project = makeProject({
      shots: [
        {
          id: 'shot-terrace',
          order: 1,
          scene: 'Терраса',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'terrace.mp4',
        },
      ],
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-anchor-1',
            shotId: 'shot-terrace',
            clipFile: 'montage/normalized/shot-terrace.mp4',
            startSec: 0,
            durationSec: 3,
          },
          {
            clipId: 'clip-anchor-2',
            shotId: 'shot-terrace',
            clipFile: 'montage/normalized/shot-terrace.mp4',
            startSec: 3,
            durationSec: 3,
          },
        ],
        transitions: [
          {
            fromShotId: 'shot-terrace',
            toShotId: 'shot-terrace',
            type: 'fade',
            durationSec: 0.5,
          },
        ],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');

    expect(videoTrack?.transitions).toEqual([]);
  });

  it('maps voiceover to an audio track with a clip starting at zero', async () => {
    mockedProbeDuration.mockResolvedValue(12);

    const project = makeProject({
      voiceoverFile: 'montage/voiceover.mp3',
      shots: [],
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const voiceTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Voiceover');

    expect(voiceTrack).toBeDefined();
    expect(voiceTrack!.type).toBe('audio');
    expect(voiceTrack!.clips).toHaveLength(1);
    expect(voiceTrack!.clips[0].startTime).toBe(0);
    expect(voiceTrack!.clips[0].duration).toBe(12);
  });

  it('maps music to an audio track with volume derived from montagePlan gainDb', async () => {
    mockedProbeDuration.mockResolvedValue(15);

    const project = makeProject({
      musicFile: 'montage/music.mp3',
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: 'montage/music.mp3', gainDb: -6, duckingDb: -10, duckFadeMs: 500 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
      shots: [],
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const musicTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Music');

    expect(musicTrack).toBeDefined();
    expect(musicTrack!.clips).toHaveLength(1);
    expect(musicTrack!.clips[0].volume).toBeCloseTo(0.501, 2);
  });

  it.each([
    ['cut', null],
    ['crossfade', 'crossfade'],
    ['fade', 'dipToBlack'],
    ['slide_left', 'slide'],
    ['slide_right', 'slide'],
    ['zoom_blur', 'zoom'],
    ['wipe', 'wipe'],
  ] as const)('maps transition type %s correctly', async (sourceType, expectedTargetType) => {
    const mapped = mapCutRoomTransition(sourceType);

    if (expectedTargetType === null) {
      expect(mapped).toBeNull();
      return;
    }

    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe(expectedTargetType);
  });

  it('generates subtitles from voiceover script and fits them to voiceover duration', async () => {
    mockedProbeDuration.mockResolvedValue(9);

    const project = makeProject({
      voiceoverFile: 'montage/voiceover.mp3',
      voiceoverScript: 'Первая фраза. Вторая фраза! Третья фраза?',
      shots: [],
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const subtitles = bundle.project.timeline.subtitles;

    expect(subtitles).toHaveLength(3);
    expect(subtitles[0].startTime).toBe(0);
    expect(subtitles[2].endTime).toBeCloseTo(9, 5);
  });

  it('builds mediaManifest URLs using CutRoom API paths', async () => {
    mockedProbeDuration.mockImplementation(async (filePath: string) => {
      if (filePath.includes('voiceover')) return 8;
      if (filePath.includes('music')) return 8;
      return 5;
    });

    const project = makeProject({
      shots: [
        {
          id: 'shot-42',
          order: 0,
          scene: '',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'shot42.mp4',
        },
      ],
      voiceoverFile: 'montage/voiceover.mp3',
      musicFile: 'montage/music.mp3',
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');

    expect(bundle.mediaManifest['media-shot-shot-42']).toMatchObject({
      kind: 'shot',
      shotId: 'shot-42',
    });
    expect(bundle.mediaManifest['media-shot-shot-42'].url)
      .toMatch(/\/api\/projects\/project-1\/shots\/shot-42\/video\/.+/);
    expect(bundle.mediaManifest['media-voiceover']).toMatchObject({
      url: '/api/projects/project-1/montage/voiceover',
      kind: 'voiceover',
    });
    expect(bundle.mediaManifest['media-music']).toMatchObject({
      url: '/api/projects/project-1/montage/music',
      kind: 'music',
    });
  });

  it('returns a valid empty timeline when there are no approved shots', async () => {
    const project = makeProject({ shots: [] });
    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');

    expect(bundle.project.timeline.tracks).toHaveLength(0);
    expect(bundle.project.timeline.duration).toBe(0);
    expect(bundle.project.mediaLibrary.items).toHaveLength(0);
  });

  it('uses shot order when montagePlan is missing', async () => {
    mockedProbeDuration.mockImplementation(async (filePath: string) => {
      if (filePath.includes('first.mp4')) return 3;
      if (filePath.includes('second.mp4')) return 4;
      return 4;
    });

    const project = makeProject({
      shots: [
        {
          id: 'late',
          order: 10,
          scene: '',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'second.mp4',
        },
        {
          id: 'early',
          order: 1,
          scene: '',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'first.mp4',
        },
      ],
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');

    expect(videoTrack).toBeDefined();
    expect(videoTrack!.clips[0].id).toBe('clip-shot-early');
    expect(videoTrack!.clips[1].id).toBe('clip-shot-late');
  });

  it('preserves semantic anchor metadata and trim suggestions on exported clips', async () => {
    mockedProbeDuration.mockResolvedValue(8);

    const project = makeProject({
      shots: [
        {
          id: 'shot-terrace',
          order: 1,
          scene: 'Терраса',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'terrace.mp4',
        },
      ],
      narrationAnchors: [
        {
          id: 'anchor-1',
          sourceText: 'Терраса с видом',
          label: 'Терраса',
          order: 1,
          intent: 'lifestyle',
        },
      ],
      anchorMatches: [
        {
          anchorId: 'anchor-1',
          selectedShotId: 'shot-terrace',
          selectedMomentId: 'moment-terrace',
          confidence: 0.91,
          status: 'matched',
          candidates: [
            {
              shotId: 'shot-terrace',
              momentId: 'moment-terrace',
              confidence: 0.91,
              reason: 'Совпадение по videoDescription.matchHints',
            },
          ],
        },
      ],
      anchorCoverageSummary: {
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      },
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-shot-terrace',
            shotId: 'shot-terrace',
            clipFile: 'montage/normalized/shot-terrace.mp4',
            startSec: 0,
            durationSec: 3.5,
            trimStartSec: 1.2,
            trimEndSec: 4.7,
            anchorId: 'anchor-1',
            selectedMomentId: 'moment-terrace',
          },
        ],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');
    const clip = videoTrack?.clips.find((entry) => entry.mediaId === 'media-shot-shot-terrace');

    expect(clip?.metadata).toMatchObject({
      cutroomSemantic: {
        clipId: 'clip-shot-terrace',
        anchorId: 'anchor-1',
        anchorLabel: 'Терраса',
        anchorSourceText: 'Терраса с видом',
        matchStatus: 'matched',
        matchConfidence: 0.91,
        selectedMomentId: 'moment-terrace',
        trimStartSec: 1.2,
        trimEndSec: 4.7,
        reason: 'Совпадение по videoDescription.matchHints',
      },
    });
    expect(bundle.semanticSummary).toEqual({
      anchors: 1,
      matched: 1,
      weak: 0,
      unmatched: 0,
    });
    expect(clip?.inPoint).toBe(1.2);
    expect(clip?.outPoint).toBe(4.7);
  });

  it('respects selected moment end bounds when exporting semantic clips', async () => {
    mockedProbeDuration.mockResolvedValue(12);

    const project = makeProject({
      shots: [
        {
          id: 'shot-1',
          order: 1,
          scene: 'Гостиная',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 12,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'living-room.mp4',
        },
      ],
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: 'clip-anchor-1',
            shotId: 'shot-1',
            clipFile: 'montage/normalized/shot-1.mp4',
            startSec: 0,
            durationSec: 6,
            trimStartSec: 2,
            trimEndSec: 5,
            anchorId: 'anchor-1',
            selectedMomentId: 'moment-living-room',
          },
        ],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');
    const clip = videoTrack?.clips[0];

    expect(clip?.duration).toBe(3);
    expect(clip?.inPoint).toBe(2);
    expect(clip?.outPoint).toBe(5);
  });

  it('generates stable fallback identities for malformed timeline clip metadata', async () => {
    mockedProbeDuration.mockResolvedValue(6);

    const project = makeProject({
      shots: [
        {
          id: 'shot-broken',
          order: 1,
          scene: 'Неисправный шот',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 6,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'broken.mp4',
        },
      ],
      montagePlan: {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            clipId: '   ',
            shotId: 'shot-broken',
            clipFile: 'montage/normalized/broken.mp4',
            startSec: 0,
            durationSec: 6,
          },
        ],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: '', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      },
    });

    const bundle = await buildOpenReelBundle(project, '/api/projects/project-1');
    const videoTrack = bundle.project.timeline.tracks.find((track) => track.name === 'Video');

    expect(videoTrack?.clips[0]?.id).toBe('clip-shot-broken-1');
  });
});
