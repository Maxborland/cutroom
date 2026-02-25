import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { getProject, getProjectDir } from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });

// GET /api/projects/:id/export — stream ZIP of the entire project
router.get('/export', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const projectDir = getProjectDir(project.id);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        sendApiError(res, 500, 'Failed to create archive');
      }
    });

    archive.pipe(res);

    // Add metadata.json (full project)
    archive.append(JSON.stringify(project, null, 2), { name: 'metadata.json' });

    // Add per-shot folders
    for (const shot of project.shots) {
      const shotIndex = String(shot.order + 1).padStart(2, '0');
      const folderName = `${shotIndex}_${shot.id}`;

      // Add prompts.txt
      const promptsContent = [
        `Shot: ${shot.id}`,
        `Order: ${shot.order}`,
        `Scene: ${shot.scene || ''}`,
        `Duration: ${shot.duration}s`,
        `Status: ${shot.status}`,
        '',
        'Image Prompt:',
        shot.imagePrompt || '',
        '',
        'Video Prompt:',
        shot.videoPrompt || '',
        '',
        'Audio Description:',
        shot.audioDescription || '',
      ].join('\n');
      archive.append(promptsContent, { name: `${folderName}/prompts.txt` });

      // Determine best images: prefer enhanced, fallback to generated
      const enhancedImages = Array.isArray((shot as any).enhancedImages) ? (shot as any).enhancedImages as string[] : [];
      const generatedImages = Array.isArray(shot.generatedImages) ? shot.generatedImages : [];
      const bestImages = enhancedImages.length > 0 ? enhancedImages : generatedImages;

      // Add best images as final/
      const generatedDir = path.join(projectDir, 'shots', shot.id, 'generated');
      if (bestImages.length > 0) {
        for (const file of bestImages) {
          const filePath = path.join(generatedDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.isFile()) {
              archive.file(filePath, { name: `${folderName}/final/${file}` });
            }
          } catch {
            // File might be missing, skip
          }
        }
      }

      // Add all images (generated + enhanced) for reference
      try {
        const allFiles = await fs.readdir(generatedDir);
        for (const file of allFiles) {
          const filePath = path.join(generatedDir, file);
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            archive.file(filePath, { name: `${folderName}/images/${file}` });
          }
        }
      } catch {
        // Directory might not exist, skip
      }

      // Add video
      const videoDir = path.join(projectDir, 'shots', shot.id, 'video');
      try {
        const videoFiles = await fs.readdir(videoDir);
        for (const file of videoFiles) {
          const filePath = path.join(videoDir, file);
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            archive.file(filePath, { name: `${folderName}/video/${file}` });
          }
        }
      } catch {
        // Directory might not exist, skip
      }

      // Add reference
      const referenceDir = path.join(projectDir, 'shots', shot.id, 'reference');
      try {
        const referenceFiles = await fs.readdir(referenceDir);
        for (const file of referenceFiles) {
          const filePath = path.join(referenceDir, file);
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            archive.file(filePath, { name: `${folderName}/reference/${file}` });
          }
        }
      } catch {
        // Directory might not exist, skip
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Failed to export project:', err);
    if (!res.headersSent) {
      sendApiError(res, 500, 'Failed to export project');
    }
  }
});

// GET /api/projects/:id/export/prompts — plain text of all shot prompts
router.get('/export/prompts', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const lines: string[] = [
      `Project: ${project.name}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '═'.repeat(60),
      '',
    ];

    for (const shot of project.shots) {
      const shotIndex = String(shot.order + 1).padStart(2, '0');
      lines.push(`[${shotIndex}] ${shot.id} (${shot.duration}s) — ${shot.scene || ''}`);
      lines.push('─'.repeat(40));
      lines.push('Image: ' + (shot.imagePrompt || ''));
      lines.push('Video: ' + (shot.videoPrompt || ''));
      if (shot.audioDescription) lines.push('Audio: ' + shot.audioDescription);
      lines.push('');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Failed to export prompts:', err);
    sendApiError(res, 500, 'Failed to export prompts');
  }
});

export default router;
