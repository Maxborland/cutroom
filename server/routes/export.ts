import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { getProject } from '../lib/storage.js';
import { getProjectStorageAdapter } from '../lib/storage-adapters/index.js';
import { appendProjectArchiveEntries, getExportDownloadFilename } from '../lib/export-archive.js';
import { enqueueExportJob, getExportJob } from '../lib/jobs/export.js';
import { sendApiError } from '../lib/api-error.js';

const router = Router({ mergeParams: true });
const mediaStorage = getProjectStorageAdapter();

// GET /api/projects/:id/export — stream ZIP of the entire project
router.get('/export', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

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
    await appendProjectArchiveEntries(archive, project.id);

    await archive.finalize();
  } catch (err) {
    console.error('Failed to export project:', err);
    if (!res.headersSent) {
      sendApiError(res, 500, 'Failed to export project');
    }
  }
});

router.post('/export/prepare', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const jobId = await enqueueExportJob(project.id);
    if (!jobId) {
      res.json({
        jobId: null,
        status: 'done',
        downloadUrl: `/api/projects/${project.id}/export`,
      });
      return;
    }

    res.json({ jobId, status: 'queued' });
  } catch (err) {
    console.error('Failed to prepare export:', err);
    sendApiError(res, 500, 'Failed to prepare export');
  }
});

router.get('/export/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const job = await getExportJob(req.params.jobId);
    if (!job || job.projectId !== project.id) {
      sendApiError(res, 404, 'Export job not found');
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      errorMessage: job.errorMessage,
      outputFile: job.result?.outputFile ?? null,
      downloadUrl: job.result?.outputFile
        ? `/api/projects/${project.id}/export/jobs/${job.id}/download`
        : null,
    });
  } catch (err) {
    console.error('Failed to get export job:', err);
    sendApiError(res, 500, 'Failed to get export job');
  }
});

router.get('/export/jobs/:jobId/download', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const job = await getExportJob(req.params.jobId);
    if (!job || job.projectId !== project.id) {
      sendApiError(res, 404, 'Export job not found');
      return;
    }

    if (job.status !== 'done' || !job.result?.outputFile) {
      sendApiError(res, 400, `Export not complete. Status: ${job.status}`);
      return;
    }

    const filename = path.basename(job.result.outputFile);
    const filePath = mediaStorage.getReadablePathForServer({
      projectId: project.id,
      scope: 'export',
      filename,
    });
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      sendApiError(res, 404, 'Prepared export file not found');
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${getExportDownloadFilename(project.name)}"`);
    const stream = fsCb.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Failed to download prepared export:', err);
    sendApiError(res, 500, 'Failed to download prepared export');
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
