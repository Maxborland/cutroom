import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createProject,
  deleteProject,
  getProject,
  resolveProjectPath,
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

const { runMock, ReplicateMock } = vi.hoisted(() => {
  const run = vi.fn()

  class MockReplicate {
    run = run

    constructor(_opts: unknown) {}
  }

  return {
    runMock: run,
    ReplicateMock: MockReplicate,
  }
})

vi.mock('replicate', () => ({
  default: ReplicateMock,
}))

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')
const originalFetch = global.fetch

describe('Replicate generation routes', () => {
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
    const project = await createProject('Replicate Route Test')
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

  it('generates image via Replicate model and passes reference image as binary input', async () => {
    runMock.mockResolvedValue('data:image/png;base64,aW1hZ2UtYnl0ZXM=')

    await request(app)
      .put('/api/settings')
      .send({
        replicateApiToken: 'r8_test_token',
        defaultImageGenModel: 'rep/flux-kontext-max',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      assetRefs: ['reference.png'],
    })

    const refPath = resolveProjectPath(project.id, 'brief', 'images', 'reference.png')
    await fs.writeFile(refPath, Buffer.from('reference-image'))

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-image`)
      .send({})
      .expect(200)

    expect(res.body.filename).toMatch(/^gen_\d+\.png$/)
    expect(res.body.url).toContain(`/api/projects/${project.id}/shots/${shot.id}/generated/`)
    expect(runMock).toHaveBeenCalledOnce()

    const [model, options] = runMock.mock.calls[0]
    expect(model).toBe('black-forest-labs/flux-kontext-max')
    expect(options.input.prompt).toContain('hero exterior shot')
    expect(options.input.input_image).toBeInstanceOf(Buffer)
    expect(options.input.input_image.toString('utf-8')).toBe('reference-image')

    const savedProject = await getProject(project.id)
    expect(savedProject).toBeTruthy()
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('img_review')
    expect(savedShot?.generatedImages).toContain(res.body.filename)
  })

  it('generates video via Replicate Kling model using start_image and duration', async () => {
    runMock.mockResolvedValue('https://replicate.example/kling.mp4')
    global.fetch = vi.fn().mockResolvedValue(mockOkResponse('video-binary') as unknown as Response)

    await request(app)
      .put('/api/settings')
      .send({
        replicateApiToken: 'r8_test_token',
        defaultVideoGenModel: 'rep/kling-2.1',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      status: 'img_review',
      generatedImages: ['seed.png'],
    })

    const imagePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', 'seed.png')
    await fs.mkdir(path.dirname(imagePath), { recursive: true })
    await fs.writeFile(imagePath, Buffer.from('seed-image'))

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-video`)
      .send({})
      .expect(200)

    expect(res.body.filename).toMatch(/^vid_\d+\.mp4$/)
    expect(res.body.requestedQuality).toEqual(expect.any(String))
    expect(res.body.appliedQuality).toBeUndefined()
    expect(res.body.appliedQualityParam).toBeUndefined()
    expect(runMock).toHaveBeenCalledOnce()

    const [model, options] = runMock.mock.calls[0]
    expect(model).toBe('kwaivgi/kling-v2.1')
    expect(options.input.start_image).toBeInstanceOf(Buffer)
    expect(options.input.image_url).toBeUndefined()
    expect(options.input.duration).toBe(4)

    const fetchMock = vi.mocked(global.fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://replicate.example/kling.mp4',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('vid_review')
    expect(savedShot?.videoFile).toBe(res.body.filename)
  })

  it('keeps external video URL when local download fails', async () => {
    const externalVideoUrl = 'https://replicate.example/external-only.mp4'
    runMock.mockResolvedValue(externalVideoUrl)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      arrayBuffer: async () => Buffer.from(''),
    } as Response)

    await request(app)
      .put('/api/settings')
      .send({
        replicateApiToken: 'r8_test_token',
        defaultVideoGenModel: 'rep/kling-2.1',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      status: 'img_review',
      generatedImages: ['seed.png'],
    })

    const imagePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', 'seed.png')
    await fs.mkdir(path.dirname(imagePath), { recursive: true })
    await fs.writeFile(imagePath, Buffer.from('seed-image'))

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-video`)
      .send({})
      .expect(200)

    expect(res.body.filename).toBe(externalVideoUrl)
    expect(res.body.url).toBe(externalVideoUrl)
    expect(res.body.external).toBe(true)
    expect(res.body.cached).toBe(false)
    expect(res.body.requestedQuality).toEqual(expect.any(String))
    expect(res.body.appliedQuality).toBeUndefined()
    expect(res.body.appliedQualityParam).toBeUndefined()

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('vid_review')
    expect(savedShot?.videoFile).toBe(externalVideoUrl)
  })

  it('caches external video URL locally via cache-video endpoint', async () => {
    const externalVideoUrl = 'https://replicate.example/cache-me.mp4'
    global.fetch = vi.fn().mockResolvedValue(mockOkResponse('video-cache-bytes') as unknown as Response)

    const { project, shot } = await createProjectWithShot({
      status: 'vid_review',
      videoFile: externalVideoUrl,
    })

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/cache-video`)
      .send({})
      .expect(200)

    expect(res.body.filename).toMatch(/^vid_\d+\.mp4$/)
    expect(res.body.url).toContain(`/api/projects/${project.id}/shots/${shot.id}/video/`)

    const localPath = resolveProjectPath(project.id, 'shots', shot.id, 'video', res.body.filename)
    const stat = await fs.stat(localPath)
    expect(stat.isFile()).toBe(true)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('vid_review')
    expect(savedShot?.videoFile).toBe(res.body.filename)
  })

  it('retries video download when fetch fails with terminated/ECONNRESET', async () => {
    runMock.mockResolvedValue('https://replicate.example/retry.mp4')

    const resetError = new TypeError('terminated') as any
    resetError.cause = { code: 'ECONNRESET' }

    global.fetch = vi.fn()
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce(mockOkResponse('video-binary-after-retry') as unknown as Response)

    await request(app)
      .put('/api/settings')
      .send({
        replicateApiToken: 'r8_test_token',
        defaultVideoGenModel: 'rep/kling-2.1',
      })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      status: 'img_review',
      generatedImages: ['seed.png'],
    })

    const imagePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', 'seed.png')
    await fs.mkdir(path.dirname(imagePath), { recursive: true })
    await fs.writeFile(imagePath, Buffer.from('seed-image'))

    const res = await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-video`)
      .send({})
      .expect(200)

    expect(res.body.filename).toMatch(/^vid_\d+\.mp4$/)
    expect(runMock).toHaveBeenCalledOnce()
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2)

    const savedProject = await getProject(project.id)
    const savedShot = savedProject?.shots.find((s) => s.id === shot.id)
    expect(savedShot?.status).toBe('vid_review')
    expect(savedShot?.videoFile).toBe(res.body.filename)
  })

  it('generates video via Replicate MiniMax model without duration input', async () => {
    runMock.mockResolvedValue('https://replicate.example/minimax.mp4')
    global.fetch = vi.fn().mockResolvedValue(mockOkResponse('video-binary') as unknown as Response)

    await request(app)
      .put('/api/settings')
      .send({ replicateApiToken: 'r8_test_token' })
      .expect(200)

    const { project, shot } = await createProjectWithShot({
      status: 'img_review',
      duration: 5,
      generatedImages: ['seed.png'],
    })

    const imagePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', 'seed.png')
    await fs.mkdir(path.dirname(imagePath), { recursive: true })
    await fs.writeFile(imagePath, Buffer.from('seed-image'))

    await request(app)
      .post(`/api/projects/${project.id}/shots/${shot.id}/generate-video`)
      .send({ model: 'rep/minimax-video-01' })
      .expect(200)

    expect(runMock).toHaveBeenCalledOnce()
    const [model, options] = runMock.mock.calls[0]
    expect(model).toBe('minimax/video-01')
    expect(options.input.first_frame_image).toBeInstanceOf(Buffer)
    expect(options.input.duration).toBeUndefined()
  })
})
