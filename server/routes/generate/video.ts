import { Router, Request, Response } from 'express';
import * as dnsPromises from 'node:dns/promises';
import fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
} from '../../lib/storage.js';
import { generateVideoFromImage } from '../../lib/generation.js';
import { resolveVideoModel, resolveVideoQualityInput } from '../../lib/generation-models.js';
import { getBestImageFile, getMimeType } from '../../lib/media-utils.js';
import { getErrorMessage, sendApiError } from '../../lib/api-error.js';
import { resolveSettings, activeGenerations, genKey } from './shared.js';

const router = Router({ mergeParams: true });
const VIDEO_DOWNLOAD_ATTEMPTS = 5;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60000;
const VIDEO_DOWNLOAD_RETRY_DELAY_MS = 1500;
const VIDEO_DOWNLOAD_MAX_REDIRECTS = 5;

class InvalidExternalVideoUrlError extends Error {}
interface AllowedRemoteVideoTarget {
  address: string;
  parsedUrl: URL;
}

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

function normalizeHostForPolicyChecks(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutBrackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  const zoneIndex = withoutBrackets.indexOf('%');
  return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function decodeMappedIpv4(address: string): string | null {
  const normalized = normalizeHostForPolicyChecks(address);
  if (!normalized.startsWith('::ffff:')) {
    return null;
  }

  const mapped = normalized.slice('::ffff:'.length);
  if (isIP(mapped) === 4) {
    return mapped;
  }

  if (/^[0-9a-f]{8}$/i.test(mapped)) {
    const value = Number.parseInt(mapped, 16);
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ].join('.');
  }

  const hexGroups = mapped.split(':');
  if (hexGroups.length === 2 && hexGroups.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    const bytes = hexGroups.flatMap((part) => {
      const value = Number.parseInt(part, 16);
      return [(value >>> 8) & 0xff, value & 0xff];
    });
    return bytes.join('.');
  }

  return null;
}

function ipv4ToInt(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function isIpv4InCidr(address: string, network: string, prefixLength: number): boolean {
  const value = ipv4ToInt(address);
  const base = ipv4ToInt(network);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (base & mask);
}

function parseIpv6ToBigInt(address: string): bigint | null {
  const normalized = normalizeHostForPolicyChecks(address);
  if (!normalized.includes(':')) {
    return null;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (part: string): string[] => (
    part
      .split(':')
      .filter(Boolean)
      .flatMap((group) => {
        if (group.includes('.')) {
          if (isIP(group) !== 4) return [];
          const octets = group.split('.').map(Number);
          return [
            ((octets[0] << 8) | octets[1]).toString(16),
            ((octets[2] << 8) | octets[3]).toString(16),
          ];
        }
        return [group];
      })
  );

  const head = parseGroups(halves[0] ?? '');
  const tail = parseGroups(halves[1] ?? '');
  const missingGroups = 8 - (head.length + tail.length);

  if (missingGroups < 0 || (halves.length === 1 && missingGroups !== 0)) {
    return null;
  }

  const groups = halves.length === 2
    ? [...head, ...Array.from({ length: missingGroups }, () => '0'), ...tail]
    : head;

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isIpv6InPrefix(address: string, network: string, prefixLength: number): boolean {
  const value = parseIpv6ToBigInt(address);
  const base = parseIpv6ToBigInt(network);
  if (value === null || base === null) {
    return false;
  }

  const hostBits = 128n - BigInt(prefixLength);
  const mask = prefixLength === 0
    ? 0n
    : ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n);

  return (value & mask) === (base & mask);
}

function isGloballyRoutableHostname(hostname: string): boolean {
  const normalized = normalizeHostForPolicyChecks(hostname);

  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
  ) {
    return false;
  }

  const mappedIpv4 = decodeMappedIpv4(normalized);
  if (mappedIpv4) {
    return isGloballyRoutableHostname(mappedIpv4);
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, prefix]) => isIpv4InCidr(normalized, network as string, prefix as number));
  }

  if (ipVersion === 6) {
    return ![
      ['::', 128],
      ['::1', 128],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001:db8::', 32],
      ['2001:10::', 28],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ].some(([network, prefix]) => isIpv6InPrefix(normalized, network as string, prefix as number));
  }

  return true;
}

async function resolveAllowedRemoteVideoTarget(videoUrl: string): Promise<AllowedRemoteVideoTarget> {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (parsed.username || parsed.password || !isGloballyRoutableHostname(parsed.hostname)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  const resolved = await dnsPromises.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => !isGloballyRoutableHostname(entry.address))) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  return {
    address: resolved[0]!.address,
    parsedUrl: parsed,
  };
}

async function requestRemoteVideo(
  target: AllowedRemoteVideoTarget,
  timeoutMs: number,
): Promise<{ status: number; buffer: Buffer; headers: http.IncomingHttpHeaders | https.IncomingHttpHeaders }> {
  const { parsedUrl } = target;
  const requestImpl = parsedUrl.protocol === 'https:' ? https.request : http.request;
  const requestOptions: http.RequestOptions & https.RequestOptions = {
    hostname: target.address,
    port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
    method: 'GET',
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: {
      Host: parsedUrl.host,
    },
  };

  if (parsedUrl.protocol === 'https:') {
    const servername = normalizeHostForPolicyChecks(parsedUrl.hostname);
    requestOptions.servername = servername;
    requestOptions.checkServerIdentity = (_servername, cert) => checkServerIdentity(servername, cert);
  }

  return new Promise((resolve, reject) => {
    const req = requestImpl(requestOptions, (response) => {
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        response.resume?.();
        resolve({ status, buffer: Buffer.alloc(0), headers: response.headers });
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume?.();
        resolve({ status, buffer: Buffer.alloc(0), headers: response.headers });
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({ status, buffer: Buffer.concat(chunks), headers: response.headers });
      });
      response.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

function resolveRedirectUrl(currentUrl: string, locationHeader: string | string[] | undefined): string {
  const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
  if (!location || !location.trim()) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }
}

async function fetchAllowedRemoteVideoBuffer(
  videoUrl: string,
  maxAttempts = VIDEO_DOWNLOAD_ATTEMPTS,
  timeoutMs = VIDEO_DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let currentUrl = videoUrl;
      let redirectCount = 0;
      let response: Awaited<ReturnType<typeof requestRemoteVideo>> | null = null;

      while (redirectCount <= VIDEO_DOWNLOAD_MAX_REDIRECTS) {
        const target = await resolveAllowedRemoteVideoTarget(currentUrl);
        response = await requestRemoteVideo(target, timeoutMs);

        if (response.status >= 300 && response.status < 400) {
          if (redirectCount === VIDEO_DOWNLOAD_MAX_REDIRECTS) {
            throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
          }
          currentUrl = resolveRedirectUrl(currentUrl, response.headers.location);
          redirectCount += 1;
          continue;
        }

        break;
      }

      if (!response) {
        throw new Error('Failed to download media');
      }

      if (response.status < 200 || response.status >= 300) {
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          await sleep(attempt * VIDEO_DOWNLOAD_RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`Failed to download media: ${response.status}`);
      }

      return response.buffer;
    } catch (err) {
      lastErr = err;
      if (err instanceof InvalidExternalVideoUrlError) {
        throw err;
      }

      if (isRetryableFetchError(err) && attempt < maxAttempts) {
        await sleep(attempt * VIDEO_DOWNLOAD_RETRY_DELAY_MS);
        continue;
      }

      throw err;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error('Failed to download media');
}

async function downloadVideoToLocalFile(
  projectId: string,
  shotId: string,
  videoUrl: string,
): Promise<{ filename: string; url: string }> {
  const videoDir = resolveProjectPath(projectId, 'shots', shotId, 'video');
  await ensureDir(videoDir);

  const timestamp = Date.now();
  const videoFilename = `vid_${timestamp}.mp4`;
  const videoPath = resolveProjectPath(projectId, 'shots', shotId, 'video', videoFilename);

  const videoBuffer = await fetchAllowedRemoteVideoBuffer(videoUrl, VIDEO_DOWNLOAD_ATTEMPTS, VIDEO_DOWNLOAD_TIMEOUT_MS);
  await fs.writeFile(videoPath, videoBuffer);

  return {
    filename: videoFilename,
    url: `/api/projects/${projectId}/shots/${shotId}/video/${videoFilename}`,
  };
}

async function setShotVideoFile(
  projectId: string,
  shotId: string,
  videoFile: string,
): Promise<void> {
  const refreshed = await getProject(projectId);
  if (!refreshed) return;

  const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
  if (!refreshedShot) return;

  refreshedShot.videoFile = videoFile;
  refreshedShot.status = 'vid_review';
  await saveProject(refreshed);
}

async function cacheExternalVideoInBackground(
  projectId: string,
  shotId: string,
  externalUrl: string,
): Promise<void> {
  try {
    const local = await downloadVideoToLocalFile(projectId, shotId, externalUrl);
    const refreshed = await getProject(projectId);
    if (!refreshed) return;

    const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
    if (!refreshedShot) return;

    // Do not override if user has already changed this shot manually.
    if (refreshedShot.videoFile !== externalUrl) return;

    refreshedShot.videoFile = local.filename;
    refreshedShot.status = 'vid_review';
    await saveProject(refreshed);
    console.log(`[video-cache] Cached external video for shot ${shotId}: ${local.filename}`);
  } catch (err) {
    console.warn(`[video-cache] Background cache failed for shot ${shotId}:`, err);
  }
}

// POST /api/projects/:id/shots/:shotId/generate-video
router.post('/shots/:shotId/generate-video', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    const sourceFile = getBestImageFile(shot);

    if (!sourceFile) {
      sendApiError(res, 400, 'No source image available. Generate an image first.');
      return;
    }

    const effective = await resolveSettings(project);
    const videoModelId = req.body.model || effective.videoGenModel;
    const videoModel = resolveVideoModel(videoModelId);
    if (!videoModel) {
      sendApiError(res, 400, `Video model not found: ${videoModelId}`);
      return;
    }

    let sourceImageUrl: string;
    if (isExternalMediaRef(sourceFile)) {
      sourceImageUrl = sourceFile;
    } else {
      const sourcePath = resolveProjectPath(project.id, 'shots', shotId, 'generated', sourceFile);
      let sourceBuffer: Buffer;
      try {
        sourceBuffer = await fs.readFile(sourcePath);
      } catch {
        sendApiError(res, 404, `Source image file not found: ${sourceFile}`);
        return;
      }
      const mimeType = getMimeType(sourceFile);
      sourceImageUrl = `data:${mimeType};base64,${sourceBuffer.toString('base64')}`;
    }

    const videoPrompt = req.body.prompt || shot.videoPrompt;
    const requestedQuality = String(effective.videoQuality || 'auto');
    const qualityInput = resolveVideoQualityInput(videoModel, requestedQuality);
    const appliedQualityParam = qualityInput ? Object.keys(qualityInput)[0] : undefined;
    const appliedQuality = appliedQualityParam
      ? String(qualityInput[appliedQualityParam])
      : undefined;

    shot.status = 'vid_gen';
    await saveProject(project);

    const abortController = new AbortController();
    const key = genKey(project.id, shotId);
    activeGenerations.set(key, abortController);

    try {
      const videoUrl = await generateVideoFromImage(
        {
          model: videoModel,
          prompt: videoPrompt,
          sourceImageUrl,
          duration: shot.duration,
          quality: effective.videoQuality,
        },
        abortController.signal,
      );

      let payload: {
        filename: string;
        url: string;
        external?: boolean;
        cached?: boolean;
        requestedQuality: string;
        appliedQuality?: string;
        appliedQualityParam?: string;
      };

      try {
        const local = await downloadVideoToLocalFile(project.id, shotId, videoUrl);
        await setShotVideoFile(project.id, shotId, local.filename);
        payload = {
          filename: local.filename,
          url: local.url,
          external: false,
          cached: true,
          requestedQuality,
          appliedQuality,
          appliedQualityParam,
        };
      } catch (downloadErr) {
        if (downloadErr instanceof InvalidExternalVideoUrlError) {
          throw downloadErr;
        }
        console.warn(`[generate-video] Local download failed for shot ${shotId}; keeping external URL`, downloadErr);
        await setShotVideoFile(project.id, shotId, videoUrl);
        // Try to recover local cache asynchronously without blocking user flow.
        void cacheExternalVideoInBackground(project.id, shotId, videoUrl);
        payload = {
          filename: videoUrl,
          url: videoUrl,
          external: true,
          cached: false,
          requestedQuality,
          appliedQuality,
          appliedQualityParam,
        };
      }

      activeGenerations.delete(key);
      res.json(payload);
    } catch (genErr) {
      activeGenerations.delete(key);
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.status = 'img_review';
          await saveProject(refreshed);
        }
      }
      throw genErr;
    }
  } catch (err) {
    const isCancelled = err instanceof Error && err.message === 'Generation cancelled';
    if (isCancelled) {
      sendApiError(res, 499, 'Generation cancelled', 'GENERATION_CANCELLED');
      return;
    }
    if (err instanceof InvalidExternalVideoUrlError) {
      sendApiError(res, 400, err.message, 'VIDEO_CACHE_URL_FORBIDDEN');
      return;
    }
    console.error('Failed to generate video:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to generate video'), 'VIDEO_GENERATION_FAILED');
  }
});

// POST /api/projects/:id/shots/:shotId/cache-video
router.post('/shots/:shotId/cache-video', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    const externalUrl = shot.videoFile;
    if (!externalUrl || !isExternalMediaRef(externalUrl)) {
      sendApiError(res, 400, 'Shot does not have an external video URL to cache');
      return;
    }

    const local = await downloadVideoToLocalFile(project.id, shotId, externalUrl);
    await setShotVideoFile(project.id, shotId, local.filename);
    res.json(local);
  } catch (err) {
    if (err instanceof InvalidExternalVideoUrlError) {
      sendApiError(res, 400, err.message, 'VIDEO_CACHE_URL_FORBIDDEN');
      return;
    }
    console.error('Failed to cache external video locally:', err);
    sendApiError(res, 500, 'Failed to cache external video locally', 'VIDEO_CACHE_FAILED');
  }
});

// GET /api/projects/:id/shots/:shotId/video/:filename
router.get('/shots/:shotId/video/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId, filename } = req.params;
    let filePath: string;
    try {
      filePath = resolveProjectPath(project.id, 'shots', shotId, 'video', filename);
    } catch {
      sendApiError(res, 403, 'Forbidden');
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'File not found');
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve video:', err);
    sendApiError(res, 500, 'Failed to serve video', 'VIDEO_SERVE_FAILED');
  }
});

// POST /api/projects/:id/generate-all-videos
router.post('/generate-all-videos', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const effective = await resolveSettings(project);
    const videoModelId = effective.videoGenModel;
    const videoModel = resolveVideoModel(videoModelId);
    if (!videoModel) {
      sendApiError(res, 400, `Video model not found: ${videoModelId}`);
      return;
    }

    const shotsToGenerate = project.shots.filter(
      (s) => (s.generatedImages.length > 0 || (Array.isArray(s.enhancedImages) && s.enhancedImages.length > 0)) && !s.videoFile
    );

    console.log(`[generate-all-videos] ${shotsToGenerate.length} shots to process`);

    let generated = 0;

    for (const shot of shotsToGenerate) {
      const sourceFile = getBestImageFile(shot)!;

      let sourceImageUrl: string;
      if (isExternalMediaRef(sourceFile)) {
        sourceImageUrl = sourceFile;
      } else {
        const sourcePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', sourceFile);
        let sourceBuffer: Buffer;
        try {
          sourceBuffer = await fs.readFile(sourcePath);
        } catch {
          console.warn(`[generate-all-videos] Skipping ${shot.id}: source not found`);
          continue;
        }

        const mimeType = getMimeType(sourceFile);
        sourceImageUrl = `data:${mimeType};base64,${sourceBuffer.toString('base64')}`;
      }

      try {
        const videoUrl = await generateVideoFromImage({
          model: videoModel,
          prompt: shot.videoPrompt,
          sourceImageUrl,
          duration: shot.duration,
          quality: effective.videoQuality,
        });

        try {
          const local = await downloadVideoToLocalFile(project.id, shot.id, videoUrl);
          await setShotVideoFile(project.id, shot.id, local.filename);
          generated++;
        } catch (downloadErr) {
          if (downloadErr instanceof InvalidExternalVideoUrlError) {
            console.warn(`[generate-all-videos] Blocked forbidden external fallback for ${shot.id}`);
            continue;
          }
          console.warn(`[generate-all-videos] Local download failed for ${shot.id}; keeping external URL`, downloadErr);
          await setShotVideoFile(project.id, shot.id, videoUrl);
          void cacheExternalVideoInBackground(project.id, shot.id, videoUrl);
          generated++;
        }
      } catch (err) {
        console.error(`[generate-all-videos] Failed for ${shot.id}:`, err);
      }
    }

    res.json({ generated, total: shotsToGenerate.length });
  } catch (err) {
    console.error('Failed to generate all videos:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to generate all videos'), 'BATCH_VIDEO_GENERATION_FAILED');
  }
});

export default router;
