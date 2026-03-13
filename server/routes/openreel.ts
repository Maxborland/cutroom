import fs from 'node:fs/promises';
import { Router, Request, Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { buildOpenReelBundle } from '../lib/openreel-exporter.js';
import { readLimiter, mutationLimiter } from '../lib/rate-limit.js';
import { ensureDir, getProject, resolveProjectPath } from '../lib/storage.js';

const router = Router({ mergeParams: true });

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

    const body = req.body as { version?: unknown; project?: unknown } | undefined;
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

    res.json({ saved: true, modifiedAt });
  } catch (err) {
    console.error('Failed to save OpenReel project snapshot:', err);
    sendApiError(res, 500, 'Failed to save OpenReel project snapshot');
  }
});

export default router;
