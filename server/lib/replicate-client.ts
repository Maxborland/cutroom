import Replicate from 'replicate';

function isReplicateInputValidationError(err: unknown, inputKeys: string[]): boolean {
  if (inputKeys.length === 0) return false;

  const status = Number((err as any)?.status ?? (err as any)?.statusCode ?? 0);
  if (status && status !== 400 && status !== 422) return false;

  const message = JSON.stringify({
    message: (err as any)?.message || '',
    detail: (err as any)?.detail || '',
    body: (err as any)?.body || '',
    cause: (err as any)?.cause || '',
  }).toLowerCase();

  const mentionsInputKey = inputKeys.some((key) => message.includes(key.toLowerCase()));
  if (!mentionsInputKey) return false;

  return message.includes('unknown')
    || message.includes('unexpected')
    || message.includes('invalid')
    || message.includes('not allowed')
    || message.includes('not permitted')
    || message.includes('extra');
}

export async function replicateGenerateImage(opts: {
  endpoint: string;
  prompt: string;
  referenceImageUrl?: string;
  imageInputParam?: string;
  aspectRatio?: string;
}, apiToken: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Generation cancelled');

  const replicate = new Replicate({ auth: apiToken });

  const input: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.aspectRatio) input.aspect_ratio = opts.aspectRatio;
  if (opts.referenceImageUrl && opts.imageInputParam) {
    input[opts.imageInputParam] = toReplicateImageInput(opts.referenceImageUrl);
  }

  console.log(`[replicate] image endpoint=${opts.endpoint}`);

  const output = await replicate.run(opts.endpoint as `${string}/${string}`, { input, signal });

  if (signal?.aborted) throw new Error('Generation cancelled');

  const url = extractUrl(output);
  if (!url) throw new Error('No image URL in Replicate response');
  return url;
}

export async function replicateGenerateVideo(opts: {
  endpoint: string;
  prompt: string;
  sourceImageUrl: string;
  duration?: number;
  sourceImageParam?: string;
  supportsDuration?: boolean;
  /**
   * Optional provider-specific input fields.
   */
  extraInput?: Record<string, string | number | boolean>;
}, apiToken: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Generation cancelled');

  const replicate = new Replicate({ auth: apiToken });

  const sourceImageParam = opts.sourceImageParam || 'image_url';
  const baseInput: Record<string, unknown> = {
    prompt: opts.prompt,
    [sourceImageParam]: toReplicateImageInput(opts.sourceImageUrl),
  };
  if (opts.duration && opts.supportsDuration !== false) baseInput.duration = opts.duration;

  const input: Record<string, unknown> = {
    ...baseInput,
    ...(opts.extraInput || {}),
  };

  console.log(`[replicate] video endpoint=${opts.endpoint} params=${Object.keys(input).join(',')}`);

  let output: unknown;
  try {
    output = await replicate.run(opts.endpoint as `${string}/${string}`, { input, signal });
  } catch (err) {
    const extraKeys = Object.keys(opts.extraInput || {});
    if (!isReplicateInputValidationError(err, extraKeys)) {
      throw err;
    }

    console.warn(`[replicate] video endpoint=${opts.endpoint} rejected optional params (${extraKeys.join(',')}); retrying without them`);
    output = await replicate.run(opts.endpoint as `${string}/${string}`, { input: baseInput, signal });
  }

  if (signal?.aborted) throw new Error('Generation cancelled');

  const url = extractUrl(output);
  if (!url) throw new Error('No video URL in Replicate response');
  return url;
}

function extractUrl(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'url' in first) {
      return typeof (first as any).url === 'function' ? (first as any).url() : (first as any).url;
    }
  }
  if (output && typeof output === 'object' && 'url' in output) {
    return (output as any).url;
  }
  return null;
}

function toReplicateImageInput(image: string): string | Buffer {
  const dataUrlMatch = image.match(/^data:[^;]+;base64,(.+)$/);
  if (!dataUrlMatch) return image;

  try {
    return Buffer.from(dataUrlMatch[1], 'base64');
  } catch {
    return image;
  }
}
