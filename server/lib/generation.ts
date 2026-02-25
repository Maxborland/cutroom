import {
  type ImageModel,
  type VideoModel,
  resolveVideoQualityInput,
} from './generation-models.js';
import { configureFal, falGenerateImage, falGenerateVideo } from './fal-client.js';
import { replicateGenerateImage, replicateGenerateVideo } from './replicate-client.js';
import { getFalApiKey, getReplicateToken } from './config.js';

export async function generateImage(options: {
  model: ImageModel;
  prompt: string;
  referenceImageUrl?: string;
  aspectRatio?: string;
  /** fal.ai resolution (e.g. "1K", "2K", "4K") */
  resolution?: string;
}, signal?: AbortSignal): Promise<string> {
  const { model, prompt, referenceImageUrl, aspectRatio, resolution } = options;

  if (model.provider === 'fal') {
    const apiKey = await getFalApiKey();
    if (!apiKey) throw new Error('fal.ai API key is not configured. Set it in Settings.');
    configureFal(apiKey);
    return falGenerateImage({
      endpoint: model.endpoint,
      prompt,
      referenceImageUrl,
      imageInputParam: model.imageInputParam,
      imageIsArray: model.imageIsArray,
      aspectRatio,
      resolution,
    }, signal);
  }

  if (model.provider === 'replicate') {
    const token = await getReplicateToken();
    if (!token) throw new Error('Replicate API token is not configured. Set it in Settings.');
    return replicateGenerateImage({
      endpoint: model.endpoint,
      prompt,
      referenceImageUrl,
      imageInputParam: model.imageInputParam,
      aspectRatio,
    }, token, signal);
  }

  throw new Error(`Unknown provider: ${(model as any).provider}`);
}

export async function generateVideoFromImage(options: {
  model: VideoModel;
  prompt: string;
  sourceImageUrl: string;
  duration?: number;
  quality?: string;
}, signal?: AbortSignal): Promise<string> {
  const { model, prompt, sourceImageUrl, duration, quality } = options;
  const qualityInput = resolveVideoQualityInput(model, quality);

  if (model.provider === 'fal') {
    const apiKey = await getFalApiKey();
    if (!apiKey) throw new Error('fal.ai API key is not configured. Set it in Settings.');
    configureFal(apiKey);
    return falGenerateVideo({
      endpoint: model.endpoint,
      prompt,
      sourceImageUrl,
      duration,
      extraInput: qualityInput,
    }, signal);
  }

  if (model.provider === 'replicate') {
    const token = await getReplicateToken();
    if (!token) throw new Error('Replicate API token is not configured. Set it in Settings.');
    return replicateGenerateVideo({
      endpoint: model.endpoint,
      prompt,
      sourceImageUrl,
      duration,
      sourceImageParam: model.sourceImageParam,
      supportsDuration: model.supportsDuration,
      extraInput: qualityInput,
    }, token, signal);
  }

  throw new Error(`Unknown provider: ${(model as any).provider}`);
}
