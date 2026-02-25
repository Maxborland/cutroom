import fs from 'node:fs/promises';
import { resolveProjectPath } from './storage.js';
import { getMimeType } from './media-utils.js';

const DEFAULT_MAX_REFERENCE_BYTES = 1_500_000;
const DEFAULT_MAX_SVG_TEXT_CHARS = 4_000;

export type ReferenceSkipReason = 'too_large' | 'read_error';

export interface PreparedBriefReference {
  filename: string;
  mimeType: string;
  bytes: number;
  imageDataUrl?: string;
  svgText?: string;
  skipped: boolean;
  skipReason?: ReferenceSkipReason;
  fromCache: boolean;
}

export interface PrepareBriefReferenceOptions {
  maxReferenceBytes?: number;
  includeSvgDataUrl?: boolean;
  includeSvgText?: boolean;
  maxSvgTextChars?: number;
}

export interface PreparedBriefReferenceSummary {
  requested: number;
  prepared: number;
  skipped: number;
  oversized: number;
  cached: number;
  svgText: number;
}

export interface PreparedBriefReferenceBatch {
  items: PreparedBriefReference[];
  summary: PreparedBriefReferenceSummary;
}

type CachedPreparedBriefReference = Omit<PreparedBriefReference, 'fromCache'>;

const referenceCache = new Map<string, CachedPreparedBriefReference>();

function normalizeSvgText(raw: string, maxChars: number): string {
  if (!raw) return '';
  // Keep the original semantics, but strip comments and collapse whitespace.
  const compact = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) return '';
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}

function cacheKey(
  projectId: string,
  filename: string,
  stat: { size: number; mtimeMs: number },
  opts: Required<PrepareBriefReferenceOptions>,
): string {
  return [
    projectId,
    filename,
    stat.size,
    Math.trunc(stat.mtimeMs),
    opts.maxReferenceBytes,
    opts.includeSvgDataUrl ? 'svg-data' : 'no-svg-data',
    opts.includeSvgText ? `svg-text-${opts.maxSvgTextChars}` : 'no-svg-text',
  ].join('|');
}

function withDefaultOptions(options?: PrepareBriefReferenceOptions): Required<PrepareBriefReferenceOptions> {
  return {
    maxReferenceBytes: options?.maxReferenceBytes ?? DEFAULT_MAX_REFERENCE_BYTES,
    includeSvgDataUrl: options?.includeSvgDataUrl ?? false,
    includeSvgText: options?.includeSvgText ?? true,
    maxSvgTextChars: options?.maxSvgTextChars ?? DEFAULT_MAX_SVG_TEXT_CHARS,
  };
}

function markFromCache(cached: CachedPreparedBriefReference): PreparedBriefReference {
  return {
    ...cached,
    fromCache: true,
  };
}

function markFresh(result: CachedPreparedBriefReference): PreparedBriefReference {
  return {
    ...result,
    fromCache: false,
  };
}

export async function prepareBriefReference(
  projectId: string,
  filename: string,
  options?: PrepareBriefReferenceOptions,
): Promise<PreparedBriefReference> {
  const opts = withDefaultOptions(options);
  const filePath = resolveProjectPath(projectId, 'brief', 'images', filename);
  const mimeType = getMimeType(filename);

  let stat: { size: number; mtimeMs: number };
  try {
    const fsStat = await fs.stat(filePath);
    stat = { size: fsStat.size, mtimeMs: fsStat.mtimeMs };
  } catch {
    return {
      filename,
      mimeType,
      bytes: 0,
      skipped: true,
      skipReason: 'read_error',
      fromCache: false,
    };
  }

  const key = cacheKey(projectId, filename, stat, opts);
  const cached = referenceCache.get(key);
  if (cached) {
    return markFromCache(cached);
  }

  try {
    const buffer = await fs.readFile(filePath);
    const bytes = buffer.length;
    const isSvg = mimeType === 'image/svg+xml';

    const result: CachedPreparedBriefReference = {
      filename,
      mimeType,
      bytes,
      skipped: false,
    };

    if (isSvg) {
      if (opts.includeSvgText) {
        const svgRaw = buffer.toString('utf-8');
        const svgText = normalizeSvgText(svgRaw, opts.maxSvgTextChars);
        if (svgText) {
          result.svgText = svgText;
        }
      }

      if (opts.includeSvgDataUrl && bytes <= opts.maxReferenceBytes) {
        result.imageDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }

      if (!result.svgText && !result.imageDataUrl) {
        result.skipped = true;
        if (bytes > opts.maxReferenceBytes) {
          result.skipReason = 'too_large';
        } else {
          result.skipReason = 'read_error';
        }
      }
    } else if (bytes > opts.maxReferenceBytes) {
      result.skipped = true;
      result.skipReason = 'too_large';
    } else {
      result.imageDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    referenceCache.set(key, result);
    return markFresh(result);
  } catch {
    const failed: CachedPreparedBriefReference = {
      filename,
      mimeType,
      bytes: stat.size,
      skipped: true,
      skipReason: 'read_error',
    };
    referenceCache.set(key, failed);
    return markFresh(failed);
  }
}

export async function prepareBriefReferences(
  projectId: string,
  filenames: string[],
  options?: PrepareBriefReferenceOptions,
): Promise<PreparedBriefReferenceBatch> {
  const unique = Array.from(new Set(filenames.filter((name) => Boolean(name?.trim()))));
  const items = await Promise.all(unique.map((filename) => prepareBriefReference(projectId, filename, options)));

  const summary: PreparedBriefReferenceSummary = {
    requested: unique.length,
    prepared: items.filter((item) => Boolean(item.imageDataUrl) || Boolean(item.svgText)).length,
    skipped: items.filter((item) => item.skipped).length,
    oversized: items.filter((item) => item.skipReason === 'too_large').length,
    cached: items.filter((item) => item.fromCache).length,
    svgText: items.filter((item) => Boolean(item.svgText)).length,
  };

  return { items, summary };
}

