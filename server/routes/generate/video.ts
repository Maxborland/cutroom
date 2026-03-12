import { Router, Request, Response } from 'express';
import { lookup } from 'node:dns/promises';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
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

class InvalidExternalVideoUrlError extends Error {}

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

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (
    normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === '::'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [first, second] = normalized.split('.').map(Number);
    return first === 10
      || first === 127
      || first === 0
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }

  if (ipVersion === 6) {
    return normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }

  return false;
}

async function assertAllowedRemoteVideoUrl(videoUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  const resolved = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => isPrivateHostname(entry.address))) {
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
      await assertAllowedRemoteVideoUrl(videoUrl);

      const response = await fetch(videoUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
      }

      const finalUrl = response.url || videoUrl;
      await assertAllowedRemoteVideoUrl(finalUrl);

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          await sleep(attempt * VIDEO_DOWNLOAD_RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`Failed to download media: ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
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
        } catch (downloadErr) {
          console.warn(`[generate-all-videos] Local download failed for ${shot.id}; keeping external URL`, downloadErr);
          await setShotVideoFile(project.id, shot.id, videoUrl);
          void cacheExternalVideoInBackground(project.id, shot.id, videoUrl);
        }

        generated++;
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
