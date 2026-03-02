import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './setup.js';
import { createProject, deleteProject, withProject } from '../../server/lib/storage.js';

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
      .toBe(`/api/projects/${projectId}/shots/shot-1/video`);
  });

  it('GET /openreel-project returns 404 for non-existent project', async () => {
    await request(app)
      .get('/api/projects/non-existent-project/openreel-project')
      .expect(404);
  });
});
