import { Router, Request, Response } from 'express';
import { readLimiter, generationLimiter } from '../../lib/rate-limit.js';
import {
  getProject,
  saveProject,
} from '../../lib/storage.js';
import { getProjectStorageAdapter } from '../../lib/storage-adapters/index.js';
import {
  cacheVideoLocally,
  enqueueVideoCacheJob,
  InvalidExternalVideoUrlError,
} from '../../lib/jobs/video-cache.js';
import { generateVideoFromImage } from '../../lib/generation.js';
import { resolveVideoModel, resolveVideoQualityInput } from '../../lib/generation-models.js';
import { getBestImageFile, getMimeType } from '../../lib/media-utils.js';
import { getErrorMessage, sendApiError } from '../../lib/api-error.js';
import { safeLogValue } from '../../lib/safe-log.js';
import { resolveSettings, activeGenerations, genKey } from './shared.js';

const router = Router({ mergeParams: true });
const mediaStorage = getProjectStorageAdapter();

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
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

// POST /api/projects/:id/shots/:shotId/generate-video
router.post('/shots/:shotId/generate-video', generationLimiter, async (req: Request, res: Response) => {
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
      let sourceBuffer: Buffer;
      try {
        sourceBuffer = await mediaStorage.readBuffer({
          projectId: project.id,
          scope: 'shot-generated',
          shotId,
          filename: sourceFile,
        });
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
        const local = await cacheVideoLocally(project.id, shotId, videoUrl);
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
        console.warn(
          '[generate-video] Local download failed for shot %s; keeping external URL',
          safeLogValue(shotId),
          downloadErr,
        );
        await setShotVideoFile(project.id, shotId, videoUrl);
        await enqueueVideoCacheJob({ projectId: project.id, shotId, externalUrl: videoUrl });
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

    const local = await cacheVideoLocally(project.id, shotId, externalUrl);
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
router.get('/shots/:shotId/video/:filename', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId, filename } = req.params;
    const fileRef = {
      projectId: project.id,
      scope: 'shot-video',
      shotId,
      filename,
    } as const;
    const exists = await mediaStorage.exists(fileRef);
    if (!exists) {
      sendApiError(res, 404, 'File not found');
      return;
    }

    const fileBuffer = await mediaStorage.readBuffer(fileRef);
    res.type(filename);
    res.send(fileBuffer);
  } catch (err) {
    console.error('Failed to serve video:', err);
    sendApiError(res, 500, 'Failed to serve video', 'VIDEO_SERVE_FAILED');
  }
});

// POST /api/projects/:id/generate-all-videos
router.post('/generate-all-videos', generationLimiter, async (req: Request, res: Response) => {
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
        let sourceBuffer: Buffer;
        try {
          sourceBuffer = await mediaStorage.readBuffer({
            projectId: project.id,
            scope: 'shot-generated',
            shotId: shot.id,
            filename: sourceFile,
          });
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
          const local = await cacheVideoLocally(project.id, shot.id, videoUrl);
          await setShotVideoFile(project.id, shot.id, local.filename);
          generated++;
        } catch (downloadErr) {
          if (downloadErr instanceof InvalidExternalVideoUrlError) {
            console.warn(`[generate-all-videos] Blocked forbidden external fallback for ${shot.id}`);
            continue;
          }
          console.warn(`[generate-all-videos] Local download failed for ${shot.id}; keeping external URL`, downloadErr);
          await setShotVideoFile(project.id, shot.id, videoUrl);
          await enqueueVideoCacheJob({ projectId: project.id, shotId: shot.id, externalUrl: videoUrl });
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
