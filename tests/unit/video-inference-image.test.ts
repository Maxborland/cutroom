import { afterEach, describe, expect, it, vi } from 'vitest'

const samplePngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8L3NQAAAAASUVORK5CYII='
const samplePngBuffer = Buffer.from(samplePngDataUrl.split(',')[1]!, 'base64')

describe('video inference image optimizer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('transcodes a local png buffer to a jpeg data url for inference', async () => {
    const { optimizeVideoInferenceImage } = await import('../../server/lib/video-inference-image')

    const result = await optimizeVideoInferenceImage(samplePngBuffer, 'image/png')

    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(result).not.toBe(samplePngDataUrl)
  })

  it('falls back to the original data url when optimization fails', async () => {
    vi.doMock('sharp', () => ({
      default: () => {
        throw new Error('sharp failed')
      },
    }))

    vi.resetModules()

    const { optimizeVideoInferenceImage } = await import('../../server/lib/video-inference-image')

    const result = await optimizeVideoInferenceImage(samplePngBuffer, 'image/png')

    expect(result).toBe(samplePngDataUrl)
  })
})
