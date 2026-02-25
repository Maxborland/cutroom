import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';

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
});
