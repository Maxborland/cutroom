import { createHiggsfieldClient, type HiggsfieldClient } from '@higgsfield/client/v2';
import { getHiggsfieldCredentials } from '../routes/settings.js';
import type { HiggsfieldImageModel, HiggsfieldVideoModel } from './higgsfield-models.js';

// Lazy-initialised client; re-created when credentials change.
let _client: HiggsfieldClient | null = null;
let _lastCreds = '';

async function getClient(): Promise<HiggsfieldClient> {
  const creds = await getHiggsfieldCredentials();
  if (!creds) {
    throw new Error('Higgsfield credentials are not configured. Set them in Settings (format: KEY_ID:KEY_SECRET).');
  }
  if (!_client || creds !== _lastCreds) {
    _client = createHiggsfieldClient({
      credentials: creds,
      pollInterval: 3000,
      maxPollTime: 600_000, // 10 min
    });
    _lastCreds = creds;
  }
  return _client;
}

// ── Image generation ─────────────────────────────────────────────────

export interface HiggsfieldImageOptions {
  model: HiggsfieldImageModel;
  prompt: string;
  referenceImages?: string[]; // base64 data URLs ("data:image/jpeg;base64,...")
  aspectRatio?: string;       // e.g. "16:9"
}

/**
 * Generate an image via Higgsfield.
 * Automatically chooses text-to-image or image-to-image based on
 * whether referenceImages are provided AND the model supports i2i.
 * Returns the result image URL.
 */
export async function generateImageHiggsfield(
  options: HiggsfieldImageOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { model, prompt, referenceImages, aspectRatio } = options;
  const client = await getClient();

  if (signal?.aborted) throw new Error('Generation cancelled');

  const useI2I = referenceImages?.length && model.i2iEndpoint && model.refParam;
  const endpoint = useI2I ? model.i2iEndpoint! : model.id;

  // Build input object depending on mode & model
  const input: Record<string, unknown> = {
    prompt,
  };

  if (aspectRatio) input.aspect_ratio = aspectRatio;

  if (useI2I && referenceImages?.length) {
    switch (model.refParam) {
      case 'image_url':
        // Flux Kontext: accepts string or array of strings
        input.image_url = referenceImages.length === 1
          ? referenceImages[0]
          : referenceImages;
        break;
      case 'reference_image':
        // Soul: single image + strength
        input.reference_image = referenceImages[0];
        if (model.extraParams) Object.assign(input, model.extraParams);
        break;
      case 'input_images':
        // GPT Image: array of multimodal objects
        input.input_images = referenceImages.map((dataUrl) => ({
          type: 'image_url',
          image_url: dataUrl,
        }));
        break;
    }
  }

  console.log(`[higgsfield] ${useI2I ? 'img2img' : 'text2img'} endpoint=${endpoint}, refs=${referenceImages?.length ?? 0}`);

  if (signal?.aborted) throw new Error('Generation cancelled');

  const jobSet = await client.subscribe(endpoint, {
    input,
    withPolling: true,
  });

  if (signal?.aborted) throw new Error('Generation cancelled');

  if (!jobSet.isCompleted) {
    const status = jobSet.isNsfw ? 'NSFW' : jobSet.isFailed ? 'failed' : 'unknown';
    throw new Error(`Higgsfield image generation ${status}: ${jobSet.id}`);
  }

  const url = jobSet.jobs[0]?.results?.raw?.url;
  if (!url) {
    throw new Error('No image URL in Higgsfield response');
  }

  return url;
}

// ── Video generation ─────────────────────────────────────────────────

export interface HiggsfieldVideoOptions {
  model: HiggsfieldVideoModel;
  prompt: string;
  sourceImageUrl: string; // URL or data URL of source image
  duration?: number;      // seconds
}

/**
 * Generate a video from a source image via Higgsfield (image-to-video).
 * Returns the result video URL.
 */
export async function generateVideo(
  options: HiggsfieldVideoOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { model, prompt, sourceImageUrl, duration } = options;
  const client = await getClient();

  if (signal?.aborted) throw new Error('Generation cancelled');

  const input: Record<string, unknown> = {
    prompt,
    image_url: sourceImageUrl,
  };

  if (duration) input.duration = duration;

  console.log(`[higgsfield] video endpoint=${model.id}, duration=${duration ?? '-'}`);

  if (signal?.aborted) throw new Error('Generation cancelled');

  const jobSet = await client.subscribe(model.id, {
    input,
    withPolling: true,
  });

  if (signal?.aborted) throw new Error('Generation cancelled');

  if (!jobSet.isCompleted) {
    const status = jobSet.isNsfw ? 'NSFW' : jobSet.isFailed ? 'failed' : 'unknown';
    throw new Error(`Higgsfield video generation ${status}: ${jobSet.id}`);
  }

  const url = jobSet.jobs[0]?.results?.raw?.url;
  if (!url) {
    throw new Error('No video URL in Higgsfield response');
  }

  return url;
}
