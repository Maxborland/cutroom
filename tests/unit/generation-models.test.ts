import { describe, it, expect } from 'vitest'
import {
  findImageModel,
  findVideoModel,
  resolveOpenRouterImageFallbackModel,
  resolveImageModel,
  resolveVideoModel,
} from '../../server/lib/generation-models'

describe('generation-models', () => {
  it('resolves static image/video models', () => {
    const staticImage = findImageModel('fal/flux-kontext-max')
    const staticVideo = findVideoModel('fal/kling-2.1-pro')

    expect(staticImage).toBeDefined()
    expect(staticVideo).toBeDefined()
    expect(resolveImageModel('fal/flux-kontext-max')).toEqual(staticImage)
    expect(resolveVideoModel('fal/kling-2.1-pro')).toEqual(staticVideo)
  })

  it('resolves dynamic fal endpoint ids for image', () => {
    const model = resolveImageModel('fal-endpoint:fal-ai/imagen4/preview')

    expect(model).toBeDefined()
    expect(model?.provider).toBe('fal')
    expect(model?.endpoint).toBe('fal-ai/imagen4/preview')
    expect(model?.id).toBe('fal-endpoint:fal-ai/imagen4/preview')
    expect(model?.requiresImageInput).toBe(false)
  })

  it('does not force image input for dynamic nano-banana text-to-image endpoint', () => {
    const model = resolveImageModel('fal-endpoint:fal-ai/nano-banana-pro')

    expect(model).toBeDefined()
    expect(model?.requiresImageInput).toBe(false)
  })

  it('resolves dynamic fal endpoint ids for video', () => {
    const model = resolveVideoModel('fal-endpoint:fal-ai/veo3.1/fast/image-to-video')

    expect(model).toBeDefined()
    expect(model?.provider).toBe('fal')
    expect(model?.endpoint).toBe('fal-ai/veo3.1/fast/image-to-video')
    expect(model?.id).toBe('fal-endpoint:fal-ai/veo3.1/fast/image-to-video')
    expect(model?.videoQualityParam).toBe('resolution')
    expect(model?.videoQualityOptions).toEqual(['720p', '1080p', '4k'])
  })

  it('maps provider-specific image ids to openrouter fallback model', () => {
    expect(
      resolveOpenRouterImageFallbackModel('fal/flux-kontext-max', 'openai/gpt-image-1'),
    ).toBe('openai/gpt-image-1')
    expect(
      resolveOpenRouterImageFallbackModel('rep/flux-kontext-max', 'openai/gpt-image-1'),
    ).toBe('openai/gpt-image-1')
    expect(
      resolveOpenRouterImageFallbackModel('fal/flux-kontext-max', 'fal/flux-kontext'),
    ).toBe('openai/gpt-image-1')
  })

  it('keeps openrouter-compatible ids unchanged', () => {
    expect(
      resolveOpenRouterImageFallbackModel('openai/gpt-image-1', 'openai/gpt-image-1'),
    ).toBe('openai/gpt-image-1')
    expect(
      resolveOpenRouterImageFallbackModel('my-custom-openrouter-model', 'openai/gpt-image-1'),
    ).toBe('my-custom-openrouter-model')
  })

  it('marks edit/image-to-image models as requiring reference image', () => {
    const staticEditModel = resolveImageModel('fal/nano-banana-pro')
    const dynamicEditModel = resolveImageModel('fal-endpoint:fal-ai/some-model/edit')
    const dynamicImg2ImgModel = resolveImageModel('fal-endpoint:fal-ai/some-model/image-to-image')

    expect(staticEditModel?.requiresImageInput).toBe(true)
    expect(dynamicEditModel?.requiresImageInput).toBe(true)
    expect(dynamicImg2ImgModel?.requiresImageInput).toBe(true)
  })

  it('stores model-specific video quality capabilities where supported', () => {
    const minimax = findVideoModel('fal/minimax-hailuo')
    const wan = findVideoModel('fal/wan-2.1')
    const kling = findVideoModel('fal/kling-2.1-pro')

    expect(minimax?.videoQualityParam).toBe('resolution')
    expect(minimax?.videoQualityValues?.high).toBe('1080P')
    expect(minimax?.videoQualityValues?.medium).toBe('768P')
    expect(minimax?.videoQualityOptions).toEqual(['768P', '1080P'])
    expect(wan?.videoQualityParam).toBe('resolution')
    expect(wan?.videoQualityValues?.high).toBe('720p')
    expect(wan?.videoQualityOptions).toEqual(['480p', '720p'])
    expect(kling?.videoQualityParam).toBeUndefined()
  })
})
