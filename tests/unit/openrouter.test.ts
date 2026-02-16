import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chatCompletion, generateImage } from '../../server/lib/openrouter'

// Mock the settings module to control getApiKey
vi.mock('../../server/routes/settings', () => ({
  getApiKey: vi.fn(),
}))

import { getApiKey } from '../../server/routes/settings'

const mockedGetApiKey = vi.mocked(getApiKey)

// Store the original fetch so we can restore it
const originalFetch = global.fetch

beforeEach(() => {
  vi.resetAllMocks()
  // Default: return a valid API key
  mockedGetApiKey.mockResolvedValue('test-api-key-123')
})

afterEach(() => {
  global.fetch = originalFetch
})

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

describe('openrouter', () => {
  describe('chatCompletion', () => {
    it('returns content from the response', async () => {
      mockFetchResponse({
        choices: [{ message: { content: 'Hello from AI' } }],
      })

      const result = await chatCompletion('test-model', [
        { role: 'user', content: 'Hi' },
      ])

      expect(result).toBe('Hello from AI')

      // Verify fetch was called with correct args
      const fetchMock = vi.mocked(global.fetch)
      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(options?.method).toBe('POST')
      expect(options?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
        })
      )
      const body = JSON.parse(options?.body as string)
      expect(body.model).toBe('test-model')
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }])
      expect(body.temperature).toBe(0.7) // default
    })

    it('passes custom temperature', async () => {
      mockFetchResponse({
        choices: [{ message: { content: 'Response' } }],
      })

      await chatCompletion(
        'test-model',
        [{ role: 'user', content: 'Hi' }],
        0.3
      )

      const fetchMock = vi.mocked(global.fetch)
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
      expect(body.temperature).toBe(0.3)
    })

    it('throws if no API key is configured', async () => {
      mockedGetApiKey.mockResolvedValue('')

      await expect(
        chatCompletion('test-model', [{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('OpenRouter API key is not configured')
    })

    it('throws on non-ok response', async () => {
      mockFetchResponse({ error: 'Unauthorized' }, false, 401)

      await expect(
        chatCompletion('test-model', [{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('OpenRouter API error (401)')
    })

    it('throws if response has no content', async () => {
      mockFetchResponse({
        choices: [{ message: { content: '' } }],
      })

      await expect(
        chatCompletion('test-model', [{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('No content in OpenRouter response')
    })

    it('throws if choices array is empty', async () => {
      mockFetchResponse({ choices: [] })

      await expect(
        chatCompletion('test-model', [{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('No content in OpenRouter response')
    })
  })

  describe('generateImage', () => {
    it('returns content from the response', async () => {
      mockFetchResponse({
        choices: [{ message: { content: 'base64-image-data' } }],
      })

      const result = await generateImage('image-model', 'A beautiful sunset')

      expect(result).toBe('base64-image-data')

      // Verify the prompt was sent as a user message
      const fetchMock = vi.mocked(global.fetch)
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
      expect(body.model).toBe('image-model')
      expect(body.messages).toEqual([
        { role: 'user', content: 'A beautiful sunset' },
      ])
    })

    it('throws if no content in response', async () => {
      mockFetchResponse({ choices: [] })

      await expect(
        generateImage('image-model', 'prompt')
      ).rejects.toThrow('No content in OpenRouter image generation response')
    })

    it('throws if no API key', async () => {
      mockedGetApiKey.mockResolvedValue('')

      await expect(
        generateImage('image-model', 'prompt')
      ).rejects.toThrow('OpenRouter API key is not configured')
    })
  })
})
