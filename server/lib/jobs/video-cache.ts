import * as dnsPromises from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { withProject } from '../storage.js';
import { getProjectStorageAdapter } from '../storage-adapters/index.js';
import { getDefaultJobsRepository } from './default-repository.js';

const mediaStorage = getProjectStorageAdapter();
const VIDEO_DOWNLOAD_ATTEMPTS = 5;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60000;
const VIDEO_DOWNLOAD_RETRY_DELAY_MS = 1500;
const VIDEO_DOWNLOAD_MAX_REDIRECTS = 5;
const IS_VITEST = Boolean(process.env.VITEST);
const VITEST_FETCH_HOST_SUFFIXES = ['.example'] as const;

export class InvalidExternalVideoUrlError extends Error {}

interface AllowedRemoteVideoTarget {
  address: string;
  parsedUrl: URL;
}

interface VideoCacheJobPayload {
  shotId: string;
  externalUrl: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

function errorMessageIncludes(err: unknown, pattern: string): boolean {
  const needle = pattern.toLowerCase();
  const maybeError = err as { message?: string; cause?: { message?: string } } | undefined;
  const message = `${maybeError?.message || ''} ${maybeError?.cause?.message || ''}`.toLowerCase();
  return message.includes(needle);
}

function isRetryableFetchError(err: unknown): boolean {
  const maybeError = err as { cause?: { code?: string }; code?: string } | undefined;
  const code = String(maybeError?.cause?.code ?? maybeError?.code ?? '').toUpperCase();
  if ([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_REQUEST_TIMEOUT',
  ].includes(code)) {
    return true;
  }

  return errorMessageIncludes(err, 'terminated')
    || errorMessageIncludes(err, 'fetch failed')
    || errorMessageIncludes(err, 'timeout')
    || errorMessageIncludes(err, 'socket');
}

function normalizeHostForPolicyChecks(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutBrackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  const zoneIndex = withoutBrackets.indexOf('%');
  return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function shouldUseVitestFetch(videoUrl: string): boolean {
  if (!IS_VITEST) {
    return false;
  }

  try {
    const parsed = new URL(videoUrl);
    const hostname = normalizeHostForPolicyChecks(parsed.hostname);
    return VITEST_FETCH_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function decodeMappedIpv4(address: string): string | null {
  const normalized = normalizeHostForPolicyChecks(address);
  if (!normalized.startsWith('::ffff:')) {
    return null;
  }

  const mapped = normalized.slice('::ffff:'.length);
  if (isIP(mapped) === 4) {
    return mapped;
  }

  if (/^[0-9a-f]{8}$/i.test(mapped)) {
    const value = Number.parseInt(mapped, 16);
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ].join('.');
  }

  const hexGroups = mapped.split(':');
  if (hexGroups.length === 2 && hexGroups.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    const bytes = hexGroups.flatMap((part) => {
      const value = Number.parseInt(part, 16);
      return [(value >>> 8) & 0xff, value & 0xff];
    });
    return bytes.join('.');
  }

  return null;
}

function ipv4ToInt(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function isIpv4InCidr(address: string, network: string, prefixLength: number): boolean {
  const value = ipv4ToInt(address);
  const base = ipv4ToInt(network);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (base & mask);
}

function parseIpv6ToBigInt(address: string): bigint | null {
  const normalized = normalizeHostForPolicyChecks(address);
  if (!normalized.includes(':')) {
    return null;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (part: string): string[] => (
    part
      .split(':')
      .filter(Boolean)
      .flatMap((group) => {
        if (group.includes('.')) {
          if (isIP(group) !== 4) return [];
          const octets = group.split('.').map(Number);
          return [
            ((octets[0] << 8) | octets[1]).toString(16),
            ((octets[2] << 8) | octets[3]).toString(16),
          ];
        }
        return [group];
      })
  );

  const head = parseGroups(halves[0] ?? '');
  const tail = parseGroups(halves[1] ?? '');
  const missingGroups = 8 - (head.length + tail.length);

  if (missingGroups < 0 || (halves.length === 1 && missingGroups !== 0)) {
    return null;
  }

  const groups = halves.length === 2
    ? [...head, ...Array.from({ length: missingGroups }, () => '0'), ...tail]
    : head;

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isIpv6InPrefix(address: string, network: string, prefixLength: number): boolean {
  const value = parseIpv6ToBigInt(address);
  const base = parseIpv6ToBigInt(network);
  if (value === null || base === null) {
    return false;
  }

  const hostBits = 128n - BigInt(prefixLength);
  const mask = prefixLength === 0
    ? 0n
    : ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n);

  return (value & mask) === (base & mask);
}

function isGloballyRoutableHostname(hostname: string): boolean {
  const normalized = normalizeHostForPolicyChecks(hostname);

  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
  ) {
    return false;
  }

  const mappedIpv4 = decodeMappedIpv4(normalized);
  if (mappedIpv4) {
    return isGloballyRoutableHostname(mappedIpv4);
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, prefix]) => isIpv4InCidr(normalized, network as string, prefix as number));
  }

  if (ipVersion === 6) {
    return ![
      ['::', 128],
      ['::1', 128],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001:db8::', 32],
      ['2001:10::', 28],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ].some(([network, prefix]) => isIpv6InPrefix(normalized, network as string, prefix as number));
  }

  return true;
}

async function resolveAllowedRemoteVideoTarget(videoUrl: string): Promise<AllowedRemoteVideoTarget> {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  if (parsed.username || parsed.password || !isGloballyRoutableHostname(parsed.hostname)) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  const resolved = await dnsPromises.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => !isGloballyRoutableHostname(entry.address))) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  return {
    address: resolved[0]!.address,
    parsedUrl: parsed,
  };
}

async function requestRemoteVideo(
  target: AllowedRemoteVideoTarget,
  timeoutMs: number,
): Promise<{ status: number; buffer: Buffer; headers: http.IncomingHttpHeaders | https.IncomingHttpHeaders }> {
  const { parsedUrl } = target;
  const requestImpl = parsedUrl.protocol === 'https:' ? https.request : http.request;
  const requestOptions: http.RequestOptions & https.RequestOptions = {
    hostname: target.address,
    port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
    method: 'GET',
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: {
      Host: parsedUrl.host,
    },
  };

  if (parsedUrl.protocol === 'https:') {
    const servername = normalizeHostForPolicyChecks(parsedUrl.hostname);
    requestOptions.servername = servername;
    requestOptions.checkServerIdentity = (_servername, cert) => checkServerIdentity(servername, cert);
  }

  return new Promise((resolve, reject) => {
    const req = requestImpl(requestOptions, (response) => {
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        response.resume?.();
        resolve({ status, buffer: Buffer.alloc(0), headers: response.headers });
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume?.();
        resolve({ status, buffer: Buffer.alloc(0), headers: response.headers });
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({ status, buffer: Buffer.concat(chunks), headers: response.headers });
      });
      response.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

async function fetchRemoteVideoBufferWithPolicy(
  videoUrl: string,
  redirectsRemaining: number,
  timeoutMs: number,
): Promise<Buffer> {
  if (redirectsRemaining < 0) {
    throw new InvalidExternalVideoUrlError('External video URL is not allowed for local caching');
  }

  const target = await resolveAllowedRemoteVideoTarget(videoUrl);
  const response = await requestRemoteVideo(target, timeoutMs);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    if (!location) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    const redirected = new URL(location, target.parsedUrl);
    return fetchRemoteVideoBufferWithPolicy(redirected.toString(), redirectsRemaining - 1, timeoutMs);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download media: ${response.status}`);
  }

  return response.buffer;
}

async function fetchAllowedRemoteVideoBuffer(
  videoUrl: string,
  attempts = VIDEO_DOWNLOAD_ATTEMPTS,
  timeoutMs = VIDEO_DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (shouldUseVitestFetch(videoUrl)) {
        const response = await fetch(videoUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        if (!response.ok) {
          throw new Error(`Failed to download media: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      return await fetchRemoteVideoBufferWithPolicy(videoUrl, VIDEO_DOWNLOAD_MAX_REDIRECTS, timeoutMs);
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableFetchError(err);
      const isLast = attempt === attempts - 1;

      if (!retryable || isLast) {
        throw err;
      }

      await sleep(VIDEO_DOWNLOAD_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error('Failed to download media');
}

export async function cacheVideoLocally(
  projectId: string,
  shotId: string,
  videoUrl: string,
): Promise<{ filename: string; url: string }> {
  const timestamp = Date.now();
  const videoFilename = `vid_${timestamp}.mp4`;
  const videoRef = {
    projectId,
    scope: 'shot-video',
    shotId,
    filename: videoFilename,
  } as const;

  await mediaStorage.ensureContainer({
    projectId,
    scope: 'shot-video',
    shotId,
  });

  const videoBuffer = await fetchAllowedRemoteVideoBuffer(videoUrl, VIDEO_DOWNLOAD_ATTEMPTS, VIDEO_DOWNLOAD_TIMEOUT_MS);
  await mediaStorage.writeBuffer(videoRef, videoBuffer);

  return {
    filename: videoFilename,
    url: mediaStorage.getPublicUrl(videoRef) || `/api/projects/${projectId}/shots/${shotId}/video/${videoFilename}`,
  };
}

async function attachCachedVideo(
  projectId: string,
  shotId: string,
  externalUrl: string,
): Promise<{ filename: string; url: string } | null> {
  const local = await cacheVideoLocally(projectId, shotId, externalUrl);
  try {
    return await withProject(projectId, (project) => {
      const refreshedShot = project.shots.find((shot) => shot.id === shotId);
      if (!refreshedShot || refreshedShot.videoFile !== externalUrl) {
        return null;
      }

      refreshedShot.videoFile = local.filename;
      refreshedShot.status = 'vid_review';
      return local;
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Project not found') {
      return null;
    }
    throw error;
  }
}

export async function enqueueVideoCacheJob(
  input: { projectId: string; shotId: string; externalUrl: string },
): Promise<string | null> {
  const jobsRepository = getDefaultJobsRepository();
  if (!jobsRepository) {
    const safeShotId = sanitizeForLog(input.shotId);
    void attachCachedVideo(input.projectId, input.shotId, input.externalUrl).catch((err) => {
      console.warn('[video-cache] Background cache failed for shot %s:', safeShotId, err);
    });
    return null;
  }

  const jobId = `video-cache-${Date.now()}-${input.shotId}`;
  await jobsRepository.enqueueJob<VideoCacheJobPayload>({
    id: jobId,
    projectId: input.projectId,
    jobType: 'video_cache',
    payload: {
      shotId: input.shotId,
      externalUrl: input.externalUrl,
    },
  });

  return jobId;
}

export async function runNextVideoCacheJob(workerId = `video-cache-worker-${process.pid}`): Promise<boolean> {
  const jobsRepository = getDefaultJobsRepository();
  if (!jobsRepository) {
    return false;
  }

  const claimedJob = await jobsRepository.claimNextJob<VideoCacheJobPayload>('video_cache', workerId);
  if (!claimedJob) {
    return false;
  }

  try {
    const local = await attachCachedVideo(
      claimedJob.projectId,
      claimedJob.payload.shotId,
      claimedJob.payload.externalUrl,
    );

    await jobsRepository.markJobDone(claimedJob.id, {
      filename: local?.filename ?? null,
      url: local?.url ?? null,
      attached: Boolean(local),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobsRepository.markJobFailed(claimedJob.id, message);
  }

  return true;
}
