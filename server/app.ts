import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import projectRoutes from './routes/projects.js';
import settingsRoutes from './routes/settings.js';
import modelRoutes from './routes/models.js';
import assetRoutes from './routes/assets.js';
import generateRoutes from './routes/generate/index.js';
import shotRoutes from './routes/shots.js';
import exportRoutes from './routes/export.js';
import { getErrorMessage, sendApiError } from './lib/api-error.js';

interface CreateAppOptions {
  apiAccessKey?: string;
  allowMissingApiKey?: boolean;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

type RateLimitEntry = { count: number; resetAt: number };

function isPrivateNetworkOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return true;
    }

    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return false;
    }

    const [a, b] = host.split('.').map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

    return (a === 10)
      || (a === 192 && b === 168)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 169 && b === 254);
  } catch {
    return false;
  }
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const isDev = process.env.NODE_ENV !== 'production';

  const corsAllowlist = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);

  const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of configuredCorsOrigins) {
    corsAllowlist.add(origin);
  }

  const apiAccessKey = (options.apiAccessKey ?? process.env.API_ACCESS_KEY ?? '').trim();
  const allowMissingApiKey = options.allowMissingApiKey ?? true;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);
  const rateLimitMax = options.rateLimitMax ?? parsePositiveInt(process.env.RATE_LIMIT_MAX, 120);
  const rateLimitStore = new Map<string, RateLimitEntry>();
  let nextRateLimitCleanupAt = Date.now() + rateLimitWindowMs;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsAllowlist.has(origin)) {
          callback(null, true);
          return;
        }

        if (isDev && isPrivateNetworkOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  app.use('/api', (req, res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }

    const now = Date.now();
    if (now >= nextRateLimitCleanupAt) {
      for (const [key, entry] of rateLimitStore) {
        if (entry.resetAt <= now) {
          rateLimitStore.delete(key);
        }
      }
      nextRateLimitCleanupAt = now + rateLimitWindowMs;
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      next();
      return;
    }

    if (entry.count >= rateLimitMax) {
      sendApiError(res, 429, 'Too many requests', 'RATE_LIMIT_EXCEEDED');
      return;
    }

    entry.count += 1;
    next();
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }

    if (!apiAccessKey) {
      if (allowMissingApiKey) {
        next();
      } else {
        sendApiError(res, 503, 'API access key is not configured', 'API_KEY_NOT_CONFIGURED');
      }
      return;
    }

    if (req.header('x-api-key') === apiAccessKey) {
      next();
      return;
    }

    sendApiError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
  });

  app.use('/api/projects', projectRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/models', modelRoutes);
  app.use('/api/projects/:id/assets', assetRoutes);
  app.use('/api/projects/:id', generateRoutes);
  app.use('/api/projects/:id/shots', shotRoutes);
  app.use('/api/projects/:id', exportRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] Unhandled error:', err);
    const details = process.env.NODE_ENV === 'development'
      ? { message: getErrorMessage(err, 'Unknown error') }
      : undefined;
    sendApiError(res, 500, 'Internal server error', 'INTERNAL_SERVER_ERROR', details);
  });

  return app;
}
