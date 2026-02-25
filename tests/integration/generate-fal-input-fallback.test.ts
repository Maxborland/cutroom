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
import { createApp } from './setup.js'

const { subscribeMock, uploadMock, configMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  uploadMock: vi.fn(),
  configMock: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: configMock,
    subscribe: subscribeMock,
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
    subscribeMock.mockResolvedValue({
      data: { images: [{ url: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' }] },
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

    expect(subscribeMock).toHaveBeenCalled()
    expect(subscribeMock).toHaveBeenCalledWith(
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
})
