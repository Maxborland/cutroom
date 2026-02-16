import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject, saveProject, getProjectDir, ensureDir } from '../lib/storage.js';

const router = Router({ mergeParams: true });

// Configure multer for video upload (500MB limit)
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const r = req as Request;
      const projectId = r.params.id;
      const shotId = r.params.shotId;
      const dir = path.join(getProjectDir(projectId), 'shots', shotId, 'video');
      await ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
});

// PUT /api/projects/:id/shots/:shotId — update shot fields
router.put('/:shotId', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shotIndex = project.shots.findIndex((s) => s.id === shotId);
    if (shotIndex === -1) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    const existing = project.shots[shotIndex];
    const updates = req.body;

    // Merge updates, preserving id and order
    project.shots[shotIndex] = {
      ...existing,
      ...updates,
      id: existing.id,
      order: existing.order,
    };

    await saveProject(project);
    res.json(project.shots[shotIndex]);
  } catch (err) {
    console.error('Failed to update shot:', err);
    res.status(500).json({ error: 'Failed to update shot' });
  }
});

// PUT /api/projects/:id/shots/:shotId/status — change shot status
router.put('/:shotId/status', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    shot.status = status;
    await saveProject(project);
    res.json(shot);
  } catch (err) {
    console.error('Failed to update shot status:', err);
    res.status(500).json({ error: 'Failed to update shot status' });
  }
});

// POST /api/projects/:id/shots/:shotId/video — upload video
router.post('/:shotId/video', videoUpload.single('video'), async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No video file uploaded' });
      return;
    }

    shot.videoFile = file.originalname;
    await saveProject(project);

    res.json({
      filename: file.originalname,
      url: `/api/projects/${project.id}/shots/${shotId}/video/${encodeURIComponent(file.originalname)}`,
    });
  } catch (err) {
    console.error('Failed to upload video:', err);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// GET /api/projects/:id/shots/:shotId/video/:filename — serve video file
router.get('/:shotId/video/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { shotId, filename } = req.params;
    const filePath = path.resolve(
      getProjectDir(project.id),
      'shots',
      shotId,
      'video',
      filename
    );

    // Security check
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
    console.error('Failed to serve video:', err);
    res.status(500).json({ error: 'Failed to serve video' });
  }
});

export default router;
