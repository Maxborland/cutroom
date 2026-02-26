/**
 * render-worker.ts — Remotion render orchestration.
 * Spawns @remotion/renderer to produce video from a MontagePlan.
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveProjectPath, ensureDir, withProject, getProject, type RenderJob } from './storage.js';
import { resolvePlan } from '../remotion/src/lib/plan-reader.js';
import type { MontagePlan } from './storage.js';

const REMOTION_ENTRY = path.resolve(
  import.meta.dirname ?? __dirname,
  '../remotion/src/Root.tsx',
);

export type RenderQuality = 'preview' | 'final';

interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  crf: number;
  codec: 'h264' | 'h265';
  concurrency: number;
}

const PRESETS: Record<RenderQuality, RenderConfig> = {
  preview: {
    width: 1280,
    height: 720,
    fps: 30,
    crf: 28,
    codec: 'h264',
    concurrency: 2,
  },
  final: {
    width: 3840,
    height: 2160,
    fps: 30,
    crf: 18,
    codec: 'h264',
    concurrency: 2,
  },
};

/** Maximum number of completed preview renders to keep per project */
const MAX_PREVIEW_RENDERS = 3;

/**
 * Start a render job. Returns immediately with a jobId.
 * Progress is tracked in the project's RenderJob entry.
 * Automatically cleans up old preview renders before starting.
 */
export async function startRender(
  projectId: string,
  plan: MontagePlan,
  quality: RenderQuality = 'preview',
): Promise<string> {
  const config = PRESETS[quality];
  const jobId = `render-${Date.now()}-${quality}`;
  const outputDir = resolveProjectPath(projectId, 'montage', 'renders');
  await ensureDir(outputDir);
  const outputFile = path.join(outputDir, `${jobId}.mp4`);

  // Create initial render job entry
  const job: RenderJob = {
    id: jobId,
    createdAt: new Date().toISOString(),
    quality,
    resolution: quality === 'final' ? '3840x2160' : '1280x720',
    status: 'queued',
    progress: 0,
  };

  await withProject(projectId, (p) => {
    if (!p.renders) p.renders = [];
    p.renders.push(job);
  });

  // Clean up old preview renders in background (best-effort)
  cleanupOldRenders(projectId, quality).catch((err) => {
    console.warn(`[render] Cleanup failed for ${projectId}:`, err.message);
  });

  // Fire and forget — run render in background
  doRender(projectId, plan, jobId, outputFile, config).catch((err) => {
    console.error(`[render] Job ${jobId} failed:`, err);
    updateJob(projectId, jobId, {
      status: 'failed',
      errorMessage: err.message || String(err),
    }).catch(() => {});
  });

  return jobId;
}

async function doRender(
  projectId: string,
  plan: MontagePlan,
  jobId: string,
  outputFile: string,
  config: RenderConfig,
): Promise<void> {
  await updateJob(projectId, jobId, { status: 'rendering', progress: 0 });

  const projectDir = resolveProjectPath(projectId);
  const resolvedPlan = resolvePlan(plan, projectDir);

  // Bundle Remotion project
  let bundled: string;
  try {
    bundled = await bundle({
      entryPoint: REMOTION_ENTRY,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Remotion bundle failed: ${msg}`);
  }

  // Select composition
  let composition;
  try {
    composition = await selectComposition({
      serveUrl: bundled,
      id: 'Montage',
      inputProps: { plan: resolvedPlan },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Remotion composition select failed: ${msg}`);
  }

  // Override dimensions and duration based on quality + plan
  const compositionWithOverrides = {
    ...composition,
    width: config.width,
    height: config.height,
    fps: config.fps,
    durationInFrames: resolvedPlan.totalDurationFrames,
  };

  // Render
  try {
    await renderMedia({
      composition: compositionWithOverrides,
      serveUrl: bundled,
      codec: config.codec as any,
      outputLocation: outputFile,
      inputProps: { plan: resolvedPlan },
      crf: config.crf,
      concurrency: config.concurrency,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 5 === 0) {
          updateJob(projectId, jobId, { progress: pct }).catch(() => {});
        }
      },
    });
  } catch (err) {
    // Clean up partial output file on failure
    await fs.unlink(outputFile).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Remotion render failed: ${msg}`);
  }

  // Mark done
  await updateJob(projectId, jobId, {
    status: 'done',
    progress: 100,
    outputFile: `montage/renders/${jobId}.mp4`,
  });
}

async function updateJob(
  projectId: string,
  jobId: string,
  updates: Partial<RenderJob>,
): Promise<void> {
  await withProject(projectId, (p) => {
    const job = p.renders?.find(r => r.id === jobId);
    if (job) {
      Object.assign(job, updates);
    }
  });
}

/**
 * Get render job status
 */
export async function getRenderJob(
  projectId: string,
  jobId: string,
): Promise<RenderJob | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  return project.renders?.find(r => r.id === jobId) ?? null;
}

/**
 * Delete a render job and its output file.
 * Returns true if found and deleted, false if not found.
 */
export async function deleteRenderJob(
  projectId: string,
  jobId: string,
): Promise<boolean> {
  const project = await getProject(projectId);
  if (!project) return false;

  const job = project.renders?.find(r => r.id === jobId);
  if (!job) return false;

  // Don't delete currently rendering jobs
  if (job.status === 'rendering') {
    throw new Error('Cannot delete a render job that is currently rendering');
  }

  // Delete output file if it exists
  if (job.outputFile) {
    const filePath = resolveProjectPath(projectId, job.outputFile);
    await fs.unlink(filePath).catch(() => {});
  }

  // Remove from project renders list
  await withProject(projectId, (p) => {
    if (p.renders) {
      p.renders = p.renders.filter(r => r.id !== jobId);
    }
  });

  return true;
}

/**
 * Clean up old completed renders. Keeps the most recent MAX_PREVIEW_RENDERS
 * for the given quality, deleting older output files and job entries.
 */
async function cleanupOldRenders(
  projectId: string,
  quality: RenderQuality,
): Promise<void> {
  const project = await getProject(projectId);
  if (!project?.renders) return;

  const completedByQuality = project.renders
    .filter(r => r.quality === quality && (r.status === 'done' || r.status === 'failed'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (completedByQuality.length <= MAX_PREVIEW_RENDERS) return;

  const toRemove = completedByQuality.slice(MAX_PREVIEW_RENDERS);

  // Delete output files
  for (const job of toRemove) {
    if (job.outputFile) {
      const filePath = resolveProjectPath(projectId, job.outputFile);
      await fs.unlink(filePath).catch(() => {});
    }
  }

  // Remove entries from project
  const removeIds = new Set(toRemove.map(r => r.id));
  await withProject(projectId, (p) => {
    if (p.renders) {
      p.renders = p.renders.filter(r => !removeIds.has(r.id));
    }
  });

  console.log(`[render] Cleaned up ${toRemove.length} old ${quality} render(s) for project ${projectId}`);
}
