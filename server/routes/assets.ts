import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { getProject, saveProject, getProjectDir, ensureDir, type BriefAsset } from '../lib/storage.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getGlobalSettings } from './settings.js';

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
      label: '',
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

// PUT /api/projects/:id/assets/:assetId/label — update asset label
router.put('/:assetId/label', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const asset = project.brief.assets.find((a) => a.id === req.params.assetId);
    if (!asset) { res.status(404).json({ error: 'Asset not found' }); return; }

    asset.label = req.body.label || '';
    await saveProject(project);
    res.json(asset);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/assets/:assetId/describe — auto-describe one asset with vision model
router.post('/:assetId/describe', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const asset = project.brief.assets.find((a) => a.id === req.params.assetId);
    if (!asset) { res.status(404).json({ error: 'Asset not found' }); return; }

    const global = await getGlobalSettings();
    const model = (global as any).defaultTextModel || 'openai/gpt-4o';

    // Load image from disk
    const filePath = path.join(getProjectDir(project.id), 'brief', 'images', asset.filename);
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(asset.filename).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const base64 = buffer.toString('base64');

    const label = await chatCompletion(model, [
      {
        role: 'system',
        content: 'Ты описываешь изображения для видео-продакшн пайплайна. Описание должно быть коротким (1-2 предложения на русском): что изображено, ракурс камеры, время суток, настроение. Не используй markdown.',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: `Опиши кратко что на этом изображении (файл: ${asset.filename})` },
        ],
      },
    ], 0.3);

    asset.label = label.trim();
    await saveProject(project);

    res.json({ id: asset.id, label: asset.label });
  } catch (err) {
    console.error('Failed to describe asset:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/assets/describe-all — auto-describe all assets without labels
router.post('/describe-all', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const global = await getGlobalSettings();
    const model = (global as any).defaultTextModel || 'openai/gpt-4o';
    const toDescribe = project.brief.assets.filter((a) => !a.label?.trim());

    if (toDescribe.length === 0) {
      res.json({ described: 0 });
      return;
    }

    console.log(`[describe-all] Describing ${toDescribe.length} assets with ${model}`);

    let described = 0;
    for (const asset of toDescribe) {
      try {
        const filePath = path.join(getProjectDir(project.id), 'brief', 'images', asset.filename);
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(asset.filename).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const base64 = buffer.toString('base64');

        const label = await chatCompletion(model, [
          {
            role: 'system',
            content: 'Ты описываешь изображения для видео-продакшн пайплайна. Описание должно быть коротким (1-2 предложения на русском): что изображено, ракурс камеры, время суток, настроение. Не используй markdown.',
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: `Опиши кратко что на этом изображении (файл: ${asset.filename})` },
            ],
          },
        ], 0.3);

        asset.label = label.trim();
        described++;
        console.log(`[describe-all] ${described}/${toDescribe.length}: ${asset.filename} -> ${asset.label.slice(0, 60)}...`);

        // Save after each to preserve progress
        await saveProject(project);
      } catch (err) {
        console.error(`[describe-all] Failed for ${asset.filename}:`, err);
      }
    }

    res.json({ described, total: toDescribe.length });
  } catch (err) {
    console.error('Failed to describe assets:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
