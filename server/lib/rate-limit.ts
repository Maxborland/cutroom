/**
 * Rate limiting middleware using express-rate-limit.
 * Recognized by CodeQL as a proper rate-limiting solution.
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Creates a rate limiter for file-system or mutation endpoints.
 * @param max - Max requests per window (default 60)
 * @param windowMs - Window in ms (default 60_000)
 */
export function createRateLimit(max = 60, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Support proxied deployments (x-forwarded-for) and direct connections.
      // Extract client IP, then normalize IPv6 via express-rate-limit helper.
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : (req.ip ?? '127.0.0.1');
      // ipKeyGenerator normalizes IPv6 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
      return ipKeyGenerator({ ip: clientIp } as any);
    },
    message: { error: 'Too many requests, please try again later' },
  });
}

/** Strict limiter for upload/mutation endpoints: 30 req/min */
export const mutationLimiter = createRateLimit(30, 60_000);

/** Standard limiter for read endpoints: 120 req/min */
export const readLimiter = createRateLimit(120, 60_000);

/** Generation limiter: 10 req/min (expensive operations) */
export const generationLimiter = createRateLimit(10, 60_000);
