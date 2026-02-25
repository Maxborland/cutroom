import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  configureFalMock,
  falGenerateImageMock,
  falGenerateVideoMock,
  replicateGenerateImageMock,
  replicateGenerateVideoMock,
} = vi.hoisted(() => ({
  configureFalMock: vi.fn(),
  falGenerateImageMock: vi.fn(),
  falGenerateVideoMock: vi.fn(),
  replicateGenerateImageMock: vi.fn(),
  replicateGenerateVideoMock: vi.fn(),
}))

vi.mock('../../server/lib/fal-client.js', () => ({
  configureFal: configureFalMock,
  falGenerateImage: falGenerateImageMock,
  falGenerateVideo: falGenerateVideoMock,
}))

vi.mock('../../server/lib/replicate-client.js', () => ({
  replicateGenerateImage: replicateGenerateImageMock,
  replicateGenerateVideo: replicateGenerateVideoMock,
}))

vi.mock('../../server/lib/config.js', () => ({
  getFalApiKey: vi.fn().mockResolvedValue('fal_test_key'),
  getReplicateToken: vi.fn().mockResolvedValue('r8_test_key'),
}))

import { generateVideoFromImage } from '../../server/lib/generation'
import { findVideoModel, resolveVideoModel } from '../../server/lib/generation-models'

describe('generateVideoFromImage quality params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    falGenerateVideoMock.mockResolvedValue('https://example.com/fal-video.mp4')
    replicateGenerateVideoMock.mockResolvedValue('https://example.com/rep-video.mp4')
  })

  it('passes model-specific high quality input to fal models that support it', async () => {
    const model = findVideoModel('fal/minimax-hailuo')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toEqual({ resolution: '1080P' })
  })

  it('passes requested quality tier when provided explicitly', async () => {
    const model = findVideoModel('fal/minimax-hailuo')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
      quality: 'medium',
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toEqual({ resolution: '768P' })
  })

  it('passes requested model-native quality value when provided explicitly', async () => {
    const model = findVideoModel('fal/minimax-hailuo')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
      quality: '1080P',
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toEqual({ resolution: '1080P' })
  })

  it('does not pass quality input when requested quality is auto', async () => {
    const model = findVideoModel('fal/minimax-hailuo')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
      quality: 'auto',
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toBeUndefined()
  })

  it('does not attach quality input for models without known quality controls', async () => {
    const model = findVideoModel('fal/kling-2.1-pro')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toBeUndefined()
  })

  it('maps dynamic Veo quality to resolution options', async () => {
    const model = resolveVideoModel('fal-endpoint:fal-ai/veo3.1/fast/image-to-video')
    expect(model).toBeTruthy()

    await generateVideoFromImage({
      model: model!,
      prompt: 'test prompt',
      sourceImageUrl: 'https://example.com/image.png',
      duration: 4,
      quality: '4k',
    })

    const [opts] = falGenerateVideoMock.mock.calls[0]
    expect(opts.extraInput).toEqual({ resolution: '4k' })
  })
})
