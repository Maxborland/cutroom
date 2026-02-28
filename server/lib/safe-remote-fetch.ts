import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import * as dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

export interface SafeRemoteFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b, c, d] = parts;

  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
  if (a === 0 || a === 10 || a === 127) return true;

  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 0) return true;

  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved), 255.255.255.255 (broadcast)
  if (a >= 224) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback + unspecified
  if (normalized === '::1' || normalized === '::') return true;

  // IPv4-mapped IPv6: ::ffff:0:0/96
  if (normalized.startsWith('::ffff:')) {
    const v4part = normalized.slice('::ffff:'.length);
    return isPrivateIPv4(v4part);
  }

  // Unique local: fc00::/7
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local: fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  // Multicast: ff00::/8
  if (normalized.startsWith('ff')) return true;

  return false;
}

function assertAllowedProtocol(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Disallowed URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('Credentials in URL are not allowed');
  }
}

function assertAllowedHostname(hostname: string): void {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    throw new Error(`Disallowed hostname: ${hostname}`);
  }
}

async function assertPublicHostnameOrIp(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[(.*)\]$/, '$1');
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    if (isPrivateIPv4(host)) throw new Error(`Disallowed private IP: ${host}`);
    return;
  }
  if (ipVersion === 6) {
    if (isPrivateIPv6(host)) throw new Error(`Disallowed private IP: ${host}`);
    return;
  }

  assertAllowedHostname(host);

  const resolved = await dns.lookup(host, { all: true });
  if (!resolved || resolved.length === 0) {
    throw new Error(`Failed to resolve hostname: ${host}`);
  }

  for (const entry of resolved) {
    const addr = entry.address;
    const v = net.isIP(addr);
    if (v === 4 && isPrivateIPv4(addr)) {
      throw new Error(`Hostname resolves to private IP: ${hostname} -> ${addr}`);
    }
    if (v === 6 && isPrivateIPv6(addr)) {
      throw new Error(`Hostname resolves to private IP: ${hostname} -> ${addr}`);
    }
  }
}

export async function assertSafeRemoteUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  assertAllowedProtocol(parsed);
  await assertPublicHostnameOrIp(parsed.hostname);
  return parsed;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getContentLengthBytes(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function safeFetchFollow(url: string, options: SafeRemoteFetchOptions, redirectsLeft: number): Promise<Response> {
  const parsed = await assertSafeRemoteUrl(url);
  const timeoutMs = options.timeoutMs;

  // NOTE(security): `parsed` is validated by assertSafeRemoteUrl() (protocol allowlist,
  // DNS resolution, private-range blocking), and redirects are re-validated hop-by-hop.
  const response = await fetch(parsed.toString(), { // codeql[js/request-forgery]
    redirect: 'manual',
    signal: typeof timeoutMs === 'number' ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect (${response.status}) without location header`);
    }
    if (redirectsLeft <= 0) {
      throw new Error('Too many redirects');
    }
    const nextUrl = new URL(location, parsed);
    // Important: revalidate the redirect target.
    return safeFetchFollow(nextUrl.toString(), options, redirectsLeft - 1);
  }

  return response;
}

export async function safeFetchResponse(url: string, options: SafeRemoteFetchOptions = {}): Promise<Response> {
  const maxRedirects = toPositiveInt(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
  return safeFetchFollow(url, options, maxRedirects);
}

class ByteLimitTransform extends Transform {
  private seen = 0;

  public constructor(private readonly maxBytes: number) {
    super();
  }

  public override _transform(chunk: any, _enc: BufferEncoding, cb: (error?: Error | null, data?: any) => void): void {
    try {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.seen += buf.length;
      if (this.seen > this.maxBytes) {
        cb(new Error(`Remote download exceeds maxBytes=${this.maxBytes}`));
        return;
      }
      cb(null, buf);
    } catch (err) {
      cb(err as Error);
    }
  }
}

export async function downloadRemoteToBuffer(url: string, options: SafeRemoteFetchOptions = {}): Promise<Buffer> {
  const maxBytes = options.maxBytes;

  const response = await safeFetchResponse(url, options);
  if (!response.ok) {
    const err = new Error(`Failed to download media: ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }

  if (typeof maxBytes === 'number') {
    const len = getContentLengthBytes(response);
    if (typeof len === 'number' && len > maxBytes) {
      throw new Error(`Remote media too large: ${len} bytes > maxBytes=${maxBytes}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error('Remote response has no body');
    }

    const nodeStream = Readable.fromWeb(body as any);
    const limiter = new ByteLimitTransform(maxBytes);

    const chunks: Buffer[] = [];
    limiter.on('data', (c) => chunks.push(Buffer.from(c)));

    await pipeline(nodeStream, limiter);
    return Buffer.concat(chunks);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function downloadRemoteToFile(
  url: string,
  filePath: string,
  options: SafeRemoteFetchOptions = {},
): Promise<{ bytes: number }>{
  const maxBytes = options.maxBytes;

  const response = await safeFetchResponse(url, options);
  if (!response.ok) {
    const err = new Error(`Failed to download media: ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }

  if (typeof maxBytes === 'number') {
    const len = getContentLengthBytes(response);
    if (typeof len === 'number' && len > maxBytes) {
      throw new Error(`Remote media too large: ${len} bytes > maxBytes=${maxBytes}`);
    }
  }

  const body = response.body;
  if (!body) {
    throw new Error('Remote response has no body');
  }

  await mkdir(path.dirname(filePath), { recursive: true });

  const nodeStream = Readable.fromWeb(body as any);
  const limiter = typeof maxBytes === 'number' ? new ByteLimitTransform(maxBytes) : undefined;

  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += (Buffer.isBuffer(chunk) ? chunk.length : Buffer.from(chunk).length);
      cb(null, chunk);
    },
  });

  const tmpPath = `${filePath}.${Date.now().toString(36)}.tmp`;

  try {
    const target = fs.createWriteStream(tmpPath);

    if (limiter) {
      await pipeline(nodeStream, limiter, counter, target);
    } else {
      await pipeline(nodeStream, counter, target);
    }

    await fs.promises.rename(tmpPath, filePath);
    return { bytes };
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
