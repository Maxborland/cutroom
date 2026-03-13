import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createLicensingRepository } from '../../server/lib/licensing/repository.js'
import { createLicensingService } from '../../server/lib/licensing/service.js'

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((filePath) => fs.rm(filePath, { force: true })))
})

function createTestApp(filePath = path.join(process.cwd(), 'data', `installation-state.${randomUUID()}.json`)) {
  tempPaths.push(filePath)

  const repository = createLicensingRepository({ filePath })
  const licensingService = createLicensingService(repository)

  return {
    app: createApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
      licensingService,
    }),
    repository,
    filePath,
  }
}

describe('System license API', () => {
  it('returns unactivated installation status on fresh system', async () => {
    const { app } = createTestApp()

    const res = await request(app).get('/api/system/license').expect(200)

    expect(res.body.status).toBe('unactivated')
    expect(res.body.trialDaysRemaining).toBeGreaterThanOrEqual(0)
    expect(res.body.restrictedMode).toBe(false)
    expect(res.body.lastCheckAt).toBeNull()
  })

  it('returns restricted mode when trial has expired', async () => {
    const { app, repository } = createTestApp()

    await repository.saveInstallationState({
      id: 'installation-state-1',
      installationId: 'install-test',
      tenantName: 'ООО Тест',
      licenseStatus: 'trial',
      trialStartedAt: '2026-02-01T00:00:00.000Z',
      trialEndsAt: '2026-03-01T00:00:00.000Z',
      activatedAt: null,
      lastLicenseCheckAt: '2026-03-01T00:00:00.000Z',
      graceEndsAt: null,
    })

    const res = await request(app).get('/api/system/license').expect(200)

    expect(res.body.status).toBe('trial_expired')
    expect(res.body.trialDaysRemaining).toBe(0)
    expect(res.body.restrictedMode).toBe(true)
    expect(res.body.lastCheckAt).toBe('2026-03-01T00:00:00.000Z')
  })
})
