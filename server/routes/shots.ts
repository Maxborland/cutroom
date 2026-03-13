import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { readLimiter, mutationLimiter } from '../lib/rate-limit.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getProject,
  withProject,
  ensureDir,
  resolveProjectPath,
  validateProjectId,
  VALID_SHOT_STATUSES,
  type ShotMeta,
} from '../lib/storage.js';
import { sanitizeUploadedFilename } from '../lib/file-utils.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });
type EditableShotField =
  | 'scene'
  | 'audioDescription'
  | 'imagePrompt'
  | 'videoPrompt'
  | 'duration'
  | 'assetRefs';
type EditableShotUpdates = Pick<ShotMeta, EditableShotField>;

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

function isSafeManagedFilename(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed === path.basename(trimmed) && trimmed !== '.' && trimmed !== '..';
}

function resolveManagedShotFilePath(
  projectId: string,
  shotId: string,
  kind: 'generated' | 'video',
  filename: string,
): string | null {
  if (isExternalMediaRef(filename) || !isSafeManagedFilename(filename)) {
    return null;
  }

  try {
    return resolveProjectPath(projectId, 'shots', shotId, kind, filename);
  } catch {
    return null;
  }
}

function buildEditableShotUpdates(input: unknown): Partial<EditableShotUpdates> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const body = input as Record<string, unknown>;
  const updates: Partial<EditableShotUpdates> = {};

  if (typeof body.scene === 'string') updates.scene = body.scene;
  if (typeof body.audioDescription === 'string') updates.audioDescription = body.audioDescription;
  if (typeof body.imagePrompt === 'string') updates.imagePrompt = body.imagePrompt;
  if (typeof body.videoPrompt === 'string') updates.videoPrompt = body.videoPrompt;
  if (typeof body.duration === 'number' && Number.isFinite(body.duration)) updates.duration = body.duration;
  if (Array.isArray(body.assetRefs) && body.assetRefs.every((ref) => typeof ref === 'string')) {
    updates.assetRefs = body.assetRefs;
  }

  return updates;
}

function isErrorWithMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}

/**
 * Delete all generated images, enhanced images, and video for a shot.
 * Resets the shot metadata arrays. Does NOT save the project.
 */
async function cleanupShotFiles(projectId: string, shotId: string, shot: ShotMeta): Promise<void> {
  for (const filename of [...(shot.generatedImages || []), ...(shot.enhancedImages || [])]) {
    const filePath = resolveManagedShotFilePath(projectId, shotId, 'generated', filename);
    if (!filePath) continue;
    try {
      await fs.unlink(filePath);
    } catch {
      // file may already be gone
    }
  }

  if (shot.videoFile) {
    const filePath = resolveManagedShotFilePath(projectId, shotId, 'video', shot.videoFile);
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch {
        // file may already be gone
      }
    }
  }

  shot.generatedImages = [];
  shot.enhancedImages = [];
  shot.videoFile = null;
}

const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const r = req as Request;
        const projectId = validateProjectId(r.params.id);
        const shotId = r.params.shotId;

        const project = await getProject(projectId);
        if (!project) {
          const errNotFound = new Error('Project not found') as Error & { code?: string };
          errNotFound.code = 'PROJECT_NOT_FOUND';
          cb(errNotFound, '');
          return;
        }
        const shot = project.shots.find((s) => s.id === shotId);
        if (!shot) {
          const errNotFound = new Error('Shot not found') as Error & { code?: string };
          errNotFound.code = 'SHOT_NOT_FOUND';
          cb(errNotFound, '');
          return;
        }

        const dir = resolveProjectPath(projectId, 'shots', shotId, 'video');
        await ensureDir(dir);
        cb(null, dir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      cb(null, sanitizeUploadedFilename(file.originalname, 'video'));
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_VIDEO_TYPES.has(file.mimetype));
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
});

// PUT /api/projects/:id/shots/batch-status — change status for multiple shots at once
router.put('/batch-status', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotIds, status } = req.body as { shotIds?: string[]; status?: string };
    if (!status || typeof status !== 'string') {
      sendApiError(res, 400, 'status is required');
      return;
    }
    if (!(VALID_SHOT_STATUSES as readonly string[]).includes(status)) {
      sendApiError(res, 400, `Invalid status. Allowed: ${VALID_SHOT_STATUSES.join(', ')}`);
      return;
    }
    if (!Array.isArray(shotIds) || shotIds.length === 0) {
      sendApiError(res, 400, 'shotIds array is required');
      return;
    }

    let updated = 0;
    await withProject(project.id, async (current) => {
      for (const shotId of shotIds) {
        const shot = current.shots.find((s) => s.id === shotId);
        if (shot) {
          if (status === 'draft') {
            await cleanupShotFiles(current.id, shotId, shot);
          }
          shot.status = status;
          updated++;
        }
      }
    });

    res.json({ updated });
  } catch (err) {
    console.error('Failed to batch update shot status:', err);
    sendApiError(res, 500, 'Failed to batch update shot status');
  }
});

// PUT /api/projects/:id/shots/:shotId — update shot fields
router.put('/:shotId', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const shotId = req.params.shotId;
    const updates = buildEditableShotUpdates(req.body);
    const shot = await withProject(project.id, (current) => {
      const shotIndex = current.shots.findIndex((s) => s.id === shotId);
      if (shotIndex === -1) {
        throw new Error('Shot not found');
      }

      const existing = current.shots[shotIndex];
      current.shots[shotIndex] = {
        ...existing,
        ...updates,
        id: existing.id,
        order: existing.order,
      };

      return current.shots[shotIndex];
    });

    res.json(shot);
  } catch (err) {
    if (isErrorWithMessage(err, 'Shot not found')) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    console.error('Failed to update shot:', err);
    sendApiError(res, 500, 'Failed to update shot');
  }
});

// PUT /api/projects/:id/shots/:shotId/status — change shot status
router.put('/:shotId/status', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const shotId = req.params.shotId;
    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      sendApiError(res, 400, 'status is required');
      return;
    }
    if (!(VALID_SHOT_STATUSES as readonly string[]).includes(status)) {
      sendApiError(res, 400, `Invalid status. Allowed: ${VALID_SHOT_STATUSES.join(', ')}`);
      return;
    }

    const shot = await withProject(project.id, async (current) => {
      const target = current.shots.find((s) => s.id === shotId);
      if (!target) {
        throw new Error('Shot not found');
      }

      if (status === 'draft') {
        await cleanupShotFiles(current.id, shotId, target);
      }

      target.status = status;
      return target;
    });

    res.json(shot);
  } catch (err) {
    if (isErrorWithMessage(err, 'Shot not found')) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    console.error('Failed to update shot status:', err);
    sendApiError(res, 500, 'Failed to update shot status');
  }
});

// POST /api/projects/:id/shots/:shotId/video — upload video
router.post('/:shotId/video', (req: Request, res: Response, next: NextFunction) => {
  videoUpload.single('video')(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
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

    const file = req.file;
    if (!file) {
      sendApiError(res, 400, 'No video file uploaded');
      return;
    }

    await withProject(project.id, (current) => {
      const target = current.shots.find((s) => s.id === shotId);
      if (!target) {
        throw new Error('Shot not found');
      }

      target.videoFile = file.filename;
    });

    res.json({
      filename: file.filename,
      url: `/api/projects/${project.id}/shots/${shotId}/video/${encodeURIComponent(file.filename)}`,
    });
  } catch (err) {
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch {
        // ignore orphan cleanup errors
      }
    }

    if (isErrorWithMessage(err, 'Shot not found')) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    console.error('Failed to upload video:', err);
    sendApiError(res, 500, 'Failed to upload video');
  }
});

// GET /api/projects/:id/shots/:shotId/video/:filename — serve video file
router.get('/:shotId/video/:filename', readLimiter, async (req: Request, res: Response) => {
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
    sendApiError(res, 500, 'Failed to serve video');
  }
});

// DELETE /api/projects/:id/shots/:shotId/image/:filename — delete a generated/enhanced image
router.delete('/:shotId/image/:filename', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId, filename } = req.params;
    const shot = await withProject(project.id, async (current) => {
      const target = current.shots.find((s) => s.id === shotId);
      if (!target) {
        throw new Error('Shot not found');
      }

      if (!isExternalMediaRef(filename)) {
        let filePath: string;
        try {
          filePath = resolveProjectPath(current.id, 'shots', shotId, 'generated', filename);
        } catch {
          throw new Error('Forbidden');
        }

        try {
          await fs.unlink(filePath);
        } catch {
          // File may already be gone — proceed with metadata cleanup
        }
      }

      target.generatedImages = (target.generatedImages || []).filter((f) => f !== filename);
      target.enhancedImages = (target.enhancedImages || []).filter((f) => f !== filename);
      return target;
    });

    res.json(shot);
  } catch (err) {
    if (isErrorWithMessage(err, 'Shot not found')) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }
    if (isErrorWithMessage(err, 'Forbidden')) {
      sendApiError(res, 403, 'Forbidden');
      return;
    }

    console.error('Failed to delete image:', err);
    sendApiError(res, 500, 'Failed to delete image');
  }
});

// DELETE /api/projects/:id/shots/:shotId/video — delete the shot video
router.delete('/:shotId/video', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId } = req.params;
    const shot = await withProject(project.id, async (current) => {
      const target = current.shots.find((s) => s.id === shotId);
      if (!target) {
        throw new Error('Shot not found');
      }

      if (target.videoFile && !isExternalMediaRef(target.videoFile)) {
        let filePath: string;
        try {
          filePath = resolveProjectPath(current.id, 'shots', shotId, 'video', target.videoFile);
        } catch {
          throw new Error('Forbidden');
        }

        try {
          await fs.unlink(filePath);
        } catch {
          // File may already be gone
        }
      }

      target.videoFile = null;
      return target;
    });

    res.json(shot);
  } catch (err) {
    if (isErrorWithMessage(err, 'Shot not found')) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }
    if (isErrorWithMessage(err, 'Forbidden')) {
      sendApiError(res, 403, 'Forbidden');
      return;
    }

    console.error('Failed to delete video:', err);
    sendApiError(res, 500, 'Failed to delete video');
  }
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const errorWithCode = err as { code?: string };
  if (errorWithCode?.code === 'PROJECT_NOT_FOUND') {
    sendApiError(res, 404, 'Project not found');
    return;
  }
  if (errorWithCode?.code === 'SHOT_NOT_FOUND') {
    sendApiError(res, 404, 'Shot not found');
    return;
  }
  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    sendApiError(res, 413, 'Uploaded file is too large');
    return;
  }

  // Not an upload-specific error - delegate to the global error handler.
  next(err);
});

export default router;
