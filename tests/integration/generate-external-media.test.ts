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

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))

function makeBodyStream(data: string | Buffer): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(typeof data === 'string' ? Buffer.from(data) : data)
  return new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(bytes); controller.close() },
  })
}

function mockOkResponse(data: string | Buffer) {
  return { ok: true, status: 200, headers: { get: () => null }, body: makeBodyStream(data) }
}

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')
const originalFetch = global.fetch

describe('External image refs in generation routes', () => {
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
    const project = await createProject('External refs test')
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
      status: 'img_review',
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

  it('enhance-image accepts external source URL and forwards it to OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock

    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const externalUrl = 'https://v3b.fal.media/files/test/ref.png'
    const { project, shot } = await createProjectWithShot({
      generatedImages: [externalUrl],
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/enhance-image`)
      .send({ sourceImage: externalUrl })
      .expect(200)

    expect(res.body.filename).toMatch(/^enh_\d+\.png$/)

    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === 'https://openrouter.ai/api/v1/chat/completions')
    expect(openrouterCalls.length).toBeGreaterThanOrEqual(1)

    const reqBody = JSON.parse(openrouterCalls[0][1]?.body as string)
    const content = reqBody.messages[0].content as Array<{ type: string; image_url?: { url: string } }>
    const imagePart = content.find((p) => p.type === 'image_url')
    expect(imagePart?.image_url?.url).toBe(externalUrl)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.enhancedImages.length).toBe(1)
  })

  it('enhance-image falls back to local image when provider rejects remote URL input', async () => {
    const externalUrl = 'https://v3b.fal.media/files/test/ref-fallback.png'
    const openrouterUrl = 'https://openrouter.ai/api/v1/chat/completions'
    let openrouterAttempt = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url === openrouterUrl) {
        openrouterAttempt += 1
        if (openrouterAttempt === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => '{"error":"remote image URL is not allowed"}',
            json: async () => ({ error: 'remote image URL is not allowed' }),
          } as Response
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
          }),
          text: async () => '',
        } as Response
      }

      if (url === externalUrl) {
        return mockOkResponse('external-image-bytes') as unknown as Response
      }

      throw new Error(`Unexpected URL in fetch mock: ${url}`)
    })

    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      generatedImages: [externalUrl],
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/enhance-image`)
      .send({ sourceImage: externalUrl })
      .expect(200)

    expect(res.body.filename).toMatch(/^enh_\d+\.png$/)

    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === openrouterUrl)
    expect(openrouterCalls.length).toBe(2)

    const firstBody = JSON.parse(openrouterCalls[0][1]?.body as string)
    const firstImageUrl = firstBody.messages[0].content.find((p: any) => p.type === 'image_url')?.image_url?.url
    expect(firstImageUrl).toBe(externalUrl)

    const secondBody = JSON.parse(openrouterCalls[1][1]?.body as string)
    const secondImageUrl = secondBody.messages[0].content.find((p: any) => p.type === 'image_url')?.image_url?.url
    expect(secondImageUrl.startsWith('data:image/')).toBe(true)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.generatedImages.includes(externalUrl)).toBe(false)
  })

  it('ai-review accepts external generated image URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Looks good, approved.' } }],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock

    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const externalUrl = 'https://v3b.fal.media/files/test/review.png'
    const { project, shot } = await createProjectWithShot({
      generatedImages: [externalUrl],
      enhancedImages: [],
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/ai-review`)
      .send({})
      .expect(200)

    expect(res.body.review).toContain('approved')

    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === 'https://openrouter.ai/api/v1/chat/completions')
    expect(openrouterCalls.length).toBeGreaterThanOrEqual(1)

    const reqBody = JSON.parse(openrouterCalls[0][1]?.body as string)
    const userMessage = reqBody.messages.find((m: { role: string }) => m.role === 'user')
    const content = userMessage.content as Array<{ type: string; image_url?: { url: string } }>
    const imagePart = content.find((p) => p.type === 'image_url')
    expect(imagePart?.image_url?.url).toBe(externalUrl)
  })

  it('ai-review falls back to local image when provider rejects remote URL input', async () => {
    const externalUrl = 'https://v3b.fal.media/files/test/review-fallback.png'
    const openrouterUrl = 'https://openrouter.ai/api/v1/chat/completions'
    let openrouterAttempt = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url === openrouterUrl) {
        openrouterAttempt += 1
        if (openrouterAttempt === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => '{"error":"remote image URL is not allowed"}',
            json: async () => ({ error: 'remote image URL is not allowed' }),
          } as Response
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Local fallback worked, approved.' } }],
          }),
          text: async () => '',
        } as Response
      }

      if (url === externalUrl) {
        return mockOkResponse('external-review-bytes') as unknown as Response
      }

      throw new Error(`Unexpected URL in fetch mock: ${url}`)
    })

    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      generatedImages: [externalUrl],
      enhancedImages: [],
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/ai-review`)
      .send({})
      .expect(200)

    expect(res.body.review).toContain('fallback')

    const openrouterCalls = fetchMock.mock.calls.filter(([url]) => String(url) === openrouterUrl)
    expect(openrouterCalls.length).toBe(2)

    const firstBody = JSON.parse(openrouterCalls[0][1]?.body as string)
    const firstUser = firstBody.messages.find((m: any) => m.role === 'user')
    const firstImageUrl = firstUser.content.find((p: any) => p.type === 'image_url')?.image_url?.url
    expect(firstImageUrl).toBe(externalUrl)

    const secondBody = JSON.parse(openrouterCalls[1][1]?.body as string)
    const secondUser = secondBody.messages.find((m: any) => m.role === 'user')
    const secondImageUrl = secondUser.content.find((p: any) => p.type === 'image_url')?.image_url?.url
    expect(secondImageUrl.startsWith('data:image/')).toBe(true)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.generatedImages.includes(externalUrl)).toBe(false)
  })
})
