import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import archiver, { type Archiver } from 'archiver';
import { getProject, type Project, type ShotMeta } from './storage.js';
import { getProjectStorageAdapter } from './storage-adapters/index.js';

const mediaStorage = getProjectStorageAdapter();
const MAX_EXPORT_SCENE_SLUG_LENGTH = 50;
const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
};

function isExternalMediaRef(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}

function isSafeManagedFilename(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed === path.basename(trimmed) && trimmed !== '.' && trimmed !== '..';
}

function getManagedMontageFilename(value: string | undefined): string | null {
  if (!value || isExternalMediaRef(value)) {
    return null;
  }

  const normalized = value.trim().replace(/\\/g, '/');
  const fromMontageRoot = normalized.startsWith('montage/')
    ? normalized.slice('montage/'.length)
    : normalized;

  return isSafeManagedFilename(fromMontageRoot) ? fromMontageRoot : null;
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

function resolveShotVideoPath(projectId: string, shot: Pick<ShotMeta, 'id' | 'videoFile'>): string | null {
  if (
    !shot.videoFile
    || isExternalMediaRef(shot.videoFile)
    || !isSafeManagedFilename(shot.videoFile)
  ) {
    return null;
  }

  try {
    return mediaStorage.getReadablePathForServer({
      projectId,
      scope: 'shot-video',
      shotId: shot.id,
      filename: shot.videoFile,
    });
  } catch {
    return null;
  }
}

function resolveMontageFilePath(projectId: string, filename: string | undefined): string | null {
  const managedFilename = getManagedMontageFilename(filename);
  if (!managedFilename) {
    return null;
  }

  try {
    return mediaStorage.getReadablePathForServer({
      projectId,
      scope: 'montage',
      filename: managedFilename,
    });
  } catch {
    return null;
  }
}

function pickFinalPhotoFilename(shot: Pick<ShotMeta, 'enhancedImages' | 'generatedImages'>): string | null {
  const enhancedImages = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
  const generatedImages = Array.isArray(shot.generatedImages) ? shot.generatedImages : [];
  return enhancedImages.at(-1) ?? generatedImages.at(-1) ?? null;
}

async function resolveFinalPhotoExport(
  projectId: string,
  shot: Pick<ShotMeta, 'id' | 'enhancedImages' | 'generatedImages'>,
): Promise<{ sourcePath: string; extension: string } | null> {
  const candidates = [
    ...(Array.isArray(shot.enhancedImages) ? [...shot.enhancedImages].reverse() : []),
    ...(Array.isArray(shot.generatedImages) ? [...shot.generatedImages].reverse() : []),
  ];

  for (const candidate of candidates) {
    const sourcePath = resolveGeneratedImagePath(projectId, shot.id, candidate);
    if (!sourcePath) continue;

    const stat = await fs.stat(sourcePath).catch(() => null);
    if (stat?.isFile()) {
      return {
        sourcePath,
        extension: path.extname(candidate) || '.png',
      };
    }
  }

  return null;
}

function formatShotIndex(order: number): string {
  return String(order + 1).padStart(2, '0');
}

function transliterateForSlug(value: string): string {
  return Array.from(value, (char) => CYRILLIC_TO_LATIN_MAP[char] ?? char).join('');
}

function buildSafeSceneSlug(scene: string | undefined): string {
  const normalized = transliterateForSlug(
    (scene || '').toLowerCase(),
  )
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, MAX_EXPORT_SCENE_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return normalized || 'shot';
}

function buildShotMediaBasename(shot: Pick<ShotMeta, 'order' | 'scene'>): string {
  return `${formatShotIndex(shot.order)}_${buildSafeSceneSlug(shot.scene)}`;
}

interface ExportShotMetadata {
  id: string;
  order: number;
  scene: string;
  durationSec: number;
  status: string;
  promptPath: string;
  photoPath: string | null;
  videoPath: string | null;
  missingAssets: Array<'photo' | 'video'>;
}

interface ExportAudioMetadata {
  voiceoverPath: string | null;
  musicPath: string | null;
  missingAssets: Array<'voiceover' | 'music'>;
}

function buildExportMetadata(project: Project, shots: ExportShotMetadata[], audio: ExportAudioMetadata) {
  return {
    exportType: 'external-edit-package',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      stage: project.stage,
    },
    shots,
    audio,
  };
}

export function getExportDownloadFilename(projectName: string): string {
  return `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
}

export async function appendProjectArchiveEntries(archive: Archiver, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const exportShots: ExportShotMetadata[] = [];
  const exportAudio: ExportAudioMetadata = {
    voiceoverPath: null,
    musicPath: null,
    missingAssets: [],
  };

  for (const shot of project.shots) {
    const shotIndex = formatShotIndex(shot.order);
    const shotFolderName = `${shotIndex}_${shot.id}`;
    const shotMediaBasename = buildShotMediaBasename(shot);
    const promptPath = `prompts/${shotFolderName}.txt`;
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
    archive.append(promptsContent, { name: promptPath });

    let photoPath: string | null = null;
    const finalPhoto = await resolveFinalPhotoExport(project.id, shot);
    if (finalPhoto) {
      photoPath = `shots/${shotFolderName}/photo/${shotMediaBasename}${finalPhoto.extension}`;
      archive.file(finalPhoto.sourcePath, { name: photoPath });
    } else if (pickFinalPhotoFilename(shot)) {
      // Preserve best-effort semantics: arrays referenced a photo, but no managed file was readable.
    }

    let videoPath: string | null = null;
    const resolvedVideoPath = resolveShotVideoPath(project.id, shot);
    const videoStat = resolvedVideoPath ? await fs.stat(resolvedVideoPath).catch(() => null) : null;
    if (videoStat?.isFile() && shot.videoFile) {
      const videoExtension = path.extname(shot.videoFile) || '.mp4';
      videoPath = `shots/${shotFolderName}/video/${shotMediaBasename}${videoExtension}`;
      archive.file(resolvedVideoPath, { name: videoPath });
    }

    exportShots.push({
      id: shot.id,
      order: shot.order,
      scene: shot.scene || '',
      durationSec: shot.duration,
      status: shot.status,
      promptPath,
      photoPath,
      videoPath,
      missingAssets: [
        ...(photoPath ? [] : ['photo' as const]),
        ...(videoPath ? [] : ['video' as const]),
      ],
    });
  }

  const voiceoverPath = resolveMontageFilePath(project.id, project.voiceoverFile);
  const voiceoverStat = voiceoverPath ? await fs.stat(voiceoverPath).catch(() => null) : null;
  if (voiceoverStat?.isFile() && project.voiceoverFile) {
    exportAudio.voiceoverPath = `audio/voiceover${path.extname(project.voiceoverFile) || '.mp3'}`;
    archive.file(voiceoverPath, { name: exportAudio.voiceoverPath });
  } else if (project.voiceoverFile) {
    exportAudio.missingAssets.push('voiceover');
  }

  const musicPath = resolveMontageFilePath(project.id, project.musicFile);
  const musicStat = musicPath ? await fs.stat(musicPath).catch(() => null) : null;
  if (musicStat?.isFile() && project.musicFile) {
    exportAudio.musicPath = `audio/music${path.extname(project.musicFile) || '.mp3'}`;
    archive.file(musicPath, { name: exportAudio.musicPath });
  } else if (project.musicFile) {
    exportAudio.missingAssets.push('music');
  }

  const metadata = buildExportMetadata(project, exportShots, exportAudio);
  archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });
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
