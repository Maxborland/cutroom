/**
 * render-worker.ts — Remotion render orchestration.
 * Spawns @remotion/renderer to produce video from a MontagePlan.
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveProjectPath, ensureDir, withProject, type RenderJob } from './storage.js';
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

/**
 * Start a render job. Returns immediately with a jobId.
 * Progress is tracked in the project's RenderJob entry.
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
  const bundled = await bundle({
    entryPoint: REMOTION_ENTRY,
    // Avoid writing to project dir
  });

  // Select composition
  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'Montage',
    inputProps: { plan: resolvedPlan },
  });

  // Override dimensions based on quality
  const compositionWithOverrides = {
    ...composition,
    width: config.width,
    height: config.height,
    fps: config.fps,
  };

  // Render
  await renderMedia({
    composition: compositionWithOverrides,
    serveUrl: bundled,
    codec: config.codec as any,
    outputLocation: outputFile,
    inputProps: { plan: resolvedPlan },
    crf: config.crf,
    concurrency: config.concurrency,
    onProgress: ({ progress }) => {
      // Update progress every 5%
      const pct = Math.round(progress * 100);
      if (pct % 5 === 0) {
        updateJob(projectId, jobId, { progress: pct }).catch(() => {});
      }
    },
  });

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
  const { getProject } = await import('./storage.js');
  const project = await getProject(projectId);
  if (!project) return null;
  return project.renders?.find(r => r.id === jobId) ?? null;
}
