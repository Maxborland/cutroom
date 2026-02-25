import fs from 'node:fs/promises';
import {
  ensureDir,
  getProject,
  listProjects,
  resolveProjectPath,
  type Project,
  withProject,
} from './storage.js';
import { saveImageResult } from './media-utils.js';

const externalImageCacheJobs = new Map<string, Promise<string | null>>();

export interface ExternalImageRecoverySummary {
  projectsScanned: number;
  shotsScanned: number;
  referencesFound: number;
  cachedCount: number;
  failedCount: number;
}

export function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

function inferImageExtensionFromRef(ref: string): string {
  if (ref.startsWith('data:image/')) {
    const m = ref.match(/^data:image\/([a-z0-9+.-]+);/i)?.[1]?.toLowerCase();
    if (m === 'jpeg' || m === 'jpg') return 'jpg';
    if (m === 'webp') return 'webp';
    if (m === 'gif') return 'gif';
    if (m === 'png') return 'png';
    return 'png';
  }

  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    try {
      const pathname = new URL(ref).pathname.toLowerCase();
      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'jpg';
      if (pathname.endsWith('.webp')) return 'webp';
      if (pathname.endsWith('.gif')) return 'gif';
      if (pathname.endsWith('.png')) return 'png';
    } catch {
      // ignore parse errors and use default below
    }
  }

  return 'png';
}

export async function cacheExternalImageReference(
  projectId: string,
  shotId: string,
  externalRef: string,
): Promise<string | null> {
  if (!isExternalMediaRef(externalRef)) return null;

  const cacheKey = `${projectId}/${shotId}/${externalRef}`;
  const existing = externalImageCacheJobs.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    const project = await getProject(projectId);
    if (!project) return null;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return null;

    const inGenerated = (shot.generatedImages || []).includes(externalRef);
    const inEnhanced = (shot.enhancedImages || []).includes(externalRef);
    if (!inGenerated && !inEnhanced) return null;

    const shotDir = resolveProjectPath(projectId, 'shots', shotId, 'generated');
    await ensureDir(shotDir);

    const ext = inferImageExtensionFromRef(externalRef);
    const filename = `img_cached_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = resolveProjectPath(projectId, 'shots', shotId, 'generated', filename);

    try {
      await saveImageResult(externalRef, filePath);
    } catch (err) {
      console.warn('[external-cache] Failed to cache external image:', (err as any)?.message || err);
      return null;
    }

    const changed = await withProject(projectId, (current) => {
      const currentShot = current.shots.find((s) => s.id === shotId);
      if (!currentShot) return false;

      let updated = false;
      currentShot.generatedImages = (currentShot.generatedImages || []).map((value) => {
        if (value === externalRef) {
          updated = true;
          return filename;
        }
        return value;
      });
      currentShot.enhancedImages = (currentShot.enhancedImages || []).map((value) => {
        if (value === externalRef) {
          updated = true;
          return filename;
        }
        return value;
      });
      return updated;
    });

    if (!changed) {
      await fs.unlink(filePath).catch(() => undefined);
      return null;
    }

    console.log(`[external-cache] Cached ${projectId}/${shotId} external image -> ${filename}`);
    return filename;
  })().finally(() => {
    externalImageCacheJobs.delete(cacheKey);
  });

  externalImageCacheJobs.set(cacheKey, task);
  return task;
}

export async function recoverExternalImageReferencesOnStartup(projectIds?: string[]): Promise<ExternalImageRecoverySummary> {
  const projects = projectIds
    ? (await Promise.all(projectIds.map((id) => getProject(id)))).filter((p): p is Project => Boolean(p))
    : await listProjects();

  const summary: ExternalImageRecoverySummary = {
    projectsScanned: projects.length,
    shotsScanned: 0,
    referencesFound: 0,
    cachedCount: 0,
    failedCount: 0,
  };

  for (const project of projects) {
    for (const shot of project.shots) {
      summary.shotsScanned += 1;

      const refs = new Set<string>();
      for (const ref of shot.generatedImages || []) {
        if (isExternalMediaRef(ref)) refs.add(ref);
      }
      for (const ref of shot.enhancedImages || []) {
        if (isExternalMediaRef(ref)) refs.add(ref);
      }

      for (const ref of refs) {
        summary.referencesFound += 1;
        const cached = await cacheExternalImageReference(project.id, shot.id, ref);
        if (cached) {
          summary.cachedCount += 1;
        } else {
          summary.failedCount += 1;
        }
      }
    }
  }

  return summary;
}
