import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from './setup.js'

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')

describe('Settings API', () => {
  let originalSettings: string | null = null

  beforeAll(async () => {
    try {
      originalSettings = await fs.readFile(SETTINGS_PATH, 'utf-8')
    } catch {
      originalSettings = null
    }
  })

  afterAll(async () => {
    if (originalSettings !== null) {
      await fs.writeFile(SETTINGS_PATH, originalSettings, 'utf-8')
    } else {
      try {
        await fs.unlink(SETTINGS_PATH)
      } catch {
        // ignore
      }
    }
  })

  describe('GET /api/settings', () => {
    it('should return settings with masked API key', async () => {
      const res = await request(app)
        .get('/api/settings')
        .expect(200)

      expect(res.body).toHaveProperty('openRouterApiKey')
      const key = res.body.openRouterApiKey
      expect(typeof key).toBe('string')
    })
  })

  describe('PUT /api/settings', () => {
    it('should update settings and mask key in response', async () => {
      const res = await request(app)
        .put('/api/settings')
        .send({ openRouterApiKey: 'sk-test-key-123456' })
        .expect(200)

      expect(res.body.openRouterApiKey).toBe('••••3456')
    })

    it('should preserve existing key when masked value is sent back', async () => {
      await request(app)
        .put('/api/settings')
        .send({ openRouterApiKey: 'sk-real-secret-key-abcd' })

      const res = await request(app)
        .put('/api/settings')
        .send({ openRouterApiKey: '••••abcd' })
        .expect(200)

      expect(res.body.openRouterApiKey).toBe('••••abcd')

      const raw = await fs.readFile(SETTINGS_PATH, 'utf-8')
      const settings = JSON.parse(raw)
      expect(settings.openRouterApiKey).toBe('sk-real-secret-key-abcd')
    })

    it('should allow updating other known settings alongside key', async () => {
      await request(app)
        .put('/api/settings')
        .send({ openRouterApiKey: 'sk-another-key-9999' })

      const res = await request(app)
        .put('/api/settings')
        .send({ openRouterApiKey: '••••9999', defaultMusicStyle: 'cinematic' })
        .expect(200)

      expect(res.body.defaultMusicStyle).toBe('cinematic')
      expect(res.body.openRouterApiKey).toBe('••••9999')
    })

    it('should reject unknown setting keys with 400', async () => {
      const res = await request(app)
        .put('/api/settings')
        .send({ customSetting: 'hello', anotherUnknown: 42 })
        .expect(400)

      expect(res.body.code).toBe('SETTINGS_INVALID')
      expect(res.body.error).toMatch(/unknown key/)
    })

    it('should reject wrong type for numeric setting', async () => {
      const res = await request(app)
        .put('/api/settings')
        .send({ remotionConcurrency: 'not-a-number' })
        .expect(400)

      expect(res.body.code).toBe('SETTINGS_INVALID')
    })
  })
})

