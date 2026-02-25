import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from './setup'
import { resetModelCache } from '../../server/routes/models'

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')

describe('Models API', () => {
  const originalFetch = global.fetch
  let originalSettings: string | null = null

  beforeAll(async () => {
    try {
      originalSettings = await fs.readFile(SETTINGS_PATH, 'utf-8')
    } catch {
      originalSettings = null
    }
  })

  afterAll(async () => {
    if (originalSettings !== null) {
      await fs.writeFile(SETTINGS_PATH, originalSettings, 'utf-8')
    } else {
      try {
        await fs.unlink(SETTINGS_PATH)
      } catch {
        // ignore
      }
    }
  })

  beforeEach(() => {
    resetModelCache()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('should return text/image OpenRouter models and dynamic fal models grouped by category', async () => {
    await request(app)
      .put('/api/settings')
      .send({ falApiKey: 'fal_test_key_123' })
      .expect(200)

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()

      if (url.includes('openrouter.ai/api/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { id: 'openai/gpt-4o', name: 'GPT-4o', architecture: { modality: 'text->text' } },
                { id: 'openai/gpt-image-1', name: 'GPT Image 1', architecture: { modality: 'text->image' } },
                { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', architecture: { modality: 'text->text' } },
              ],
            }),
        })
      }

      if (url.includes('api.fal.ai/v1/models') && url.includes('category=text-to-image')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                {
                  endpoint_id: 'fal-ai/imagen4/preview',
                  metadata: {
                    display_name: 'Imagen 4 Preview',
                    category: 'text-to-image',
                    input_schema: {
                      properties: {
                        resolution: { enum: ['1K', '2K', '4K'] },
                        aspect_ratio: { enum: ['1:1', '16:9'] },
                      },
                    },
                  },
                },
              ],
            }),
        })
      }

      if (url.includes('api.fal.ai/v1/models') && url.includes('category=image-to-video')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                {
                  endpoint_id: 'fal-ai/veo3.1/fast/image-to-video',
                  metadata: {
                    display_name: 'Veo 3.1 Fast',
                    category: 'image-to-video',
                  },
                },
                {
                  endpoint_id: 'fal-ai/minimax/hailuo-02/pro/image-to-video',
                  metadata: { display_name: 'MiniMax Hailuo 02', category: 'image-to-video' },
                },
              ],
            }),
        })
      }

      if (url.includes('api.fal.ai/v1/models') && url.includes('category=text-to-speech')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                {
                  endpoint_id: 'fal-ai/elevenlabs/text-to-speech',
                  metadata: { display_name: 'ElevenLabs TTS', category: 'text-to-speech' },
                },
              ],
            }),
        })
      }

      if (url.includes('api.fal.ai/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const res = await request(app).get('/api/models').expect(200)

    expect(res.body.textModels).toBeDefined()
    expect(res.body.imageModels).toBeDefined()
    expect(Array.isArray(res.body.textModels)).toBe(true)
    expect(Array.isArray(res.body.imageModels)).toBe(true)
    expect(res.body.textModels.length).toBeGreaterThanOrEqual(1)
    expect(res.body.imageModels.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(res.body.imageGenModels)).toBe(true)
    expect(Array.isArray(res.body.videoGenModels)).toBe(true)
    expect(Array.isArray(res.body.audioGenModels)).toBe(true)
    expect(res.body.imageGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/imagen4/preview',
          imageResolutionSupport: 'explicit',
          imageResolutionOptions: ['1K', '2K', '4K'],
          imageAspectRatioSupport: 'explicit',
          imageAspectRatioOptions: ['1:1', '16:9'],
        }),
      ]),
    )
    expect(res.body.videoGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/veo3.1/fast/image-to-video',
          videoQualitySupport: 'explicit',
          videoQualityOptions: ['720p', '1080p', '4k'],
        }),
        expect.objectContaining({
          id: 'fal/minimax-hailuo',
          videoQualitySupport: 'none',
        }),
      ]),
    )
    expect(res.body.audioGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/elevenlabs/text-to-speech',
        }),
      ]),
    )
  })

  it('should fall back to static generation models when fal discovery fails', async () => {
    await request(app)
      .put('/api/settings')
      .send({ falApiKey: 'fal_test_key_123' })
      .expect(200)

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()

      if (url.includes('openrouter.ai/api/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
      }

      if (url.includes('api.fal.ai/v1/models')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'upstream error' }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const res = await request(app).get('/api/models').expect(200)

    expect(Array.isArray(res.body.imageGenModels)).toBe(true)
    expect(Array.isArray(res.body.videoGenModels)).toBe(true)
    expect(Array.isArray(res.body.audioGenModels)).toBe(true)
    expect(res.body.imageGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fal/flux-kontext-max' }),
      ]),
    )
    expect(res.body.videoGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fal/kling-2.1-pro', videoQualitySupport: 'none' }),
        expect.objectContaining({ id: 'fal/minimax-hailuo', videoQualitySupport: 'none' }),
      ]),
    )
    expect(res.body.audioGenModels).toEqual([])
  })

  it('should cache fal discovery and invalidate cache when falApiKey changes', async () => {
    await request(app)
      .put('/api/settings')
      .send({ falApiKey: 'fal_key_one' })
      .expect(200)

    let falRequests = 0

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()

      if (url.includes('openrouter.ai/api/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
      }

      if (url.includes('api.fal.ai/v1/models')) {
        falRequests += 1

        const authHeader =
          (init?.headers as Record<string, string> | undefined)?.Authorization ||
          (init?.headers as Record<string, string> | undefined)?.authorization ||
          ''

        const keyTag = authHeader.includes('fal_key_two') ? 'two' : 'one'

        if (url.includes('category=text-to-image')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                models: [{ endpoint_id: `fal-ai/imagen4/${keyTag}` }],
              }),
          })
        }

        if (url.includes('category=image-to-video')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                models: [{ endpoint_id: `fal-ai/veo3/${keyTag}/image-to-video` }],
              }),
          })
        }

        if (url.includes('category=text-to-speech')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                models: [{ endpoint_id: `fal-ai/tts/${keyTag}` }],
              }),
          })
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const first = await request(app).get('/api/models').expect(200)
    const requestsAfterFirst = falRequests

    const second = await request(app).get('/api/models').expect(200)
    const requestsAfterSecond = falRequests

    await request(app)
      .put('/api/settings')
      .send({ falApiKey: 'fal_key_two' })
      .expect(200)

    const third = await request(app).get('/api/models').expect(200)

    expect(first.body.imageGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/imagen4/one',
        }),
      ]),
    )
    expect(second.body.imageGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/imagen4/one',
        }),
      ]),
    )
    expect(third.body.imageGenModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fal-endpoint:fal-ai/imagen4/two',
        }),
      ]),
    )
    expect(requestsAfterSecond).toBe(requestsAfterFirst)
    expect(falRequests).toBeGreaterThan(requestsAfterSecond)
  })
})
