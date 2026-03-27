import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { sendApiError } from '../lib/api-error.js';
import { buildOpenReelBundle } from '../lib/openreel-exporter.js';
import { readLimiter, mutationLimiter } from '../lib/rate-limit.js';
import type { RenderJob } from '../lib/storage.js';
import { ensureDir, getProject, resolveProjectPath, withProject } from '../lib/storage.js';

const router = Router({ mergeParams: true });
const DEFAULT_OPENREEL_EXPORT_MAX_BYTES = 512 * 1024 * 1024;
const OPENREEL_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'cut-room-openreel-exports');

mkdirSync(OPENREEL_EXPORT_TMP_DIR, { recursive: true });

const exportUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, OPENREEL_EXPORT_TMP_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${sanitizeExportFilename(file.originalname || 'openreel-export.mp4')}`);
  },
});

function replaceControlCharacters(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f ? '_' : char;
  }).join('');
}

function sanitizeExportFilename(filename: string): string {
  const normalized = path.basename(filename.trim());
  const cleaned = replaceControlCharacters(normalized)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'openreel-export.mp4';
}

function getOpenReelExportMaxBytes(): number {
  const raw = Number(process.env.OPENREEL_EXPORT_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_OPENREEL_EXPORT_MAX_BYTES;
}

function getOpenReelRenderResolution(project: Awaited<ReturnType<typeof getProject>>): string {
  const width = project?.montagePlan?.format?.width;
  const height = project?.montagePlan?.format?.height;
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return `${width}x${height}`;
  }
  return '3840x2160';
}

async function copyUploadedArtifact(sourcePath: string, targetPath: string): Promise<void> {
  await fs.copyFile(sourcePath, targetPath);
}

async function cleanupUploadedArtifact(file: Express.Multer.File | null): Promise<void> {
  if (!file?.path) return;
  await fs.unlink(file.path).catch(() => {});
}

async function parseFinalizeExportUpload(req: Request, res: Response): Promise<Express.Multer.File> {
  const upload = multer({
    storage: exportUploadStorage,
    limits: {
      fileSize: getOpenReelExportMaxBytes(),
    },
  }).single('artifact');

  return await new Promise<Express.Multer.File>((resolve, reject) => {
    upload(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }

      if (!req.file) {
        reject(new Error('artifact is required'));
        return;
      }

      resolve(req.file);
    });
  });
}

// GET /api/projects/:id/openreel-project
// Returns saved snapshot if it exists, otherwise builds fresh from CutRoom project
router.get('/openreel-project', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    // Try to return saved snapshot first (user's edits in OpenReel)
    const snapshotPath = resolveProjectPath(project.id, 'openreel', 'project.json');
    try {
      const snapshotRaw = await fs.readFile(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(snapshotRaw);
      if (snapshot?.version === '1.0.0' && snapshot?.project) {
        // Rebuild media manifest from current CutRoom state (URLs may change)
        const freshBundle = await buildOpenReelBundle(project, `/api/projects/${project.id}`);
        res.json({
          ...snapshot,
          mediaManifest: freshBundle.mediaManifest,
        });
        return;
      }
    } catch {
      // No snapshot or invalid — fall through to build fresh
    }

    const bundle = await buildOpenReelBundle(project, `/api/projects/${project.id}`);
    res.json(bundle);
  } catch (err) {
    console.error('Failed to build OpenReel project bundle:', err);
    sendApiError(res, 500, 'Failed to build OpenReel project bundle');
  }
});

// PUT /api/projects/:id/openreel-project
router.put('/openreel-project', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const project = await getProject(projectId);

    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const body = req.body as {
      version?: unknown;
      project?: unknown;
    } | undefined;
    if (!body || typeof body !== 'object') {
      sendApiError(res, 400, 'Invalid request body');
      return;
    }

    if (body.version !== '1.0.0') {
      sendApiError(res, 400, 'Unsupported OpenReel project version');
      return;
    }

    if (body.project == null) {
      sendApiError(res, 400, 'project is required');
      return;
    }

    if ('exportArtifact' in body) {
      sendApiError(res, 400, 'exportArtifact is only supported during final export');
      return;
    }

    // Sanity check: reject unreasonably large project payloads (>10MB serialized)
    const serialized = JSON.stringify(body.project);
    if (serialized.length > 10 * 1024 * 1024) {
      sendApiError(res, 413, 'Project payload too large');
      return;
    }

    const modifiedAt = Date.now();
    const payload = {
      version: '1.0.0',
      project: body.project,
      modifiedAt,
    };

    const openreelDir = resolveProjectPath(projectId, 'openreel');
    const openreelProjectPath = resolveProjectPath(projectId, 'openreel', 'project.json');
    await ensureDir(openreelDir);
    await fs.writeFile(openreelProjectPath, JSON.stringify(payload, null, 2), 'utf-8');

    res.json({
      saved: true,
      modifiedAt,
    });
  } catch (err) {
    console.error('Failed to save OpenReel project snapshot:', err);
    sendApiError(res, 500, 'Failed to save OpenReel project snapshot');
  }
});

// POST /api/projects/:id/openreel-project/finalize-export
router.post('/openreel-project/finalize-export', mutationLimiter, async (req: Request, res: Response) => {
  let uploadedArtifact: Express.Multer.File | null = null;

  try {
    const projectId = req.params.id;
    const project = await getProject(projectId);

    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    uploadedArtifact = await parseFinalizeExportUpload(req, res);

    const body = req.body as {
      version?: unknown;
      project?: unknown;
      filename?: unknown;
    } | undefined;

    if (!body || typeof body !== 'object') {
      sendApiError(res, 400, 'Invalid request body');
      return;
    }

    if (body.version !== '1.0.0') {
      sendApiError(res, 400, 'Unsupported OpenReel project version');
      return;
    }

    if (typeof body.project !== 'string' || !body.project.trim()) {
      sendApiError(res, 400, 'project is required');
      return;
    }

    if (typeof body.filename !== 'string' || !body.filename.trim()) {
      sendApiError(res, 400, 'filename is required');
      return;
    }

    const safeFilename = sanitizeExportFilename(body.filename);
    const serialized = body.project.trim();
    if (serialized.length > 10 * 1024 * 1024) {
      sendApiError(res, 413, 'Project payload too large');
      return;
    }

    let parsedProject: unknown;
    try {
      parsedProject = JSON.parse(serialized);
    } catch {
      sendApiError(res, 400, 'project must be valid JSON');
      return;
    }

    const exportedAt = Date.now();
    const exportRelativePath = `openreel/exports/${exportedAt}-${safeFilename}`;
    const openreelDir = resolveProjectPath(projectId, 'openreel');
    const exportDir = resolveProjectPath(projectId, 'openreel', 'exports');
    const openreelProjectPath = resolveProjectPath(projectId, 'openreel', 'project.json');
    const exportPath = resolveProjectPath(projectId, exportRelativePath);

    await ensureDir(openreelDir);
    await ensureDir(exportDir);
    await copyUploadedArtifact(uploadedArtifact.path, exportPath);

    const snapshotPayload = {
      version: '1.0.0',
      project: parsedProject,
      modifiedAt: exportedAt,
      exportArtifact: {
        filename: safeFilename,
        exportedAt,
      },
    };

    await fs.writeFile(openreelProjectPath, JSON.stringify(snapshotPayload, null, 2), 'utf-8');

    await withProject(projectId, (current) => {
      const createdAt = new Date(exportedAt).toISOString();
      const renderRecord: RenderJob = {
        id: `openreel-${randomUUID()}`,
        createdAt,
        quality: 'final',
        resolution: getOpenReelRenderResolution(current),
        status: 'done',
        progress: 100,
        outputFile: exportRelativePath,
      };

      current.stage = 'rendered';
      current.latestExportArtifact = {
        filename: safeFilename,
        exportedAt: createdAt,
      };
      current.renders = [...(current.renders ?? []), renderRecord];
    });

    await cleanupUploadedArtifact(uploadedArtifact);
    uploadedArtifact = null;

    res.json({
      saved: true,
      modifiedAt: exportedAt,
      exportArtifact: {
        filename: safeFilename,
        exportedAt,
      },
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      sendApiError(res, 413, 'Файл экспорта слишком большой');
      return;
    }

    if (err instanceof Error && err.message === 'artifact is required') {
      sendApiError(res, 400, 'artifact is required');
      return;
    }

    console.error('Failed to initialize OpenReel export finalization:', err);
    sendApiError(res, 500, 'Failed to finalize OpenReel export');
  } finally {
    await cleanupUploadedArtifact(uploadedArtifact);
  }
});

export default router;
