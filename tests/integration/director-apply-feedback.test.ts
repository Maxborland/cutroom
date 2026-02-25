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

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')
const originalFetch = global.fetch

describe('director apply-feedback lifecycle', () => {
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

  async function createProjectWithDirectorReview(): Promise<{ project: Project; reviewId: string }> {
    const project = await createProject('Director Apply Feedback Test')
    createdProjectIds.push(project.id)

    const shot: ShotMeta = {
      id: 'shot-001',
      order: 0,
      scene: 'Initial scene',
      audioDescription: '',
      imagePrompt: 'initial image prompt',
      videoPrompt: 'initial video prompt',
      duration: 4,
      assetRefs: [],
      status: 'draft',
      generatedImages: [],
      enhancedImages: [],
      selectedImage: null,
      videoFile: null,
    }

    const reviewId = 'review-shots-001'
    ;(project as any).directorState = {
      reviews: [
        {
          id: reviewId,
          stage: 'shots',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          model: 'openai/gpt-4o',
          overallVerdict: 'revise',
          summary: 'Нужна перенарезка',
          notes: [
            {
              id: 'note-001',
              target: 'structure',
              verdict: 'revise',
              comment: 'Переход между сценами резкий',
              suggestion: 'Добавить промежуточный шот',
            },
          ],
        },
      ],
      latestByStage: {
        shots: reviewId,
      },
    }
    project.script = 'Сцена 1. Открывающий кадр.'
    project.shots = [shot]
    await saveProject(project)

    return { project, reviewId }
  }

  async function createProjectWithImageReview(): Promise<{ project: Project; reviewId: string }> {
    const project = await createProject('Director Image Feedback Test')
    createdProjectIds.push(project.id)

    const shots: ShotMeta[] = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Hero facade',
        audioDescription: '',
        imagePrompt: 'hero facade cinematic',
        videoPrompt: 'slow push in',
        duration: 4,
        assetRefs: [],
        status: 'img_review',
        generatedImages: ['seed-001.png'],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      },
      {
        id: 'shot-002',
        order: 1,
        scene: 'Courtyard lifestyle',
        audioDescription: '',
        imagePrompt: 'courtyard with people',
        videoPrompt: 'walkthrough',
        duration: 4,
        assetRefs: [],
        status: 'img_review',
        generatedImages: ['seed-002.png'],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ]

    const reviewId = 'review-images-001'
    ;(project as any).directorState = {
      reviews: [
        {
          id: reviewId,
          stage: 'images',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          model: 'openai/gpt-4o',
          overallVerdict: 'revise',
          summary: 'Need image fixes',
          shotVerdicts: {
            'shot-001': 'revise',
            'shot-002': 'reject',
          },
          notes: [
            {
              id: 'note-img-001',
              target: 'shot-001',
              verdict: 'revise',
              comment: 'Perspective mismatch',
              suggestion: 'Align camera angle and facade proportions',
              type: 'issue',
            },
            {
              id: 'note-img-002',
              target: 'shot-002',
              verdict: 'reject',
              comment: 'Different building identity',
              suggestion: 'Preserve exact geometry from references',
              type: 'issue',
            },
          ],
        },
      ],
      latestByStage: {
        images: reviewId,
      },
    }
    project.shots = shots
    await saveProject(project)
    return { project, reviewId }
  }

  it('removes latest shots review marker after regenerate-shots apply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  scene: 'Updated scene from feedback',
                  imagePrompt: 'new image prompt',
                  videoPrompt: 'new video prompt',
                  duration: 3,
                  assetRefs: [],
                  audioDescription: 'new audio',
                },
              ]),
            },
          },
        ],
      }),
      text: async () => '',
    } as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await request(app)
      .put('/api/settings')
      .send({ openRouterApiKey: 'sk-or-test' })
      .expect(200)

    const { project, reviewId } = await createProjectWithDirectorReview()

    await request(app)
      .post(`/api/projects/${project.id}/director/apply-feedback`)
      .send({ reviewId, action: 'regenerate-shots' })
      .expect(200)

    const updated = await getProject(project.id)
    expect(updated).toBeTruthy()
    if (!updated) return

    const state = (updated as any).directorState
    expect(state.latestByStage.shots).toBeUndefined()
    expect(updated.shots.length).toBe(1)
    expect(updated.shots[0].scene).toBe('Updated scene from feedback')
  })

  it('regenerate-image resolves only selected shot note and keeps latest images review if other issues remain', async () => {
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
        defaultImageGenModel: 'test/unknown-image-model',
      })
      .expect(200)

    const { project, reviewId } = await createProjectWithImageReview()

    await request(app)
      .post(`/api/projects/${project.id}/director/apply-feedback`)
      .send({ reviewId, action: 'regenerate-image', shotId: 'shot-001' })
      .expect(200)

    const updated = await getProject(project.id)
    expect(updated).toBeTruthy()
    if (!updated) return

    const updatedShot = updated.shots.find((s) => s.id === 'shot-001')
    expect(updatedShot?.generatedImages.length).toBe(2)
    expect(updatedShot?.status).toBe('img_review')

    const state = (updated as any).directorState
    expect(state.latestByStage.images).toBe(reviewId)

    const review = state.reviews.find((r: any) => r.id === reviewId)
    expect(review).toBeTruthy()
    const noteOne = review.notes.find((n: any) => n.target === 'shot-001')
    const noteTwo = review.notes.find((n: any) => n.target === 'shot-002')
    expect(noteOne?.resolvedAt).toBeTruthy()
    expect(noteTwo?.resolvedAt).toBeFalsy()
    expect(review.shotVerdicts['shot-001']).toBe('approve')
    expect(review.shotVerdicts['shot-002']).toBe('reject')
  })

  it('regenerate-images resolves all selected notes and clears latest images review marker', async () => {
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
        defaultImageGenModel: 'test/unknown-image-model',
      })
      .expect(200)

    const { project, reviewId } = await createProjectWithImageReview()

    await request(app)
      .post(`/api/projects/${project.id}/director/apply-feedback`)
      .send({
        reviewId,
        action: 'regenerate-images',
        shotIds: ['shot-001', 'shot-002'],
      })
      .expect(200)

    const updated = await getProject(project.id)
    expect(updated).toBeTruthy()
    if (!updated) return

    const firstShot = updated.shots.find((s) => s.id === 'shot-001')
    const secondShot = updated.shots.find((s) => s.id === 'shot-002')
    expect(firstShot?.generatedImages.length).toBe(2)
    expect(secondShot?.generatedImages.length).toBe(2)

    const state = (updated as any).directorState
    expect(state.latestByStage.images).toBeUndefined()
    const review = state.reviews.find((r: any) => r.id === reviewId)
    expect(review?.resolvedAt).toBeTruthy()
    expect(review?.resolvedByAction).toBe('regenerate-images')
  })
})
