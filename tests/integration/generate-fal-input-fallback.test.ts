import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createProject,
  deleteProject,
  getProject,
  saveProject,
  type Project,
  type ShotMeta,
} from '../../server/lib/storage.js'
import { resetFalSchemaCache } from '../../server/lib/fal-schema.js'
import { createApp } from './setup.js'

const { subscribeMock, runMock, uploadMock, configMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  runMock: vi.fn(),
  uploadMock: vi.fn(),
  configMock: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: configMock,
    subscribe: subscribeMock,
    run: runMock,
    storage: {
      upload: uploadMock,
    },
  },
}))

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')
const originalFetch = global.fetch

describe('fal image generation fallback', () => {
  const createdProjectIds: string[] = []
  let originalSettings: string | null = null

  beforeAll(async () => {
    try {
      originalSettings = await fs.readFile(SETTINGS_PATH, 'utf-8')
    } catch {
      originalSettings = null
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFalSchemaCache()
    runMock.mockResolvedValue({
      data: { images: [{ url: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' }] },
    })
    subscribeMock.mockResolvedValue({
      data: { video: { url: 'https://example.com/video.mp4' } },
    })
    global.fetch = originalFetch
  })

  afterEach(async () => {
    for (const projectId of createdProjectIds) {
      await deleteProject(projectId)
    }
    createdProjectIds.length = 0
  })

  afterAll(async () => {
    if (originalSettings !== null) {
      await fs.writeFile(SETTINGS_PATH, originalSettings, 'utf-8')
    } else {
      try {
        await fs.unlink(SETTINGS_PATH)
      } catch {
        // ignore cleanup errors
      }
    }
    global.fetch = originalFetch
  })

  async function createProjectWithShot(overrides: Partial<ShotMeta> = {}): Promise<{ project: Project; shot: ShotMeta }> {
    const project = await createProject('FAL fallback test')
    createdProjectIds.push(project.id)

    const shot: ShotMeta = {
      id: 'shot-001',
      order: 0,
      scene: 'Exterior',
      audioDescription: '',
      imagePrompt: 'hero exterior shot',
      videoPrompt: 'slow cinematic push-in',
      duration: 4,
      assetRefs: [],
      status: 'draft',
      generatedImages: [],
      enhancedImages: [],
      selectedImage: null,
      videoFile: null,
      ...overrides,
    }

    project.shots = [shot]
    await saveProject(project)
    return { project, shot }
  }

  it('falls back to OpenRouter when selected fal edit model requires reference image but shot has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({
        openRouterApiKey: 'sk-or-test',
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: '',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(res.body.filename).toMatch(/^gen_\d+\.png$/)
    expect(res.body.url).toContain(`/api/projects/${project.id}/shots/${shot.id}/generated/`)

    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === 'https://openrouter.ai/api/v1/chat/completions')
    expect(openrouterCalls.length).toBeGreaterThanOrEqual(1)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('img_review')
    expect(savedShot?.generatedImages).toContain(res.body.filename)
  })

  it('normalizes explicit resolution quality to OpenRouter quality tiers on fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({
        openRouterApiKey: 'sk-or-test',
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: '',
        imageQuality: '4K',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    const openrouterCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === 'https://openrouter.ai/api/v1/chat/completions',
    )
    expect(openrouterCall).toBeTruthy()

    const payload = JSON.parse(String(openrouterCall?.[1]?.body || '{}')) as {
      quality?: string
    }
    expect(payload.quality).toBe('high')
  })

  it('uses configured no-reference image model instead of OpenRouter fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({
        openRouterApiKey: 'sk-or-test',
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
        imageQuality: '4K',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(runMock).toHaveBeenCalled()
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledWith(
      'fal-ai/nano-banana-pro',
      expect.objectContaining({
        input: expect.objectContaining({
          resolution: '4K',
        }),
      }),
    )
    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === 'https://openrouter.ai/api/v1/chat/completions')
    expect(openrouterCalls).toHaveLength(0)
  })

  it('maps generic high quality to schema-backed explicit Fal resolution for no-reference generation', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fnano-banana-pro')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            openapi: '3.1.0',
            info: { title: 'Fal Queue API', version: '1.0.0' },
            paths: {},
            components: {
              schemas: {
                NanoBananaInput: {
                  type: 'object',
                  properties: {
                    resolution: { enum: ['1K', '2K', '4K'] },
                    aspect_ratio: { enum: ['1:1', '16:9'] },
                  },
                },
              },
            },
          }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
        imageQuality: 'high',
        imageAspectRatio: '16:9',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(runMock).toHaveBeenCalledWith(
      'fal-ai/nano-banana-pro',
      expect.objectContaining({
        input: expect.objectContaining({
          resolution: '4K',
          aspect_ratio: '16:9',
        }),
      }),
    )
    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('logs the effective Fal request diagnostics for no-reference generation', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fnano-banana-pro')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            openapi: '3.1.0',
            info: { title: 'Fal Queue API', version: '1.0.0' },
            paths: {},
            components: {
              schemas: {
                NanoBananaInput: {
                  type: 'object',
                  properties: {
                    resolution: { enum: ['1K', '2K', '4K'] },
                    aspect_ratio: { enum: ['1:1', '16:9'] },
                  },
                },
              },
            },
          }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await request(app)
      .put('/api/settings')
      .send({
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
        imageQuality: 'high',
        imageAspectRatio: '16:9',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[generate-image] Fal request'),
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('endpoint=fal-ai/nano-banana-pro'),
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('resolution=4K'),
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('aspectRatio=16:9'),
    )

    logSpy.mockRestore()
  })

  it('uses dedicated no-reference resolution and aspect ratio settings instead of primary image controls', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fnano-banana-pro')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            openapi: '3.1.0',
            info: { title: 'Fal Queue API', version: '1.0.0' },
            paths: {},
            components: {
              schemas: {
                NanoBananaInput: {
                  type: 'object',
                  properties: {
                    resolution: { enum: ['1K', '2K', '4K'] },
                    aspect_ratio: { enum: ['1:1', '16:9', '9:16'] },
                  },
                },
              },
            },
          }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({
        falApiKey: 'fal_test_key',
        defaultImageGenModel: 'fal/nano-banana-pro',
        defaultImageNoRefGenModel: 'fal-endpoint:fal-ai/nano-banana-pro',
        imageQuality: '1K',
        imageAspectRatio: '1:1',
        imageNoRefQuality: '4K',
        imageNoRefAspectRatio: '9:16',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: [],
    })

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(runMock).toHaveBeenCalledWith(
      'fal-ai/nano-banana-pro',
      expect.objectContaining({
        input: expect.objectContaining({
          resolution: '4K',
          aspect_ratio: '9:16',
        }),
      }),
    )
  })
})
