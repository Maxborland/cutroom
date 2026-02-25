// Unified model registry for image & video generation via fal.ai and Replicate.

export interface ImageModel {
  id: string;
  provider: 'fal' | 'replicate';
  endpoint: string;
  name: string;
  category: 'image';
  supportsImageInput?: boolean;
  /** Some models (edit/image-to-image) cannot run without a source image. */
  requiresImageInput?: boolean;
  imageInputParam?: string;
  imageIsArray?: boolean;
}

export interface VideoModel {
  id: string;
  provider: 'fal' | 'replicate';
  endpoint: string;
  name: string;
  category: 'video';
  sourceImageParam?: string;
  supportsDuration?: boolean;
  /**
   * Provider-specific quality parameter name (e.g. "resolution").
   * When omitted, quality is controlled implicitly by the model tier itself.
   */
  videoQualityParam?: string;
  /**
   * Provider-specific value by logical quality tier.
   * Only set for models with known quality controls.
   */
  videoQualityValues?: Partial<Record<VideoQualityTier, string | number | boolean>>;
  /**
   * Explicit provider-supported quality values (e.g. ["480p", "720p", "1080p"]).
   * Used by UI/settings to offer only valid options for the selected model.
   */
  videoQualityOptions?: string[];
}

export type VideoQualityTier = 'low' | 'medium' | 'high';

export const DYNAMIC_FAL_MODEL_PREFIX = 'fal-endpoint:';

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'fal/flux-kontext-max',
    provider: 'fal',
    endpoint: 'fal-ai/flux-pro/kontext/max/text-to-image',
    name: 'Flux Kontext Max',
    category: 'image',
    supportsImageInput: true,
    imageInputParam: 'image_url',
  },
  {
    id: 'fal/flux-kontext',
    provider: 'fal',
    endpoint: 'fal-ai/flux-pro/kontext/text-to-image',
    name: 'Flux Kontext',
    category: 'image',
    supportsImageInput: true,
    imageInputParam: 'image_url',
  },
  {
    id: 'fal/nano-banana-pro',
    provider: 'fal',
    endpoint: 'fal-ai/nano-banana-pro/edit',
    name: 'Nano Banana Pro (Edit)',
    category: 'image',
    supportsImageInput: true,
    requiresImageInput: true,
    imageInputParam: 'image_urls',
    imageIsArray: true,
  },
  {
    id: 'fal/recraft-v3',
    provider: 'fal',
    endpoint: 'fal-ai/recraft/v3',
    name: 'Recraft V3',
    category: 'image',
  },
  {
    id: 'fal/ideogram-v3',
    provider: 'fal',
    endpoint: 'fal-ai/ideogram/v3',
    name: 'Ideogram V3',
    category: 'image',
  },
  {
    id: 'rep/flux-kontext-max',
    provider: 'replicate',
    endpoint: 'black-forest-labs/flux-kontext-max',
    name: 'Flux Kontext Max (Rep)',
    category: 'image',
    supportsImageInput: true,
    imageInputParam: 'input_image',
  },
  {
    id: 'rep/flux-kontext-pro',
    provider: 'replicate',
    endpoint: 'black-forest-labs/flux-kontext-pro',
    name: 'Flux Kontext Pro (Rep)',
    category: 'image',
    supportsImageInput: true,
    imageInputParam: 'input_image',
  },
];

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'fal/kling-2.1-pro',
    provider: 'fal',
    endpoint: 'fal-ai/kling-video/v2.1/pro/image-to-video',
    name: 'Kling 2.1 Pro',
    category: 'video',
  },
  {
    id: 'fal/minimax-hailuo',
    provider: 'fal',
    endpoint: 'fal-ai/minimax/hailuo-02/pro/image-to-video',
    name: 'MiniMax Hailuo 02',
    category: 'video',
    videoQualityParam: 'resolution',
    videoQualityValues: {
      low: '768P',
      medium: '768P',
      high: '1080P',
    },
    videoQualityOptions: ['768P', '1080P'],
  },
  {
    id: 'fal/wan-2.1',
    provider: 'fal',
    endpoint: 'fal-ai/wan/v2.1/1.3b/image-to-video',
    name: 'WAN 2.1',
    category: 'video',
    videoQualityParam: 'resolution',
    videoQualityValues: {
      low: '480p',
      medium: '720p',
      high: '720p',
    },
    videoQualityOptions: ['480p', '720p'],
  },
  {
    id: 'rep/kling-2.1',
    provider: 'replicate',
    endpoint: 'kwaivgi/kling-v2.1',
    name: 'Kling 2.1 (Rep)',
    category: 'video',
    sourceImageParam: 'start_image',
  },
  {
    id: 'rep/minimax-video-01',
    provider: 'replicate',
    endpoint: 'minimax/video-01',
    name: 'MiniMax Video-01 (Rep)',
    category: 'video',
    sourceImageParam: 'first_frame_image',
    supportsDuration: false,
  },
];

export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export function findVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

function parseDynamicFalEndpoint(modelId: string): string | null {
  if (!modelId.startsWith(DYNAMIC_FAL_MODEL_PREFIX)) {
    return null;
  }

  const endpoint = modelId.slice(DYNAMIC_FAL_MODEL_PREFIX.length).trim();
  if (!endpoint || !endpoint.includes('/')) {
    return null;
  }

  return endpoint;
}

export function resolveImageModel(modelId: string): ImageModel | undefined {
  const known = findImageModel(modelId);
  if (known) return known;

  const endpoint = parseDynamicFalEndpoint(modelId);
  if (!endpoint) return undefined;

  const endpointLower = endpoint.toLowerCase();
  const requiresImageInput =
    endpointLower.includes('/edit')
    || endpointLower.includes('image-to-image');

  return {
    id: modelId,
    provider: 'fal',
    endpoint,
    name: endpoint,
    category: 'image',
    requiresImageInput,
  };
}

export function resolveVideoModel(modelId: string): VideoModel | undefined {
  const known = findVideoModel(modelId);
  if (known) return known;

  const endpoint = parseDynamicFalEndpoint(modelId);
  if (!endpoint) return undefined;

  return {
    id: modelId,
    provider: 'fal',
    endpoint,
    name: endpoint,
    category: 'video',
    ...inferVideoQualityHints(endpoint),
  };
}

function normalizeVideoQualityTier(value: unknown): VideoQualityTier {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return 'high';
}

function inferVideoQualityHints(
  endpoint: string,
): Pick<VideoModel, 'videoQualityParam' | 'videoQualityValues' | 'videoQualityOptions'> {
  const endpointLower = endpoint.toLowerCase();

  if (endpointLower.includes('minimax/hailuo') && endpointLower.includes('image-to-video')) {
    if (endpointLower.includes('/pro/')) {
      return {
        videoQualityParam: 'resolution',
        videoQualityValues: {
          low: '768P',
          medium: '768P',
          high: '1080P',
        },
        videoQualityOptions: ['768P', '1080P'],
      };
    }

    return {
      videoQualityParam: 'resolution',
      videoQualityValues: {
        low: '512P',
        medium: '768P',
        high: '768P',
      },
      videoQualityOptions: ['512P', '768P'],
    };
  }

  if (endpointLower.includes('/wan/') && endpointLower.includes('image-to-video')) {
    return {
      videoQualityParam: 'resolution',
      videoQualityValues: {
        low: '480p',
        medium: '720p',
        high: '720p',
      },
      videoQualityOptions: ['480p', '720p'],
    };
  }

  if (endpointLower.includes('veo3') && endpointLower.includes('image-to-video')) {
    return {
      videoQualityParam: 'resolution',
      videoQualityValues: {
        low: '720p',
        medium: '1080p',
        high: '4k',
      },
      videoQualityOptions: ['720p', '1080p', '4k'],
    };
  }

  return {};
}

function dedupeVideoQualityOptions(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function getVideoModelQualityOptions(model: VideoModel): string[] {
  if (Array.isArray(model.videoQualityOptions) && model.videoQualityOptions.length > 0) {
    return dedupeVideoQualityOptions(model.videoQualityOptions);
  }

  const fromTiers = [
    model.videoQualityValues?.low,
    model.videoQualityValues?.medium,
    model.videoQualityValues?.high,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return dedupeVideoQualityOptions(fromTiers);
}

function resolveTierValue(model: VideoModel, tier: VideoQualityTier): string | number | boolean | undefined {
  const tierValues = model.videoQualityValues;
  if (!tierValues) {
    const options = getVideoModelQualityOptions(model);
    if (options.length === 0) return undefined;
    if (tier === 'low') return options[0];
    if (tier === 'medium') return options[Math.floor((options.length - 1) / 2)];
    return options[options.length - 1];
  }

  if (tier === 'low') return tierValues.low ?? tierValues.medium ?? tierValues.high;
  if (tier === 'medium') return tierValues.medium ?? tierValues.high ?? tierValues.low;
  return tierValues.high ?? tierValues.medium ?? tierValues.low;
}

function resolveRequestedRawQuality(
  requestedQuality: string,
  model: VideoModel,
): string | number | boolean | undefined {
  const requested = requestedQuality.trim();
  if (!requested) return undefined;

  const options = getVideoModelQualityOptions(model);
  const match = options.find((option) => option.toLowerCase() === requested.toLowerCase());
  if (match) return match;

  return undefined;
}

export function resolveVideoQualityInput(
  model: VideoModel,
  requestedQuality?: string,
): Record<string, string | number | boolean> | undefined {
  const param = model.videoQualityParam;
  if (!param) return undefined;

  const requested = String(requestedQuality || '').trim();

  if (requested.toLowerCase() === 'auto') {
    return undefined;
  }

  let value: string | number | boolean | undefined;
  if (!requested) {
    value = resolveTierValue(model, 'high');
  } else if (requested === 'low' || requested === 'medium' || requested === 'high') {
    value = resolveTierValue(model, requested);
  } else {
    value = resolveRequestedRawQuality(requested, model);
    if (value === undefined) {
      const tier = normalizeVideoQualityTier(requested);
      value = resolveTierValue(model, tier);
    }
  }

  if (value === undefined) return undefined;

  return { [param]: value };
}

/**
 * Maps requested image model to a model id that OpenRouter can accept.
 * Provider-specific ids (fal/*, rep/*) fall back to the provided OpenRouter model.
 */
export function resolveOpenRouterImageFallbackModel(
  requestedModelId: string,
  openRouterFallbackModelId: string,
): string {
  const resolved = resolveImageModel(requestedModelId);
  if (!resolved) return requestedModelId;

  if (resolved.provider === 'fal' || resolved.provider === 'replicate') {
    const fallbackResolved = resolveImageModel(openRouterFallbackModelId);
    if (fallbackResolved && (fallbackResolved.provider === 'fal' || fallbackResolved.provider === 'replicate')) {
      return 'openai/gpt-image-1';
    }
    return openRouterFallbackModelId || 'openai/gpt-image-1';
  }

  return requestedModelId;
}
