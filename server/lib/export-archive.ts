import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import archiver, { type Archiver } from 'archiver';
import { getProject } from './storage.js';
import { getProjectStorageAdapter } from './storage-adapters/index.js';

const mediaStorage = getProjectStorageAdapter();

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

function isSafeManagedFilename(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed === path.basename(trimmed) && trimmed !== '.' && trimmed !== '..';
}

function resolveGeneratedImagePath(projectId: string, shotId: string, filename: string): string | null {
  if (isExternalMediaRef(filename) || !isSafeManagedFilename(filename)) {
    return null;
  }

  try {
    return mediaStorage.getReadablePathForServer({
      projectId,
      scope: 'shot-generated',
      shotId,
      filename,
    });
  } catch {
    return null;
  }
}

export function getExportDownloadFilename(projectName: string): string {
  return `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
}

export async function appendProjectArchiveEntries(archive: Archiver, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  archive.append(JSON.stringify(project, null, 2), { name: 'metadata.json' });

  for (const shot of project.shots) {
    const shotIndex = String(shot.order + 1).padStart(2, '0');
    const folderName = `${shotIndex}_${shot.id}`;
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

    const enhancedImages = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
    const generatedImages = Array.isArray(shot.generatedImages) ? shot.generatedImages : [];
    const bestImages = enhancedImages.length > 0 ? enhancedImages : generatedImages;

    for (const file of bestImages) {
      const filePath = resolveGeneratedImagePath(project.id, shot.id, file);
      if (!filePath) continue;
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) {
        archive.file(filePath, { name: `${folderName}/final/${path.basename(file)}` });
      }
    }

    const allGeneratedFiles = await mediaStorage.listObjects({
      projectId: project.id,
      scope: 'shot-generated',
      shotId: shot.id,
    });
    for (const file of allGeneratedFiles) {
      const filePath = mediaStorage.getReadablePathForServer({
        projectId: project.id,
        scope: 'shot-generated',
        shotId: shot.id,
        filename: file,
      });
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) {
        archive.file(filePath, { name: `${folderName}/images/${file}` });
      }
    }

    const videoFiles = await mediaStorage.listObjects({
      projectId: project.id,
      scope: 'shot-video',
      shotId: shot.id,
    });
    for (const file of videoFiles) {
      const filePath = mediaStorage.getReadablePathForServer({
        projectId: project.id,
        scope: 'shot-video',
        shotId: shot.id,
        filename: file,
      });
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) {
        archive.file(filePath, { name: `${folderName}/video/${file}` });
      }
    }

    const referenceFiles = await mediaStorage.listObjects({
      projectId: project.id,
      scope: 'shot-reference',
      shotId: shot.id,
    });
    for (const file of referenceFiles) {
      const filePath = mediaStorage.getReadablePathForServer({
        projectId: project.id,
        scope: 'shot-reference',
        shotId: shot.id,
        filename: file,
      });
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) {
        archive.file(filePath, { name: `${folderName}/reference/${file}` });
      }
    }
  }
}

export async function writeProjectArchive(projectId: string, filename: string): Promise<string> {
  await mediaStorage.ensureContainer({ projectId, scope: 'export' });
  const outputPath = mediaStorage.getReadablePathForServer({
    projectId,
    scope: 'export',
    filename,
  });

  await new Promise<void>((resolve, reject) => {
    const output = fsCb.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);

    void appendProjectArchiveEntries(archive, projectId)
      .then(() => archive.finalize())
      .catch((error) => {
        output.destroy();
        reject(error);
      });
  });

  return `montage/exports/${filename}`;
}
