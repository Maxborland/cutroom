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
    const response = await request(app)
      .get(`/api/projects/${projectId}/openreel-project`)
      .expect(200);

    expect(response.body.version).toBe('1.0.0');
    expect(response.body.project).toBeDefined();
    expect(response.body.project.id).toBe(projectId);
    expect(response.body.project.timeline).toBeDefined();
    expect(response.body.project.timeline.tracks).toBeInstanceOf(Array);
    expect(response.body.mediaManifest).toBeDefined();
    expect(response.body.mediaManifest['media-shot-shot-1'].url)
      .toMatch(new RegExp(`/api/projects/${projectId}/shots/shot-1/video/.+`));
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
