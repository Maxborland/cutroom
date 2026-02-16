import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject, saveProject, getProjectDir, ensureDir, type ShotMeta } from '../lib/storage.js';
import { chatCompletion, generateImage } from '../lib/openrouter.js';

const router = Router({ mergeParams: true });

// POST /api/projects/:id/generate-script — generate script from brief
router.post('/generate-script', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const briefText = project.brief.text || '';
    if (!briefText.trim()) {
      res.status(400).json({ error: 'Brief text is empty' });
      return;
    }

    // Build asset manifest
    const assetManifest = project.brief.assets.length > 0
      ? '\n\nПрикреплённые файлы:\n' + project.brief.assets.map((a, i) => `${i + 1}. ${a.filename}`).join('\n')
      : '';

    const systemPrompt = project.settings.scriptwriterPrompt;
    const userMessage = briefText + assetManifest;

    const script = await chatCompletion(
      project.settings.model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      project.settings.temperature
    );

    project.script = script;
    project.stage = 'script';
    await saveProject(project);

    res.json({ script });
  } catch (err) {
    console.error('Failed to generate script:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/split-shots — split script into shots
router.post('/split-shots', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!project.script.trim()) {
      res.status(400).json({ error: 'Script is empty. Generate a script first.' });
      return;
    }

    const systemPrompt = project.settings.shotSplitterPrompt;
    const userMessage = project.script;

    const response = await chatCompletion(
      project.settings.model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      project.settings.temperature
    );

    // Strip markdown code fences if present
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      // Remove opening fence (```json or ```)
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '');
      // Remove closing fence
      jsonStr = jsonStr.replace(/\n?```\s*$/, '');
    }

    let rawShots: Array<{ id?: string; prompt: string; durationSec: number }>;
    try {
      rawShots = JSON.parse(jsonStr);
    } catch (parseErr) {
      res.status(422).json({
        error: 'Failed to parse LLM response as JSON',
        raw: response,
      });
      return;
    }

    if (!Array.isArray(rawShots)) {
      res.status(422).json({
        error: 'LLM response is not an array',
        raw: response,
      });
      return;
    }

    // Create shot objects with standardized IDs
    const shots: ShotMeta[] = rawShots.map((raw, index) => {
      const shotId = `shot-${String(index + 1).padStart(3, '0')}`;
      return {
        id: shotId,
        order: index,
        prompt: raw.prompt || '',
        durationSec: raw.durationSec || 5,
        status: 'draft',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      };
    });

    // Create directories for each shot
    const projectDir = getProjectDir(project.id);
    for (const shot of shots) {
      const shotDir = path.join(projectDir, 'shots', shot.id);
      await ensureDir(path.join(shotDir, 'reference'));
      await ensureDir(path.join(shotDir, 'generated'));
      await ensureDir(path.join(shotDir, 'video'));
    }

    project.shots = shots;
    project.stage = 'shots';
    await saveProject(project);

    res.json({ shots });
  } catch (err) {
    console.error('Failed to split shots:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/shots/:shotId/generate-image — generate image for a shot
router.post('/shots/:shotId/generate-image', async (req: Request, res: Response) => {
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

    // Get image model from request body or use default
    const imageModel = req.body.model || 'openai/dall-e-3';
    const prompt = req.body.prompt || shot.prompt;

    // Set status to generating
    shot.status = 'generating';
    await saveProject(project);

    try {
      const result = await generateImage(imageModel, prompt);

      // Determine if result is base64 or URL
      const shotDir = path.join(getProjectDir(project.id), 'shots', shotId, 'generated');
      await ensureDir(shotDir);

      const timestamp = Date.now();
      const filename = `gen_${timestamp}.png`;
      const filePath = path.join(shotDir, filename);

      if (result.startsWith('data:') || result.match(/^[A-Za-z0-9+/=\s]+$/)) {
        // Base64 data
        let base64Data = result;
        if (base64Data.startsWith('data:')) {
          base64Data = base64Data.split(',')[1];
        }
        await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
      } else if (result.startsWith('http')) {
        // URL — download the image
        const imageResponse = await fetch(result);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        await fs.writeFile(filePath, buffer);
      } else {
        // Try treating as base64 anyway
        await fs.writeFile(filePath, Buffer.from(result, 'base64'));
      }

      // Reload project in case of concurrent changes
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.generatedImages.push(filename);
          refreshedShot.status = 'review';
          await saveProject(refreshed);
        }
      }

      res.json({
        filename,
        url: `/api/projects/${req.params.id}/shots/${shotId}/generated/${filename}`,
      });
    } catch (genErr) {
      // Revert status on error
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.status = 'draft';
          await saveProject(refreshed);
        }
      }
      throw genErr;
    }
  } catch (err) {
    console.error('Failed to generate image:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/projects/:id/shots/:shotId/generated/:filename — serve generated image
router.get('/shots/:shotId/generated/:filename', async (req: Request, res: Response) => {
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
      'generated',
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
    console.error('Failed to serve generated image:', err);
    res.status(500).json({ error: 'Failed to serve generated image' });
  }
});

export default router;
