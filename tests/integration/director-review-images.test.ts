import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createProject,
  deleteProject,
  ensureDir,
  resolveProjectPath,
  saveProject,
  type Project,
  type ShotMeta,
} from '../../server/lib/storage.js'
import { createApp } from './setup.js'

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')
const originalFetch = global.fetch
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y9WkAAAAASUVORK5CYII='
type OpenRouterContentPart = { type?: string; text?: string }

describe('director review-images batching', () => {
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

  async function createProjectWithGeneratedImages(count: number): Promise<Project> {
    const project = await createProject('Director Review Images Batching Test')
    createdProjectIds.push(project.id)

    const shots: ShotMeta[] = Array.from({ length: count }, (_, index) => {
      const shotId = `shot-${String(index + 1).padStart(3, '0')}`
      return {
        id: shotId,
        order: index,
        scene: `Scene ${index + 1}`,
        audioDescription: '',
        imagePrompt: `Prompt ${index + 1}`,
        videoPrompt: `Video ${index + 1}`,
        duration: 4,
        assetRefs: [],
        status: 'img_review',
        generatedImages: [`seed-${index + 1}.png`],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      }
    })

    project.shots = shots
    await saveProject(project)

    const pngBuffer = Buffer.from(TEST_PNG_BASE64, 'base64')
    for (const shot of shots) {
      const generatedDir = resolveProjectPath(project.id, 'shots', shot.id, 'generated')
      await ensureDir(generatedDir)
      await fs.writeFile(path.join(generatedDir, shot.generatedImages[0]), pngBuffer)
    }

    return project
  }

  it('splits overview into batches of 5 and caps detail review parallelism at 2', async () => {
    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const project = await createProjectWithGeneratedImages(6)

    const overviewBatchSizes: number[] = []
    const reviewedShotIds: string[] = []
    let activeDetailRequests = 0
    let maxDetailConcurrency = 0

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || '{}'))
      const userContent = payload.messages?.[1]?.content
      if (!Array.isArray(userContent)) {
        throw new Error('Unexpected OpenRouter request format')
      }

      const contentParts = userContent as OpenRouterContentPart[]
      const textParts = contentParts
        .filter((part): part is OpenRouterContentPart & { type: 'text' } => part?.type === 'text')
        .map((part) => String(part.text || ''))
      const headerParts = textParts.filter((text: string) => text.startsWith('--- Shot #'))
      if (headerParts.length > 0) {
        overviewBatchSizes.push(headerParts.length)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: `Batch ${overviewBatchSizes.length} summary`,
              },
            }],
          }),
          text: async () => '',
        } as Response
      }

      const generatedLine = textParts.find((text: string) => text.startsWith('Generated image for shot '))
      if (!generatedLine) {
        throw new Error('Unable to detect detail review call')
      }

      const shotId = generatedLine.replace('Generated image for shot ', '').trim()
      reviewedShotIds.push(shotId)

      activeDetailRequests += 1
      maxDetailConcurrency = Math.max(maxDetailConcurrency, activeDetailRequests)
      await new Promise((resolve) => setTimeout(resolve, 30))
      activeDetailRequests -= 1

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: `VERDICT: approve\nCOMMENT: Shot ${shotId} looks good\nSUGGESTION: none`,
            },
          }],
        }),
        text: async () => '',
      } as Response
    })

    global.fetch = fetchMock as unknown as typeof fetch

    const response = await request(app)
      .post(`/api/projects/${project.id}/director/review-images`)
      .send({})
      .expect(200)

    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(overviewBatchSizes).toEqual([5, 1])
    expect(reviewedShotIds.sort()).toEqual(project.shots.map((shot) => shot.id).sort())
    expect(maxDetailConcurrency).toBe(2)
    expect(Object.keys(response.body.shotVerdicts ?? {})).toHaveLength(6)
    expect(response.body.notes).toHaveLength(6)
    expect(String(response.body.summary)).toContain('Batch 1 summary')
    expect(String(response.body.summary)).toContain('Batch 2 summary')
  })

  it('falls back to safe comment when detail response format is malformed', async () => {
    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const project = await createProjectWithGeneratedImages(1)

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || '{}'))
      const userContent = payload.messages?.[1]?.content
      if (!Array.isArray(userContent)) {
        throw new Error('Unexpected OpenRouter request format')
      }

      const contentParts = userContent as OpenRouterContentPart[]
      const textParts = contentParts
        .filter((part): part is OpenRouterContentPart & { type: 'text' } => part?.type === 'text')
        .map((part) => String(part.text || ''))

      const headerParts = textParts.filter((text: string) => text.startsWith('--- Shot #'))
      if (headerParts.length > 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Batch summary' } }],
          }),
          text: async () => '',
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'COMMENT\nАрхи\nSUGGESTION\n-',
            },
          }],
        }),
        text: async () => '',
      } as Response
    })

    global.fetch = fetchMock as unknown as typeof fetch

    const response = await request(app)
      .post(`/api/projects/${project.id}/director/review-images`)
      .send({})
      .expect(200)

    expect(response.body.notes).toHaveLength(1)
    expect(response.body.notes[0].verdict).toBe('revise')
    expect(response.body.notes[0].comment).toBe('Требуется доработка по результатам ревью.')
    expect(response.body.notes[0].suggestion).toBeUndefined()
  })
})
