import * as childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath, ensureDir, type ShotMeta } from './storage.js';

// Use namespace import so vitest can intercept the mock at call time
function execFileAsync(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const TARGET_WIDTH = 3840;
const TARGET_HEIGHT = 2160;
const TARGET_FPS = 30;
const TARGET_CODEC = 'h264';

// ── FFprobe helpers ──────────────────────────────────────────────────

interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
  const duration = parseFloat(data.format?.duration || '0');

  if (!videoStream) {
    return { duration, width: 0, height: 0, fps: 0, codec: '' };
  }

  // Parse frame rate from r_frame_rate (e.g., "30/1")
  let fps = 0;
  const fpsStr = videoStream.r_frame_rate || '';
  if (fpsStr.includes('/')) {
    const [num, den] = fpsStr.split('/').map(Number);
    fps = den > 0 ? num / den : 0;
  } else {
    fps = parseFloat(fpsStr) || 0;
  }

  return {
    duration,
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: Math.round(fps),
    codec: videoStream.codec_name || '',
  };
}

export async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath,
  ]);

  const data = JSON.parse(stdout);
  return parseFloat(data.format?.duration || '0');
}

// ── Normalization logic ──────────────────────────────────────────────

function needsNormalization(probe: ProbeResult): boolean {
  return (
    probe.width !== TARGET_WIDTH ||
    probe.height !== TARGET_HEIGHT ||
    probe.fps !== TARGET_FPS ||
    probe.codec !== TARGET_CODEC
  );
}

async function normalizeVideo(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(FFMPEG, [
    '-y',
    '-i', inputPath,
    '-vf', `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${TARGET_FPS}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

async function imageToVideo(imagePath: string, outputPath: string, durationSec: number): Promise<void> {
  const totalFrames = Math.ceil(durationSec * TARGET_FPS);
  await execFileAsync(FFMPEG, [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-t', String(durationSec),
    '-vf', `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.001,1.05)':d=${totalFrames}:s=${TARGET_WIDTH}x${TARGET_HEIGHT}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

// ── Main export ──────────────────────────────────────────────────────

/**
 * Normalize all approved shot clips to a consistent format.
 * For shots with video: probe and optionally re-encode.
 * For shots without video but with images: generate a Ken Burns video from the best image.
 * Returns Map<shotId, normalizedFilePath>
 */
export async function normalizeClips(
  projectId: string,
  shots: ShotMeta[],
): Promise<Map<string, string>> {
  const normalizedDir = resolveProjectPath(projectId, 'montage', 'normalized');
  await ensureDir(normalizedDir);

  const result = new Map<string, string>();

  for (const shot of shots) {
    if (shot.status !== 'approved') continue;

    const outputPath = resolveProjectPath(projectId, 'montage', 'normalized', `${shot.id}.mp4`);

    if (shot.videoFile) {
      // Shot has video — probe and potentially normalize
      // videoFile stores just the filename (e.g. "vid_123.mp4");
      // actual file lives at shots/<shotId>/video/<filename>
      const inputPath = resolveProjectPath(projectId, 'shots', shot.id, 'video', shot.videoFile);
      const probe = await probeFile(inputPath);

      if (needsNormalization(probe)) {
        await normalizeVideo(inputPath, outputPath);
      } else {
        // Already in target format — copy
        await fs.copyFile(inputPath, outputPath);
      }

      result.set(shot.id, outputPath);
    } else {
      // No video — generate from best image
      // Image filenames are stored without path prefix;
      // actual files live at shots/<shotId>/generated/<filename>
      const imagePath = shot.selectedImage
        ? resolveProjectPath(projectId, 'shots', shot.id, 'generated', shot.selectedImage)
        : shot.generatedImages.length > 0
          ? resolveProjectPath(projectId, 'shots', shot.id, 'generated', shot.generatedImages[0])
          : null;

      if (imagePath) {
        await imageToVideo(imagePath, outputPath, shot.duration);
        result.set(shot.id, outputPath);
      }
    }
  }

  return result;
}
