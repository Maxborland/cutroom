import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { subscribeMock, falConfigMock, getFalApiKeyMock, getGlobalSettingsMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  falConfigMock: vi.fn(),
  getFalApiKeyMock: vi.fn(),
  getGlobalSettingsMock: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: falConfigMock,
    subscribe: subscribeMock,
  },
}))

vi.mock('../../server/lib/config.js', () => ({
  getFalApiKey: getFalApiKeyMock,
  getGlobalSettings: getGlobalSettingsMock,
}))

import { generateSpeech } from '../../server/lib/tts-providers'

describe('tts-providers retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFalApiKeyMock.mockResolvedValue('fal-test-key')
    getGlobalSettingsMock.mockResolvedValue({})
    subscribeMock.mockResolvedValue({
      data: {
        audio: {
          url: 'https://v3b.fal.media/test-preview.mp3',
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries elevenlabs-fal audio download after transient ENOTFOUND', async () => {
    const dnsError = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    })

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(dnsError)
      .mockResolvedValueOnce(new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }))

    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSpeech(
      'Это тест предпрослушивания.',
      'elevenlabs-fal',
      'Sarah',
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.provider).toBe('elevenlabs-fal')
    expect(result.voiceId).toBe('Sarah')
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.audioBuffer.length).toBeGreaterThan(0)
  })
})
