import * as childProcess from 'node:child_process';
import { probeDuration } from './normalize.js';

export interface SampledVideoFrame {
  timeSec: number;
  imageDataUrl: string;
}

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_STDOUT_SIZE = 16 * 1024 * 1024;

function execFileBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      cmd,
      args,
      { encoding: 'buffer', maxBuffer: MAX_STDOUT_SIZE },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr && stderr.length > 0
            ? `${error.message}: ${stderr.toString()}`
            : error.message;
          reject(new Error(message));
          return;
        }

        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

function buildSampleTimes(durationSec: number, sampleCount: number): number[] {
  const safeDuration = Number.isFinite(durationSec) ? Math.max(durationSec, 0) : 0;
  if (safeDuration <= 0) {
    return [];
  }

  if (sampleCount <= 1 || safeDuration <= 1) {
    return [Number((safeDuration / 2).toFixed(3))];
  }

  const startSec = Math.min(0.25, safeDuration * 0.1);
  const endSec = Math.max(startSec, safeDuration - Math.min(0.25, safeDuration * 0.1));
  const times = new Set<number>();

  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = (index + 1) / (sampleCount + 1);
    const timeSec = startSec + (endSec - startSec) * fraction;
    times.add(Number(Math.min(Math.max(timeSec, 0), Math.max(safeDuration - 0.05, 0)).toFixed(3)));
  }

  return Array.from(times).sort((left, right) => left - right);
}

async function captureVideoFrame(filePath: string, timeSec: number): Promise<Buffer> {
  return execFileBuffer(FFMPEG, [
    '-v', 'error',
    '-ss', String(Math.max(timeSec, 0)),
    '-i', filePath,
    '-frames:v', '1',
    '-q:v', '2',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ]);
}

export async function sampleVideoFrames(filePath: string, sampleCount = 3): Promise<SampledVideoFrame[]> {
  const durationSec = await probeDuration(filePath);
  const times = buildSampleTimes(durationSec, sampleCount);

  if (times.length === 0) {
    return [];
  }

  const frames: SampledVideoFrame[] = [];
  for (const timeSec of times) {
    const frameBytes = await captureVideoFrame(filePath, timeSec);
    frames.push({
      timeSec,
      imageDataUrl: `data:image/jpeg;base64,${frameBytes.toString('base64')}`,
    });
  }

  return frames;
}
