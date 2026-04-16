/**
 * Rate limiting middleware using express-rate-limit.
 * Recognized by CodeQL as a proper rate-limiting solution.
 */
import type { Request } from 'express';
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
    skip: (req) => process.env.NODE_ENV === 'test' && req.header('x-test-rate-limit') !== '1',
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown'),
    message: { error: 'Too many requests, please try again later' },
  });
}

/** Strict limiter for upload/mutation endpoints: 30 req/min */
export const mutationLimiter = createRateLimit(30, 60_000);

/** Standard limiter for read endpoints: 120 req/min */
export const readLimiter = createRateLimit(120, 60_000);

/** Generation limiter: 10 req/min (expensive operations) */
export const generationLimiter = createRateLimit(10, 60_000);
