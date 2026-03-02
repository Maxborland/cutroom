import { Router, Request, Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { buildOpenReelBundle } from '../lib/openreel-exporter.js';
import { getProject } from '../lib/storage.js';

const router = Router({ mergeParams: true });

// GET /api/projects/:id/openreel-project
router.get('/openreel-project', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const bundle = await buildOpenReelBundle(project, `/api/projects/${project.id}`);
    res.json(bundle);
  } catch (err) {
    console.error('Failed to build OpenReel project bundle:', err);
    sendApiError(res, 500, 'Failed to build OpenReel project bundle');
  }
});

export default router;
