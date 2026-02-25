import { Router, Request, Response } from 'express';
import {
  listProjects,
  getProject,
  createProject,
  saveProject,
  deleteProject,
  type BriefAsset,
} from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router();

function mergeAssetLabelsOnly(existingAssets: BriefAsset[], incomingAssets: unknown): BriefAsset[] {
  if (!Array.isArray(incomingAssets)) {
    return existingAssets;
  }

  const byId = new Map<string, any>();
  for (const item of incomingAssets) {
    if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
      byId.set((item as any).id, item);
    }
  }

  return existingAssets.map((asset) => {
    const incoming = byId.get(asset.id);
    if (!incoming) {
      return asset;
    }
    return {
      ...asset,
      label: typeof incoming.label === 'string' ? incoming.label : asset.label,
    };
  });
}

// GET /api/projects — list all projects
router.get('/', async (_req: Request, res: Response) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (err) {
    console.error('Failed to list projects:', err);
    sendApiError(res, 500, 'Failed to list projects', 'PROJECTS_LIST_FAILED');
  }
});

// POST /api/projects — create a new project
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      sendApiError(res, 400, 'name is required', 'PROJECT_NAME_REQUIRED');
      return;
    }
    const project = await createProject(name.trim());
    res.status(201).json(project);
  } catch (err) {
    console.error('Failed to create project:', err);
    sendApiError(res, 500, 'Failed to create project', 'PROJECT_CREATE_FAILED');
  }
});

// GET /api/projects/:id — get a single project
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      return;
    }
    res.json(project);
  } catch (err) {
    console.error('Failed to get project:', err);
    sendApiError(res, 500, 'Failed to get project', 'PROJECT_GET_FAILED');
  }
});

// PUT /api/projects/:id — update a project (merge body into existing, preserve id/created)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await getProject(req.params.id);
    if (!existing) {
      sendApiError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      return;
    }

    // Merge request body into existing project, preserving id and created
    const updates = req.body;
    const merged = {
      ...existing,
      ...updates,
      id: existing.id,
      created: existing.created,
    };

    // Deep-merge settings if provided
    if (updates.settings && typeof updates.settings === 'object') {
      merged.settings = {
        ...existing.settings,
        ...updates.settings,
      };
    }

    // Deep-merge brief fields while keeping existing asset file metadata immutable.
    if (updates.brief && typeof updates.brief === 'object') {
      merged.brief = {
        ...existing.brief,
        ...updates.brief,
        assets: mergeAssetLabelsOnly(existing.brief.assets || [], (updates.brief as any).assets),
      };
    }

    const saved = await saveProject(merged);
    res.json(saved);
  } catch (err) {
    console.error('Failed to update project:', err);
    sendApiError(res, 500, 'Failed to update project', 'PROJECT_UPDATE_FAILED');
  }
});

// DELETE /api/projects/:id — delete a project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const exists = await getProject(req.params.id);
    if (!exists) {
      sendApiError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      return;
    }
    await deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete project:', err);
    sendApiError(res, 500, 'Failed to delete project', 'PROJECT_DELETE_FAILED');
  }
});

export default router;
