import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { getProject, saveProject, getProjectDir, ensureDir, type BriefAsset } from '../lib/storage.js';

const router = Router({ mergeParams: true });

// Configure multer to save to a temp location; we'll move files to project dir
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const projectId = (req as Request).params.id;
      const dir = path.join(getProjectDir(projectId), 'brief', 'images');
      await ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Keep original filename
      cb(null, file.originalname);
    },
  }),
});

// POST /api/projects/:id/assets — upload files
router.post('/', upload.array('files', 50), async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const newAssets: BriefAsset[] = files.map((file) => ({
      id: randomUUID(),
      filename: file.originalname,
      url: `/api/projects/${project.id}/assets/file/${encodeURIComponent(file.originalname)}`,
      uploadedAt: new Date().toISOString(),
    }));

    project.brief.assets = [...(project.brief.assets || []), ...newAssets];
    await saveProject(project);

    res.status(201).json(newAssets);
  } catch (err) {
    console.error('Failed to upload assets:', err);
    res.status(500).json({ error: 'Failed to upload assets' });
  }
});

// GET /api/projects/:id/assets/file/:filename — serve a file
router.get('/file/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const filename = req.params.filename;
    const filePath = path.resolve(getProjectDir(project.id), 'brief', 'images', filename);

    // Security: make sure the resolved path is within the project dir
    const projectDir = path.resolve(getProjectDir(project.id));
    if (!filePath.startsWith(projectDir)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve asset:', err);
    res.status(500).json({ error: 'Failed to serve asset' });
  }
});

// DELETE /api/projects/:id/assets/:assetId — remove asset
router.delete('/:assetId', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const assetId = req.params.assetId;
    const asset = project.brief.assets.find((a) => a.id === assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    // Remove file from disk
    const filePath = path.resolve(getProjectDir(project.id), 'brief', 'images', asset.filename);
    try {
      await fs.unlink(filePath);
    } catch {
      // File might already be gone, that's OK
    }

    // Remove from project
    project.brief.assets = project.brief.assets.filter((a) => a.id !== assetId);
    await saveProject(project);

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete asset:', err);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

export default router;
