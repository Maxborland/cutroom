import { Router, Request, Response } from 'express';
import { getProject } from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });

// Helper: load project or 404
async function loadProject(req: Request, res: Response) {
  const project = await getProject(req.params.id);
  if (!project) {
    sendApiError(res, 404, 'Project not found');
    return null;
  }
  return project;
}

// POST /api/projects/:id/montage/generate-vo-script
router.post('/montage/generate-vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to generate voiceover script:', err);
    sendApiError(res, 500, 'Failed to generate voiceover script');
  }
});

// PUT /api/projects/:id/montage/vo-script
router.put('/montage/vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to update voiceover script:', err);
    sendApiError(res, 500, 'Failed to update voiceover script');
  }
});

// POST /api/projects/:id/montage/approve-vo-script
router.post('/montage/approve-vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to approve voiceover script:', err);
    sendApiError(res, 500, 'Failed to approve voiceover script');
  }
});

// POST /api/projects/:id/montage/generate-voiceover
router.post('/montage/generate-voiceover', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to generate voiceover:', err);
    sendApiError(res, 500, 'Failed to generate voiceover');
  }
});

// POST /api/projects/:id/montage/generate-music
router.post('/montage/generate-music', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to generate music:', err);
    sendApiError(res, 500, 'Failed to generate music');
  }
});

// POST /api/projects/:id/montage/generate-plan
router.post('/montage/generate-plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to generate montage plan:', err);
    sendApiError(res, 500, 'Failed to generate montage plan');
  }
});

// PUT /api/projects/:id/montage/plan
router.put('/montage/plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to update montage plan:', err);
    sendApiError(res, 500, 'Failed to update montage plan');
  }
});

// POST /api/projects/:id/montage/refine-plan
router.post('/montage/refine-plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to refine montage plan:', err);
    sendApiError(res, 500, 'Failed to refine montage plan');
  }
});

// POST /api/projects/:id/montage/render
router.post('/montage/render', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to start render:', err);
    sendApiError(res, 500, 'Failed to start render');
  }
});

// GET /api/projects/:id/montage/render/:jobId
router.get('/montage/render/:jobId', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to get render status:', err);
    sendApiError(res, 500, 'Failed to get render status');
  }
});

// GET /api/projects/:id/montage/render/:jobId/download
router.get('/montage/render/:jobId/download', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to download render:', err);
    sendApiError(res, 500, 'Failed to download render');
  }
});

export default router;
