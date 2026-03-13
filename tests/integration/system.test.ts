import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createLicensingRepository } from '../../server/lib/licensing/repository.js'
import { createLicensingService } from '../../server/lib/licensing/service.js'

function createFakeLicensingDb() {
  let state: any = null
  const queries: string[] = []

  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push(sql)

        if (sql.includes('SELECT') && sql.includes('FROM installation_state')) {
          return { rows: state ? [state] : [] }
        }

        if (sql.includes('INSERT INTO installation_state')) {
          const [
            id,
            installationId,
            tenantName,
            licenseStatus,
            trialStartedAt,
            trialEndsAt,
            activatedAt,
            lastLicenseCheckAt,
            graceEndsAt,
          ] = params as (string | null)[]

          state = {
            id,
            installation_id: installationId,
            tenant_name: tenantName,
            license_status: licenseStatus,
            trial_started_at: trialStartedAt,
            trial_ends_at: trialEndsAt,
            activated_at: activatedAt,
            last_license_check_at: lastLicenseCheckAt,
            grace_ends_at: graceEndsAt,
          }

          return { rows: [state] }
        }

        throw new Error(`Unexpected SQL in fake licensing db: ${sql}`)
      },
    },
    queries,
  }
}

function createTestApp() {
  const fake = createFakeLicensingDb()
  const repository = createLicensingRepository({ db: fake.db } as any)
  const licensingService = createLicensingService(repository)

  return {
    app: createApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
      licensingService,
    }),
    repository,
    queries: fake.queries,
  }
}

describe('System license API', () => {
  it('returns unactivated installation status on fresh system', async () => {
    const { app, queries } = createTestApp()

    const res = await request(app).get('/api/system/license').expect(200)

    expect(res.body.status).toBe('unactivated')
    expect(res.body.trialDaysRemaining).toBeGreaterThanOrEqual(0)
    expect(res.body.restrictedMode).toBe(false)
    expect(res.body.lastCheckAt).toBeNull()
    expect(queries.some((query) => query.includes('FROM installation_state'))).toBe(true)
  })

  it('returns restricted mode when trial has expired', async () => {
    const { app, repository, queries } = createTestApp()

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
    expect(queries.some((query) => query.includes('INSERT INTO installation_state'))).toBe(true)
    expect(queries.some((query) => query.includes('FROM installation_state'))).toBe(true)
  })
})
