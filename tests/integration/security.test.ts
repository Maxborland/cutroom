import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('Security middleware', () => {
  it('returns 503 when API key is required but not configured', async () => {
    const app = createApp({
      allowMissingApiKey: false,
      apiAccessKey: '',
    });

    const res = await request(app).get('/api/projects').expect(503);
    expect(res.body.error).toBe('API access key is not configured');
    expect(res.body.code).toBe('API_KEY_NOT_CONFIGURED');
  });

  it('returns 401 when API key is configured but missing from request', async () => {
    const app = createApp({
      allowMissingApiKey: false,
      apiAccessKey: 'test-secret',
    });

    const res = await request(app).get('/api/projects').expect(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('allows request when x-api-key matches configured key', async () => {
    const app = createApp({
      allowMissingApiKey: false,
      apiAccessKey: 'test-secret',
    });

    const res = await request(app)
      .get('/api/projects')
      .set('x-api-key', 'test-secret')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('defaults to requiring API key in production', async () => {
    await withEnv({ NODE_ENV: 'production' }, async () => {
      const app = createApp({ apiAccessKey: '' });
      await request(app).get('/api/projects').expect(503);
    });
  });
});
