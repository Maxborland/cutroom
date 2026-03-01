import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { falGenerateImage, falGenerateVideo } from '../../server/lib/fal-client'

describe('fal-client image generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribeMock.mockResolvedValue({ data: { images: [{ url: 'https://example.com/image.png' }] } })
  })

  it('does not upload image-to-image references to fal.storage for nano-banana/edit endpoints', async () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='

    const result = await falGenerateImage({
      endpoint: 'fal-ai/nano-banana-pro/edit',
      prompt: 'realistic architecture',
      referenceImageUrl: dataUrl,
      imageInputParam: 'image_urls',
      imageIsArray: true,
      aspectRatio: '16:9',
      resolution: '2K',
    })

    expect(result).toBe('https://example.com/image.png')
    expect(uploadMock).not.toHaveBeenCalled()
    expect(subscribeMock).toHaveBeenCalledOnce()
    expect(subscribeMock).toHaveBeenCalledWith(
      'fal-ai/nano-banana-pro/edit',
      expect.objectContaining({
        input: expect.objectContaining({
          image_urls: [dataUrl],
        }),
      }),
    )
  })

  it('passes direct data url for single image input params without fal.storage upload', async () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='

    await falGenerateImage({
      endpoint: 'fal-ai/flux-pro/kontext/text-to-image',
      prompt: 'test',
      referenceImageUrl: dataUrl,
      imageInputParam: 'image_url',
      aspectRatio: '1:1',
    })

    expect(uploadMock).not.toHaveBeenCalled()
    expect(subscribeMock).toHaveBeenCalledWith(
      'fal-ai/flux-pro/kontext/text-to-image',
      expect.objectContaining({
        input: expect.objectContaining({
          image_url: dataUrl,
        }),
      }),
    )
  })

  it('retries when fal.subscribe fails with terminated/ECONNRESET', async () => {
    const resetError = new TypeError('terminated') as any
    resetError.cause = { code: 'ECONNRESET' }

    subscribeMock
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ data: { images: [{ url: 'https://example.com/retry-success.png' }] } })

    const result = await falGenerateImage({
      endpoint: 'fal-ai/nano-banana-pro/edit',
      prompt: 'retry test',
      referenceImageUrl: 'data:image/png;base64,aGVsbG8=',
      imageInputParam: 'image_urls',
      imageIsArray: true,
    })

    expect(result).toBe('https://example.com/retry-success.png')
    expect(subscribeMock).toHaveBeenCalledTimes(2)
  })

  it('normalizes duration for veo3 image-to-video endpoints before subscribe', async () => {
    subscribeMock.mockResolvedValueOnce({ data: { video: { url: 'https://example.com/video.mp4' } } })

    const url = await falGenerateVideo({
      endpoint: 'fal-ai/veo3.1/fast/image-to-video',
      prompt: 'test',
      sourceImageUrl: 'https://example.com/input.jpg',
      duration: 3,
    })

    expect(url).toBe('https://example.com/video.mp4')
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock.mock.calls[0][1].input.duration).toBe('4s')
  })

  it('adjusts duration to nearest permitted value when fal returns duration validation error', async () => {
    const validationError: any = new Error('ValidationError: Unprocessable Entity')
    validationError.status = 422
    validationError.body = {
      detail: [
        {
          loc: ['body', 'duration'],
          msg: "unexpected value; permitted: '4s', '6s', '8s'",
          type: 'value_error.const',
          ctx: { given: '3s', permitted: ['4s', '6s', '8s'] },
        },
      ],
    }

    subscribeMock
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce({ data: { video: { url: 'https://example.com/video.mp4' } } })

    const url = await falGenerateVideo({
      // Use an endpoint that is not pre-normalized by heuristics so the retry path is exercised.
      endpoint: 'fal-ai/unknown/image-to-video',
      prompt: 'test',
      sourceImageUrl: 'https://example.com/input.jpg',
      duration: 3,
    })

    expect(url).toBe('https://example.com/video.mp4')
    expect(subscribeMock).toHaveBeenCalledTimes(2)
    expect(subscribeMock.mock.calls[0][1].input.duration).toBe(3)
    expect(subscribeMock.mock.calls[1][1].input.duration).toBe('4s')
  })
})
