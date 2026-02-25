import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runMock, ctorMock, ReplicateMock } = vi.hoisted(() => {
  const run = vi.fn()
  const ctor = vi.fn()

  class MockReplicate {
    run = run

    constructor(opts: unknown) {
      ctor(opts)
    }
  }

  return {
    runMock: run,
    ctorMock: ctor,
    ReplicateMock: MockReplicate,
  }
})

vi.mock('replicate', () => ({
  default: ReplicateMock,
}))

import { replicateGenerateImage, replicateGenerateVideo } from '../../server/lib/replicate-client'
import { findImageModel, findVideoModel } from '../../server/lib/generation-models'

describe('replicate integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses Replicate-native input param names in model registry', () => {
    const imageModel = findImageModel('rep/flux-kontext-max')
    const klingModel = findVideoModel('rep/kling-2.1') as any
    const minimaxModel = findVideoModel('rep/minimax-video-01') as any

    expect(imageModel?.imageInputParam).toBe('input_image')
    expect(klingModel?.sourceImageParam).toBe('start_image')
    expect(minimaxModel?.sourceImageParam).toBe('first_frame_image')
    expect(minimaxModel?.supportsDuration).toBe(false)
  })

  it('sends image data-url as binary input and forwards abort signal', async () => {
    runMock.mockResolvedValue('https://example.com/out.png')

    const signal = new AbortController().signal
    const dataUrl = 'data:image/png;base64,aGVsbG8='

    const url = await replicateGenerateImage(
      {
        endpoint: 'black-forest-labs/flux-kontext-max',
        prompt: 'test prompt',
        referenceImageUrl: dataUrl,
        imageInputParam: 'input_image',
        aspectRatio: '16:9',
      },
      'r8_test_token',
      signal,
    )

    expect(url).toBe('https://example.com/out.png')
    expect(ctorMock).toHaveBeenCalledWith({ auth: 'r8_test_token' })
    expect(runMock).toHaveBeenCalledOnce()

    const [model, options] = runMock.mock.calls[0]
    expect(model).toBe('black-forest-labs/flux-kontext-max')
    expect(options.signal).toBe(signal)
    expect(options.input.prompt).toBe('test prompt')
    expect(options.input.aspect_ratio).toBe('16:9')
    expect(options.input.input_image).toBeInstanceOf(Buffer)
    expect(options.input.input_image.toString('utf-8')).toBe('hello')
  })

  it('uses model-specific video image param instead of generic image_url', async () => {
    runMock.mockResolvedValue('https://example.com/out.mp4')

    await replicateGenerateVideo(
      {
        endpoint: 'kwaivgi/kling-v2.1',
        prompt: 'walkthrough',
        sourceImageUrl: 'data:image/png;base64,aGVsbG8=',
        duration: 4,
        sourceImageParam: 'start_image',
      } as any,
      'r8_test_token',
    )

    const [, options] = runMock.mock.calls[0]
    expect(options.input.start_image).toBeInstanceOf(Buffer)
    expect(options.input.image_url).toBeUndefined()
  })
})
