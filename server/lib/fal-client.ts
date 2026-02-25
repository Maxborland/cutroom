import { fal } from '@fal-ai/client';

let _configured = false;
let _lastKey = '';

export function configureFal(apiKey: string): void {
  if (_configured && apiKey === _lastKey) return;
  fal.config({ credentials: apiKey });
  _configured = true;
  _lastKey = apiKey;
}

/**
 * Try to upload a base64 data URL to fal.storage.
 * Falls back to inline data URL if upload times out or fails.
 */
async function tryUploadToFalStorage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:')) return dataUrl;

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  const ext = mimeType.split('/')[1] || 'png';
  const sizeKB = (buffer.length / 1024).toFixed(0);

  try {
    const file = new File([buffer], `upload.${ext}`, { type: mimeType });
    console.log(`[fal] Uploading ${sizeKB}KB image to fal.storage...`);
    const url = await fal.storage.upload(file);
    console.log(`[fal] Upload OK: ${url.slice(0, 80)}...`);
    return url;
  } catch (err: any) {
    console.warn(`[fal] Upload failed (${sizeKB}KB), using inline data URL:`, err?.cause?.code || err?.message || 'unknown');
    return dataUrl;
  }
}

/** Sleep helper */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errorMessageIncludes(err: any, pattern: string): boolean {
  const needle = pattern.toLowerCase();
  const message = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase();
  return message.includes(needle);
}

function isRetryableFalError(err: any): boolean {
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return true;
  }

  const code = String(err?.cause?.code ?? err?.code ?? '').toUpperCase();
  if ([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_REQUEST_TIMEOUT',
  ].includes(code)) {
    return true;
  }

  return errorMessageIncludes(err, 'terminated')
    || errorMessageIncludes(err, 'fetch failed')
    || errorMessageIncludes(err, 'timeout')
    || errorMessageIncludes(err, 'socket');
}

function isFalInputValidationError(err: any, inputKeys: string[]): boolean {
  if (inputKeys.length === 0) return false;

  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0);
  if (status !== 400 && status !== 422) return false;

  const detailText = JSON.stringify(err?.body?.detail ?? '').toLowerCase();
  const message = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase();
  const haystack = `${detailText} ${message}`;
  const mentionsInputKey = inputKeys.some((key) => haystack.includes(key.toLowerCase()));

  if (!mentionsInputKey) return false;

  return haystack.includes('unknown')
    || haystack.includes('unexpected')
    || haystack.includes('extra')
    || haystack.includes('not permitted')
    || haystack.includes('value_error')
    || haystack.includes('invalid')
    || haystack.includes('not allowed');
}

function extractPermittedDurationValues(err: any): Array<string | number> {
  const detail = err?.body?.detail;
  if (!Array.isArray(detail)) return [];

  for (const item of detail) {
    const loc = Array.isArray(item?.loc) ? item.loc.map((v: unknown) => String(v).toLowerCase()) : [];
    if (!loc.includes('duration')) continue;

    const permitted = item?.ctx?.permitted;
    if (Array.isArray(permitted) && permitted.length > 0) {
      return permitted
        .filter((value: unknown) => typeof value === 'string' || typeof value === 'number')
        .map((value: string | number) => value);
    }

    const msg = String(item?.msg || '');
    const matches = [...msg.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter(Boolean);
    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
}

function toDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;

  const withSuffix = trimmed.match(/^(\d+(?:\.\d+)?)s$/);
  if (withSuffix) {
    const n = Number.parseFloat(withSuffix[1]);
    return Number.isFinite(n) ? n : undefined;
  }

  const plain = Number.parseFloat(trimmed);
  return Number.isFinite(plain) ? plain : undefined;
}

function chooseNearestPermittedDuration(
  permitted: Array<string | number>,
  requested: unknown,
): string | number | undefined {
  if (permitted.length === 0) return undefined;

  const requestedSec = toDurationSeconds(requested);
  if (requestedSec === undefined) return permitted[0];

  let best: string | number | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const candidate of permitted) {
    const sec = toDurationSeconds(candidate);
    if (sec === undefined) continue;
    const delta = Math.abs(sec - requestedSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }

  return best ?? permitted[0];
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(ms);
    return;
  }

  if (signal.aborted) throw new Error('Generation cancelled');

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Generation cancelled'));
    };

    timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Call fal.subscribe with automatic retry on transient errors (500, timeouts).
 */
async function falSubscribeWithRetry(
  endpoint: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  maxAttempts = 4,
): Promise<any> {
  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('Generation cancelled');

    try {
      const subscribeOptions: any = {
        input,
        pollInterval: 3000,
      };
      if (signal) subscribeOptions.signal = signal;

      const result = await fal.subscribe(endpoint, subscribeOptions);
      return result;
    } catch (err: any) {
      lastErr = err;
      const isRetryable = isRetryableFalError(err);

      if (err?.body?.detail) {
        const detail = JSON.stringify(err.body.detail).slice(0, 800);
        console.error(`[fal] Error (attempt ${attempt}/${maxAttempts}):`, detail);
      } else {
        console.error(`[fal] Error (attempt ${attempt}/${maxAttempts}):`, err?.cause?.code || err?.message || 'unknown');
      }

      if (isRetryable && attempt < maxAttempts) {
        const delay = Math.min(attempt * 3000, 12000); // 3s, 6s, 9s
        console.log(`[fal] Retrying in ${delay / 1000}s...`);
        await sleepWithAbort(delay, signal);
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}

export async function falGenerateImage(opts: {
  endpoint: string;
  prompt: string;
  referenceImageUrl?: string;
  /** Declared in the model registry. Undefined = dynamic/unknown model. */
  imageInputParam?: string;
  /** true when imageInputParam expects an array (e.g. image_urls: string[]) */
  imageIsArray?: boolean;
  aspectRatio?: string;
  /** fal.ai resolution param (e.g. "1K", "2K", "4K") for models that support it */
  resolution?: string;
}, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Generation cancelled');

  const input: Record<string, unknown> = { prompt: opts.prompt };

  // Reference image handling
  if (opts.referenceImageUrl && opts.imageInputParam) {
    const value = opts.imageIsArray
      ? [opts.referenceImageUrl]   // image_urls: ["https://..." or "data:..."]
      : opts.referenceImageUrl;    // image_url: "https://..." or "data:..."
    input[opts.imageInputParam] = value;
  } else if (opts.referenceImageUrl) {
    // Dynamic model without imageInputParam — heuristic by endpoint name
    if (opts.endpoint.includes('/edit') || opts.endpoint.includes('nano-banana')) {
      input['image_urls'] = [opts.referenceImageUrl];
    }
    // If not edit — don't send (text-to-image doesn't need image input)
  }

  // Always pass aspect_ratio when provided (models that don't support it will ignore it)
  if (opts.aspectRatio) {
    input.aspect_ratio = opts.aspectRatio;
  }

  // Resolution for models that support it (e.g. nano-banana-pro: 1K/2K/4K)
  if (opts.resolution) {
    input.resolution = opts.resolution;
  }

  console.log(`[fal] image endpoint=${opts.endpoint} params=${Object.keys(input).join(',')}`);

  const result = await falSubscribeWithRetry(opts.endpoint, input, signal);

  if (signal?.aborted) throw new Error('Generation cancelled');

  const data = result.data as any;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error('No image URL in fal.ai response');
  return url;
}

export async function falGenerateVideo(opts: {
  endpoint: string;
  prompt: string;
  sourceImageUrl: string;
  duration?: number;
  /**
   * Optional provider-specific input fields.
   * Example: { resolution: "1080P" } for models that support explicit quality control.
   */
  extraInput?: Record<string, string | number | boolean>;
}, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Generation cancelled');

  const imageUrl = await tryUploadToFalStorage(opts.sourceImageUrl);
  const baseInput: Record<string, unknown> = {
    prompt: opts.prompt,
    image_url: imageUrl,
  };
  if (opts.duration) baseInput.duration = opts.duration;
  const input: Record<string, unknown> = {
    ...baseInput,
    ...(opts.extraInput || {}),
  };

  console.log(`[fal] video endpoint=${opts.endpoint} params=${Object.keys(input).join(',')}`);

  let result: any;
  let currentInput: Record<string, unknown> = input;
  let droppedExtraInput = false;
  let adjustedDuration = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await falSubscribeWithRetry(opts.endpoint, currentInput, signal);
      break;
    } catch (err) {
      const extraKeys = Object.keys(opts.extraInput || {});
      if (!droppedExtraInput && isFalInputValidationError(err, extraKeys)) {
        droppedExtraInput = true;
        currentInput = { ...baseInput };
        console.warn(`[fal] video endpoint=${opts.endpoint} rejected optional params (${extraKeys.join(',')}); retrying without them`);
        continue;
      }

      const permittedDurations = extractPermittedDurationValues(err);
      if (!adjustedDuration && permittedDurations.length > 0) {
        const replacement = chooseNearestPermittedDuration(
          permittedDurations,
          currentInput.duration ?? opts.duration,
        );

        if (replacement !== undefined && replacement !== currentInput.duration) {
          adjustedDuration = true;
          currentInput = {
            ...currentInput,
            duration: replacement,
          };
          console.warn(`[fal] video endpoint=${opts.endpoint} adjusted duration to supported value: ${replacement}`);
          continue;
        }
      }

      throw err;
    }
  }

  if (!result) {
    throw new Error('No result received from fal.ai video generation');
  }

  if (signal?.aborted) throw new Error('Generation cancelled');

  const data = result.data as any;
  const url = data?.video?.url;
  if (!url) throw new Error('No video URL in fal.ai response');
  return url;
}
