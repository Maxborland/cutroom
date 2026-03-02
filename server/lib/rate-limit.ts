/**
 * Simple in-memory sliding-window rate limiter.
 * No external dependencies — uses a Map of timestamps per key.
 */
import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  /** Max requests per window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

const stores = new Map<string, Map<string, number[]>>();

function getStore(name: string): Map<string, number[]> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

/**
 * Returns Express middleware that rate-limits by IP (or x-forwarded-for).
 * `name` scopes the counter so different routes don't share limits.
 */
export function rateLimit(name: string, opts: RateLimitOptions) {
  const { max, windowMs } = opts;
  const store = getStore(name);

  // Periodic cleanup every 60s to avoid memory leak
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        store.delete(key);
      } else {
        store.set(key, valid);
      }
    }
  }, 60_000);
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();

    let timestamps = store.get(ip);
    if (!timestamps) {
      timestamps = [];
      store.set(ip, timestamps);
    }

    // Remove expired entries
    const cutoff = now - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= max) {
      res.status(429).json({ error: 'Too many requests, please try again later' });
      return;
    }

    timestamps.push(now);
    next();
  };
}
