import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import { randomUUID } from 'crypto';
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
  validateProjectId,
  type BriefAsset,
} from '../lib/storage.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getGlobalSettings } from '../lib/config.js';
import { DEFAULT_DESCRIBE_PROMPT } from './generate/shared.js';
import { sanitizeUploadedFilename, resolvePathWithin } from '../lib/file-utils.js';
import { prepareBriefReference } from '../lib/reference-media.js';
import { getErrorMessage, sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });

type VisionMessagePart = { type: string; text?: string; image_url?: { url: string } };

function getProjectImagesDir(projectId: string): string {
  return resolveProjectPath(projectId, 'brief', 'images');
}

function resolveAssetFilePath(projectId: string, filename: string): string {
  return resolvePathWithin(getProjectImagesDir(projectId), filename);
}

function buildDescribeUserContent(
  prepared: Awaited<ReturnType<typeof prepareBriefReference>>,
  filename: string,
): VisionMessagePart[] {
  const content: VisionMessagePart[] = [];

  if (prepared.imageDataUrl) {
    content.push({ type: 'image_url', image_url: { url: prepared.imageDataUrl } });
  }

  if (prepared.svgText) {
    content.push({
      type: 'text',
      text: `SVG-вектор для ${filename}:\n${prepared.svgText}`,
    });
  }

  content.push({
    type: 'text',
    text: `Опиши кратко объект на этом изображении (файл: ${filename})`,
  });

  return content;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const projectId = validateProjectId((req as Request).params.id);
        const dir = getProjectImagesDir(projectId);
        await ensureDir(dir);
        cb(null, dir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      cb(null, sanitizeUploadedFilename(file.originalname));
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype));
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per image
  },
});

// POST /api/projects/:id/assets - upload files
router.post('/', upload.array('files', 50), async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      sendApiError(res, 400, 'No files uploaded');
      return;
    }

    const newAssets: BriefAsset[] = files.map((file) => ({
      id: randomUUID(),
      filename: file.filename,
      label: '',
      url: `/api/projects/${project.id}/assets/file/${encodeURIComponent(file.filename)}`,
      uploadedAt: new Date().toISOString(),
    }));

    project.brief.assets = [...(project.brief.assets || []), ...newAssets];
    await saveProject(project);

    res.status(201).json(newAssets);
  } catch (err) {
    console.error('Failed to upload assets:', err);
    sendApiError(res, 500, 'Failed to upload assets');
  }
});

// GET /api/projects/:id/assets/file/:filename - serve a file
router.get('/file/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const requestedFilename = req.params.filename;
    const asset = project.brief.assets.find((a) => a.filename === requestedFilename);
    if (!asset) {
      sendApiError(res, 404, 'File not found');
      return;
    }

    const filePath = resolveAssetFilePath(project.id, asset.filename);

    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'File not found');
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve asset:', err);
    sendApiError(res, 500, 'Failed to serve asset');
  }
});

// DELETE /api/projects/:id/assets/:assetId - remove asset
router.delete('/:assetId', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const assetId = req.params.assetId;
    const asset = project.brief.assets.find((a) => a.id === assetId);
    if (!asset) {
      sendApiError(res, 404, 'Asset not found');
      return;
    }

    const filePath = resolveAssetFilePath(project.id, asset.filename);
    try {
      await fs.unlink(filePath);
    } catch {
      // File might already be gone.
    }

    project.brief.assets = project.brief.assets.filter((a) => a.id !== assetId);
    await saveProject(project);

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete asset:', err);
    sendApiError(res, 500, 'Failed to delete asset');
  }
});

// PUT /api/projects/:id/assets/:assetId/label - update asset label
router.put('/:assetId/label', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const asset = project.brief.assets.find((a) => a.id === req.params.assetId);
    if (!asset) {
      sendApiError(res, 404, 'Asset not found');
      return;
    }

    asset.label = req.body.label || '';
    await saveProject(project);
    res.json(asset);
  } catch (err) {
    sendApiError(res, 500, getErrorMessage(err, 'Failed to update asset label'));
  }
});

// POST /api/projects/:id/assets/:assetId/describe - auto-describe one asset with vision model
router.post('/:assetId/describe', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const asset = project.brief.assets.find((a) => a.id === req.params.assetId);
    if (!asset) {
      sendApiError(res, 404, 'Asset not found');
      return;
    }

    const global = await getGlobalSettings();
    const model = global.defaultDescribeModel || global.defaultTextModel || 'openai/gpt-4o';
    const describePrompt = global.masterPromptDescribe || DEFAULT_DESCRIBE_PROMPT;
    const prepared = await prepareBriefReference(project.id, asset.filename, {
      maxReferenceBytes: 1_500_000,
      includeSvgDataUrl: false,
      includeSvgText: true,
      maxSvgTextChars: 2_000,
    });

    if (!prepared.imageDataUrl && !prepared.svgText) {
      const reason = prepared.skipReason === 'too_large'
        ? 'Asset is too large for vision preflight'
        : 'Asset is not readable for vision preflight';
      sendApiError(res, 422, reason);
      return;
    }

    const label = await chatCompletion(model, [
      { role: 'system', content: describePrompt },
      { role: 'user', content: buildDescribeUserContent(prepared, asset.filename) },
    ], 0.3);

    asset.label = label.trim();
    await saveProject(project);

    res.json({ id: asset.id, label: asset.label });
  } catch (err) {
    console.error('Failed to describe asset:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to describe asset'));
  }
});

// POST /api/projects/:id/assets/describe-all - auto-describe all assets without labels
router.post('/describe-all', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const global = await getGlobalSettings();
    const model = global.defaultDescribeModel || global.defaultTextModel || 'openai/gpt-4o';
    const describePrompt = global.masterPromptDescribe || DEFAULT_DESCRIBE_PROMPT;
    const toDescribe = project.brief.assets.filter((a) => !a.label?.trim());

    if (toDescribe.length === 0) {
      res.json({ described: 0 });
      return;
    }

    console.log(`[describe-all] Describing ${toDescribe.length} assets with ${model} (vision)`);

    let described = 0;
    let hasUpdates = false;
    for (const asset of toDescribe) {
      try {
        const prepared = await prepareBriefReference(project.id, asset.filename, {
          maxReferenceBytes: 1_500_000,
          includeSvgDataUrl: false,
          includeSvgText: true,
          maxSvgTextChars: 2_000,
        });

        if (!prepared.imageDataUrl && !prepared.svgText) {
          console.warn(`[describe-all] Skipping ${asset.filename}: ${prepared.skipReason || 'unsupported'}`);
          continue;
        }

        const label = await chatCompletion(model, [
          { role: 'system', content: describePrompt },
          { role: 'user', content: buildDescribeUserContent(prepared, asset.filename) },
        ], 0.3);

        asset.label = label.trim();
        described++;
        hasUpdates = true;
        console.log(`[describe-all] ${described}/${toDescribe.length}: ${asset.filename} -> ${asset.label.slice(0, 60)}...`);
      } catch (err) {
        console.error(`[describe-all] Failed for ${asset.filename}:`, err);
      }
    }

    if (hasUpdates) {
      await saveProject(project);
    }

    res.json({ described, total: toDescribe.length });
  } catch (err) {
    console.error('Failed to describe assets:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to describe assets'));
  }
});

export default router;
