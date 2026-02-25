import fs from 'node:fs/promises';
import path from 'node:path';
import type { ShotMeta } from './storage.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DOWNLOAD_TIMEOUT_MS = 20000;

function errorMessageIncludes(err: any, pattern: string): boolean {
  const needle = pattern.toLowerCase();
  const message = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase();
  return message.includes(needle);
}

function isRetryableFetchError(err: any): boolean {
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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function fetchRemoteMediaBuffer(
  url: string,
  maxAttempts = 3,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          const delay = attempt * 1500;
          console.warn(`[media] Download HTTP ${response.status} (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Failed to download media: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableFetchError(err);
      if (retryable && attempt < maxAttempts) {
        const delay = attempt * 1500;
        console.warn(`[media] Download failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s...`, (err as any)?.cause?.code || (err as any)?.message || 'unknown');
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error('Failed to download media');
}

/**
 * Derive an image MIME type from a filename extension.
 * Defaults to image/jpeg for unknown extensions.
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * Save an image result (URL, data URL, or raw base64) to a file on disk.
 */
export async function saveImageResult(resultUrl: string, filePath: string): Promise<void> {
  if (resultUrl.startsWith('data:') || resultUrl.match(/^[A-Za-z0-9+/=\s]+$/)) {
    let base64Data = resultUrl;
    if (base64Data.startsWith('data:')) {
      base64Data = base64Data.split(',')[1];
    }
    await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
  } else if (resultUrl.startsWith('http')) {
    const buffer = await fetchRemoteMediaBuffer(resultUrl);
    await fs.writeFile(filePath, buffer);
  } else {
    await fs.writeFile(filePath, Buffer.from(resultUrl, 'base64'));
  }
}

/**
 * Pick the best available image file for a shot:
 * last enhanced > last generated > null
 */
export function getBestImageFile(shot: ShotMeta): string | null {
  const enhanced = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
  if (enhanced.length > 0) return enhanced[enhanced.length - 1];
  if (shot.generatedImages.length > 0) return shot.generatedImages[shot.generatedImages.length - 1];
  return null;
}
