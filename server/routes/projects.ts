import { Router, Request, Response } from 'express';
import {
  listProjects,
  getProject,
  createProject,
  saveProject,
  deleteProject,
} from '../lib/storage.js';

const router = Router();

// GET /api/projects — list all projects
router.get('/', async (_req: Request, res: Response) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (err) {
    console.error('Failed to list projects:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// POST /api/projects — create a new project
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const project = await createProject(name.trim());
    res.status(201).json(project);
  } catch (err) {
    console.error('Failed to create project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:id — get a single project
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err) {
    console.error('Failed to get project:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// PUT /api/projects/:id — update a project (merge body into existing, preserve id/created)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
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

    const saved = await saveProject(merged);
    res.json(saved);
  } catch (err) {
    console.error('Failed to update project:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id — delete a project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const exists = await getProject(req.params.id);
    if (!exists) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    await deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
