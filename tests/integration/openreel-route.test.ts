import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './setup.js';
import {
  createProject,
  deleteProject,
  resolveProjectPath,
  withProject,
} from '../../server/lib/storage.js';

vi.mock('../../server/lib/normalize.js', () => ({
  probeDuration: vi.fn().mockResolvedValue(5),
}));

const app = createApp();

describe('OpenReel route integration', () => {
  let projectId: string;

  beforeEach(async () => {
    const project = await createProject('OpenReel Route Test');
    projectId = project.id;

    await withProject(projectId, (p) => {
      p.shots = [
        {
          id: 'shot-1',
          order: 0,
          scene: 'Exterior view',
          audioDescription: '',
          imagePrompt: '',
          videoPrompt: '',
          duration: 4,
          assetRefs: [],
          status: 'approved',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: 'shot-1.mp4',
        },
      ];
      p.voiceoverScript = 'Первая строка. Вторая строка.';
      p.voiceoverFile = 'montage/voiceover.mp3';
    });
  });

  afterEach(async () => {
    try {
      await deleteProject(projectId);
    } catch {
      // ignore cleanup errors
    }
  });

  it('GET /openreel-project returns a valid bundle', async () => {
    await withProject(projectId, (p) => {
      p.narrationAnchors = [
        {
          id: 'anchor-1',
          sourceText: 'Внешний фасад',
          label: 'Фасад',
          order: 1,
          intent: 'hook',
        },
      ];
      p.anchorMatches = [
        {
          anchorId: 'anchor-1',
          selectedShotId: 'shot-1',
          selectedMomentId: 'moment-1',
          confidence: 0.87,
          status: 'matched',
          candidates: [
            {
              shotId: 'shot-1',
              momentId: 'moment-1',
              confidence: 0.87,
              reason: 'Совпадение по videoDescription.summary',
            },
          ],
        },
      ];
      p.anchorCoverageSummary = {
        totalAnchors: 1,
        matchedAnchors: 1,
        weakMatches: 0,
        unmatchedAnchors: 0,
      };
      p.montagePlan = {
        version: 1,
        format: { width: 3840, height: 2160, fps: 30 },
        timeline: [
          {
            shotId: 'shot-1',
            clipFile: 'montage/normalized/shot-1.mp4',
            startSec: 0,
            durationSec: 4,
            trimStartSec: 0.5,
            trimEndSec: 4.5,
          },
        ],
        transitions: [],
        motionGraphics: { lowerThirds: [] },
        audio: {
          voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
          music: { file: '', gainDb: -12, duckingDb: -18, duckFadeMs: 300 },
        },
        style: {
          preset: 'premium',
          fontFamily: 'Montserrat',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          textColor: '#ffffff',
        },
      };
    });

    const response = await request(app)
      .get(`/api/projects/${projectId}/openreel-project`)
      .expect(200);

    expect(response.body.version).toBe('1.0.0');
    expect(response.body.project).toBeDefined();
    expect(response.body.project.id).toBe(projectId);
    expect(response.body.project.timeline).toBeDefined();
    expect(response.body.project.timeline.tracks).toBeInstanceOf(Array);
    expect(response.body.mediaManifest).toBeDefined();
    expect(response.body.semanticSummary).toEqual({
      anchors: 1,
      matched: 1,
      weak: 0,
      unmatched: 0,
    });
    expect(response.body.mediaManifest['media-shot-shot-1'].url)
      .toMatch(new RegExp(`/api/projects/${projectId}/shots/shot-1/video/.+`));
    expect(response.body.project.timeline.tracks[0].clips[0].metadata.cutroomSemantic).toMatchObject({
      anchorId: 'anchor-1',
      selectedMomentId: 'moment-1',
      trimStartSec: 0.5,
      trimEndSec: 4.5,
    });
  });

  it('GET /openreel-project returns 404 for non-existent project', async () => {
    await request(app)
      .get('/api/projects/non-existent-project/openreel-project')
      .expect(404);
  });

  it('PUT /openreel-project saves snapshot and returns modifiedAt', async () => {
    const payload = {
      version: '1.0.0',
      project: {
        id: projectId,
        timeline: {
          tracks: [],
        },
      },
    };

    const response = await request(app)
      .put(`/api/projects/${projectId}/openreel-project`)
      .send(payload)
      .expect(200);

    expect(response.body.saved).toBe(true);
    expect(typeof response.body.modifiedAt).toBe('number');

    const savedRaw = await fs.readFile(
      resolveProjectPath(projectId, 'openreel', 'project.json'),
      'utf-8',
    );
    const saved = JSON.parse(savedRaw);

    expect(saved.version).toBe('1.0.0');
    expect(saved.project).toEqual(payload.project);
    expect(saved.modifiedAt).toBe(response.body.modifiedAt);
  });

  it('PUT /openreel-project returns 400 for invalid version', async () => {
    const response = await request(app)
      .put(`/api/projects/${projectId}/openreel-project`)
      .send({
        version: '2.0.0',
        project: { id: projectId },
      })
      .expect(400);

    expect(response.body.error).toBe('Unsupported OpenReel project version');
  });
});
