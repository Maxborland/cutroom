import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
  validateProjectId,
  VALID_SHOT_STATUSES,
  type ShotMeta,
} from '../lib/storage.js';
import { sanitizeUploadedFilename } from '../lib/file-utils.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

/**
 * Delete all generated images, enhanced images, and video for a shot.
 * Resets the shot metadata arrays. Does NOT save the project.
 */
async function cleanupShotFiles(projectId: string, shotId: string, shot: ShotMeta): Promise<void> {
  const generatedDir = resolveProjectPath(projectId, 'shots', shotId, 'generated');
  const videoDir = resolveProjectPath(projectId, 'shots', shotId, 'video');

  for (const filename of [...(shot.generatedImages || []), ...(shot.enhancedImages || [])]) {
    if (isExternalMediaRef(filename)) continue;
    try {
      await fs.unlink(path.join(generatedDir, filename));
    } catch {
      // file may already be gone
    }
  }

  if (shot.videoFile) {
    if (!isExternalMediaRef(shot.videoFile)) {
      try {
        await fs.unlink(path.join(videoDir, shot.videoFile));
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
          const errNotFound: any = new Error('Project not found');
          errNotFound.code = 'PROJECT_NOT_FOUND';
          cb(errNotFound, '');
          return;
        }
        const shot = project.shots.find((s) => s.id === shotId);
        if (!shot) {
          const errNotFound: any = new Error('Shot not found');
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
    for (const shotId of shotIds) {
      const shot = project.shots.find((s) => s.id === shotId);
      if (shot) {
        if (status === 'draft') {
          await cleanupShotFiles(project.id, shotId, shot);
        }
        shot.status = status;
        updated++;
      }
    }

    await saveProject(project);
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
    const shotIndex = project.shots.findIndex((s) => s.id === shotId);
    if (shotIndex === -1) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    const existing = project.shots[shotIndex];
    const updates = req.body;

    // Allowlist of client-mutable fields. Server-managed fields (id, order,
    // status, videoFile, generatedImages, enhancedImages) must not be overwritten
    // by the client to prevent mass-assignment / SSRF via mutable videoFile.
    const MUTABLE_SHOT_FIELDS = [
      'scene',
      'audioDescription',
      'imagePrompt',
      'videoPrompt',
      'duration',
      'assetRefs',
      'selectedImage',
    ] as const;

    type MutableField = typeof MUTABLE_SHOT_FIELDS[number];

    const safeUpdates: Partial<Pick<typeof existing, MutableField>> = {};
    for (const key of MUTABLE_SHOT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        (safeUpdates as any)[key] = (updates as any)[key];
      }
    }

    project.shots[shotIndex] = {
      ...existing,
      ...safeUpdates,
      id: existing.id,
      order: existing.order,
    };

    await saveProject(project);
    res.json(project.shots[shotIndex]);
  } catch (err) {
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
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      sendApiError(res, 400, 'status is required');
      return;
    }
    if (!(VALID_SHOT_STATUSES as readonly string[]).includes(status)) {
      sendApiError(res, 400, `Invalid status. Allowed: ${VALID_SHOT_STATUSES.join(', ')}`);
      return;
    }

    if (status === 'draft') {
      await cleanupShotFiles(project.id, shotId, shot);
    }

    shot.status = status;
    await saveProject(project);
    res.json(shot);
  } catch (err) {
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

    shot.videoFile = file.filename;
    await saveProject(project);

    res.json({
      filename: file.filename,
      url: `/api/projects/${project.id}/shots/${shotId}/video/${encodeURIComponent(file.filename)}`,
    });
  } catch (err) {
    console.error('Failed to upload video:', err);
    sendApiError(res, 500, 'Failed to upload video');
  }
});

// GET /api/projects/:id/shots/:shotId/video/:filename — serve video file
router.get('/:shotId/video/:filename', async (req: Request, res: Response) => {
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
router.delete('/:shotId/image/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId, filename } = req.params;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    if (!isExternalMediaRef(filename)) {
      // Delete file from disk
      let filePath: string;
      try {
        filePath = resolveProjectPath(project.id, 'shots', shotId, 'generated', filename);
      } catch {
        sendApiError(res, 403, 'Forbidden');
        return;
      }

      try {
        await fs.unlink(filePath);
      } catch {
        // File may already be gone — proceed with metadata cleanup
      }
    }

    // Remove from arrays
    shot.generatedImages = (shot.generatedImages || []).filter((f) => f !== filename);
    shot.enhancedImages = (shot.enhancedImages || []).filter((f) => f !== filename);
    await saveProject(project);

    res.json(shot);
  } catch (err) {
    console.error('Failed to delete image:', err);
    sendApiError(res, 500, 'Failed to delete image');
  }
});

// DELETE /api/projects/:id/shots/:shotId/video — delete the shot video
router.delete('/:shotId/video', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId } = req.params;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    if (shot.videoFile) {
      if (!isExternalMediaRef(shot.videoFile)) {
        let filePath: string;
        try {
          filePath = resolveProjectPath(project.id, 'shots', shotId, 'video', shot.videoFile);
        } catch {
          sendApiError(res, 403, 'Forbidden');
          return;
        }

        try {
          await fs.unlink(filePath);
        } catch {
          // File may already be gone
        }
      }

      shot.videoFile = null;
      await saveProject(project);
    }

    res.json(shot);
  } catch (err) {
    console.error('Failed to delete video:', err);
    sendApiError(res, 500, 'Failed to delete video');
  }
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const anyErr = err as any;
  if (anyErr?.code === 'PROJECT_NOT_FOUND') {
    sendApiError(res, 404, 'Project not found');
    return;
  }
  if (anyErr?.code === 'SHOT_NOT_FOUND') {
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
