import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { sendApiError } from '../lib/api-error.js';
import { buildOpenReelBundle } from '../lib/openreel-exporter.js';
import { readLimiter, mutationLimiter } from '../lib/rate-limit.js';
import { ensureDir, getProject, resolveProjectPath, withProject } from '../lib/storage.js';

const router = Router({ mergeParams: true });
const exportUpload = multer({ storage: multer.memoryStorage() });

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
  try {
    const projectId = req.params.id;
    const project = await getProject(projectId);

    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    exportUpload.single('artifact')(req, res, async (multerErr) => {
      try {
        if (multerErr) {
          sendApiError(res, 400, multerErr.message);
          return;
        }

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

        if (!req.file) {
          sendApiError(res, 400, 'artifact is required');
          return;
        }

        const safeFilename = sanitizeExportFilename(body.filename);
        const serialized = body.project.trim();
        if (serialized.length > 10 * 1024 * 1024) {
          sendApiError(res, 413, 'Project payload too large');
          return;
        }

        const parsedProject = JSON.parse(serialized);
        const exportedAt = Date.now();
        const openreelDir = resolveProjectPath(projectId, 'openreel');
        const exportDir = resolveProjectPath(projectId, 'openreel', 'exports');
        const openreelProjectPath = resolveProjectPath(projectId, 'openreel', 'project.json');
        const exportPath = resolveProjectPath(projectId, 'openreel', 'exports', `${exportedAt}-${safeFilename}`);

        await ensureDir(openreelDir);
        await ensureDir(exportDir);
        await fs.writeFile(exportPath, req.file.buffer);

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
          current.stage = 'rendered';
          current.latestExportArtifact = {
            filename: safeFilename,
            exportedAt: new Date(exportedAt).toISOString(),
          };
        });

        res.json({
          saved: true,
          modifiedAt: exportedAt,
          exportArtifact: {
            filename: safeFilename,
            exportedAt,
          },
        });
      } catch (err) {
        console.error('Failed to finalize OpenReel export:', err);
        sendApiError(res, 500, 'Failed to finalize OpenReel export');
      }
    });
  } catch (err) {
    console.error('Failed to initialize OpenReel export finalization:', err);
    sendApiError(res, 500, 'Failed to initialize OpenReel export finalization');
  }
});

export default router;
