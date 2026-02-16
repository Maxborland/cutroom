import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from './setup'
import { resetModelCache } from '../../server/routes/models'

const app = createApp()

describe('Models API', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetModelCache()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('should return textModels and imageModels arrays', async () => {
    global.fetch = vi.fn().mockResolvedValue({
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

    const res = await request(app).get('/api/models').expect(200)

    expect(res.body.textModels).toBeDefined()
    expect(res.body.imageModels).toBeDefined()
    expect(Array.isArray(res.body.textModels)).toBe(true)
    expect(Array.isArray(res.body.imageModels)).toBe(true)
    expect(res.body.textModels.length).toBeGreaterThanOrEqual(1)
    expect(res.body.imageModels.length).toBeGreaterThanOrEqual(1)
  })

  it('should return empty arrays when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const res = await request(app).get('/api/models').expect(200)

    expect(res.body.textModels).toEqual([])
    expect(res.body.imageModels).toEqual([])
  })
})
