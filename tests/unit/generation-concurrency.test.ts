import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

type TestShot = {
  id: string
  order: number
  scene: string
  audioDescription: string
  imagePrompt: string
  videoPrompt: string
  duration: number
  assetRefs: string[]
  status: string
  generatedImages: string[]
  enhancedImages: string[]
  selectedImage: string | null
  videoFile: string | null
}

type TestProject = {
  id: string
  name: string
  created: string
  updated: string
  stage: string
  brief: { text: string; assets: unknown[]; targetDuration: number }
  settings: Record<string, unknown>
  shots: TestShot[]
  latestExportArtifact?: { filename: string; exportedAt: string }
}

function makeProject(): TestProject {
  return {
    id: 'project-1',
    name: 'Concurrency Test',
    created: '2026-03-27T00:00:00.000Z',
    updated: '2026-03-27T00:00:00.000Z',
    stage: 'review',
    brief: { text: '', assets: [], targetDuration: 30 },
    settings: {},
    shots: [
      {
        id: 'shot-1',
        order: 0,
        scene: 'Exterior',
        audioDescription: '',
        imagePrompt: 'Hero exterior',
        videoPrompt: 'Slow push in',
        duration: 4,
        assetRefs: [],
        status: 'img_review',
        generatedImages: ['https://cdn.example.com/source.png'],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ],
  }
}

function cloneProject(project: TestProject): TestProject {
  return structuredClone(project)
}

describe('generation routes concurrency safety', () => {
  it('generateShotImageForProject preserves concurrent project changes', async () => {
    vi.resetModules()

    let currentProject = makeProject()
    const preservedArtifact = {
      filename: 'final-cut.mp4',
      exportedAt: '2026-03-27T00:05:00.000Z',
    }

    const saveProject = vi.fn(async (project: TestProject) => {
      currentProject = cloneProject(project)
      return project
    })

    const withProject = vi.fn(async (_projectId: string, fn: (project: TestProject) => unknown | Promise<unknown>) => {
      const draft = cloneProject(currentProject)
      const result = await fn(draft)
      currentProject = draft
      return result
    })

    vi.doMock('../../server/lib/storage.js', () => ({
      getProject: vi.fn(async () => cloneProject(currentProject)),
      saveProject,
      withProject,
    }))

    vi.doMock('../../server/lib/storage-adapters/index.js', () => ({
      getProjectStorageAdapter: () => ({
        ensureContainer: vi.fn(async () => {}),
        getReadablePathForServer: vi.fn(() => 'D:/tmp/generated-image.png'),
        getPublicUrl: vi.fn(() => null),
        readBuffer: vi.fn(),
      }),
    }))

    vi.doMock('../../server/lib/openrouter.js', () => ({
      chatCompletion: vi.fn(),
      generateImage: vi.fn(async () => 'https://images.example.com/generated.png'),
    }))

    vi.doMock('../../server/lib/generation.js', () => ({
      generateImage: vi.fn(),
    }))

    vi.doMock('../../server/lib/generation-models.js', () => ({
      resolveImageModel: vi.fn(() => null),
      resolveOpenRouterImageFallbackModel: vi.fn(() => 'openai/gpt-image-1'),
    }))

    vi.doMock('../../server/lib/media-utils.js', () => ({
      saveImageResult: vi.fn(async () => {}),
      fetchRemoteMediaBuffer: vi.fn(),
      getBestImageFile: vi.fn(() => null),
      getMimeType: vi.fn(() => 'image/png'),
    }))

    vi.doMock('../../server/lib/reference-media.js', () => ({
      prepareBriefReferences: vi.fn(async () => {
        currentProject = {
          ...currentProject,
          stage: 'rendered',
          latestExportArtifact: preservedArtifact,
        }
        return {
          items: [],
          summary: {
            requested: 0,
            prepared: 0,
            skipped: 0,
            oversized: 0,
            svgText: 0,
            cached: 0,
          },
        }
      }),
    }))

    vi.doMock('../../server/lib/external-image-cache.js', () => ({
      cacheExternalImageReference: vi.fn(),
      isExternalMediaRef: vi.fn((value: string) => value.startsWith('http')),
    }))

    vi.doMock('../../server/lib/api-error.js', () => ({
      getErrorMessage: vi.fn((error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)),
      sendApiError: vi.fn(),
    }))

    vi.doMock('../../server/routes/generate/shared.js', () => ({
      resolveSettings: vi.fn(async () => ({
        imageGenModel: 'non-registry-model',
        imageNoRefGenModel: '',
        imageModel: 'openai/gpt-image-1',
        imageGenPrompt: '{SHOT_PROMPT}',
        imageAspectRatio: '16:9',
        imageSize: 'auto',
        imageQuality: 'high',
      })),
      activeGenerations: new Map(),
      genKey: vi.fn(() => 'project-1/shot-1'),
    }))

    const { generateShotImageForProject } = await import('../../server/routes/generate/image.js?concurrency-image')

    await generateShotImageForProject({ projectId: 'project-1', shotId: 'shot-1' })

    expect(currentProject.stage).toBe('rendered')
    expect(currentProject.latestExportArtifact).toEqual(preservedArtifact)
    expect(currentProject.shots[0]?.status).toBe('img_review')
    expect(currentProject.shots[0]?.generatedImages.some((value) => value.startsWith('gen_'))).toBe(true)
  })

  it('generate-video route preserves concurrent project changes', async () => {
    vi.resetModules()

    let currentProject = makeProject()
    const preservedArtifact = {
      filename: 'editor-export.mp4',
      exportedAt: '2026-03-27T00:10:00.000Z',
    }

    currentProject.shots[0]!.videoFile = null
    currentProject.shots[0]!.status = 'img_review'

    const saveProject = vi.fn(async (project: TestProject) => {
      currentProject = cloneProject(project)
      return project
    })

    const withProject = vi.fn(async (_projectId: string, fn: (project: TestProject) => unknown | Promise<unknown>) => {
      const draft = cloneProject(currentProject)
      const result = await fn(draft)
      currentProject = draft
      return result
    })

    vi.doMock('../../server/lib/storage.js', () => ({
      getProject: vi.fn(async () => cloneProject(currentProject)),
      saveProject,
      withProject,
    }))

    vi.doMock('../../server/lib/storage-adapters/index.js', () => ({
      getProjectStorageAdapter: () => ({
        readBuffer: vi.fn(),
        exists: vi.fn(async () => true),
      }),
    }))

    vi.doMock('../../server/lib/jobs/video-cache.js', () => ({
      cacheVideoLocally: vi.fn(async () => ({
        filename: 'vid_123.mp4',
        url: '/api/projects/project-1/shots/shot-1/video/vid_123.mp4',
      })),
      enqueueVideoCacheJob: vi.fn(async () => 'job-1'),
      InvalidExternalVideoUrlError: class InvalidExternalVideoUrlError extends Error {},
    }))

    vi.doMock('../../server/lib/generation.js', () => ({
      generateVideoFromImage: vi.fn(async () => 'https://videos.example.com/generated.mp4'),
    }))

    vi.doMock('../../server/lib/generation-models.js', () => ({
      resolveVideoModel: vi.fn(() => ({ id: 'rep/kling-2.1' })),
      resolveVideoQualityInput: vi.fn(() => undefined),
    }))

    vi.doMock('../../server/lib/media-utils.js', () => ({
      getBestImageFile: vi.fn(() => 'https://cdn.example.com/source.png'),
      getMimeType: vi.fn(() => 'image/png'),
    }))

    vi.doMock('../../server/lib/safe-log.js', () => ({
      safeLogValue: vi.fn((value: string) => value),
    }))

    vi.doMock('../../server/lib/api-error.js', () => ({
      getErrorMessage: vi.fn((error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)),
      sendApiError: vi.fn((res: express.Response, status: number, message: string) => res.status(status).json({ error: message })),
    }))

    vi.doMock('../../server/lib/rate-limit.js', () => ({
      readLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      generationLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    }))

    vi.doMock('../../server/routes/generate/shared.js', () => ({
      resolveSettings: vi.fn(async () => {
        currentProject = {
          ...currentProject,
          stage: 'rendered',
          latestExportArtifact: preservedArtifact,
        }
        return {
          videoGenModel: 'rep/kling-2.1',
          videoQuality: 'high',
        }
      }),
      activeGenerations: new Map(),
      genKey: vi.fn(() => 'project-1/shot-1'),
    }))

    const router = (await import('../../server/routes/generate/video.js?concurrency-video')).default
    const app = express()
    app.use(express.json())
    app.use('/api/projects/:id', router)

    await request(app)
      .post('/api/projects/project-1/shots/shot-1/generate-video')
      .send({})
      .expect(200)

    expect(currentProject.stage).toBe('rendered')
    expect(currentProject.latestExportArtifact).toEqual(preservedArtifact)
    expect(currentProject.shots[0]?.status).toBe('vid_review')
    expect(currentProject.shots[0]?.videoFile).toBe('vid_123.mp4')
  })
})
