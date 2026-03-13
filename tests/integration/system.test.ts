import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createLicensingRepository } from '../../server/lib/licensing/repository.js'
import { createLicensingService } from '../../server/lib/licensing/service.js'

function createFakeLicensingDb() {
  let state: any = null
  const queries: string[] = []
  const paramsByQuery = new Map<string, unknown[]>()

  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push(sql)
        paramsByQuery.set(sql, params)

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
    paramsByQuery,
  }
}

function createTestApp(now = new Date('2026-03-15T00:00:00.000Z')) {
  const fake = createFakeLicensingDb()
  const repository = createLicensingRepository({ db: fake.db } as any)
  const licensingService = createLicensingService(repository, { now: () => now })

  return {
    app: createApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
      licensingService,
    }),
    repository,
    queries: fake.queries,
    paramsByQuery: fake.paramsByQuery,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../../server/db/index.js')
})

describe('System license API', () => {
  it('returns unactivated installation status on fresh system', async () => {
    const { app, queries } = createTestApp()

    const res = await request(app).get('/api/system/license').expect(200)

    expect(res.body.status).toBe('unactivated')
    expect(res.body.trialDaysRemaining).toBeGreaterThanOrEqual(0)
    expect(res.body.restrictedMode).toBe(false)
    expect(res.body.lastCheckAt).toBeNull()
    expect(queries.some((query) => query.includes('FROM installation_state'))).toBe(true)
    expect(queries.some((query) => query.includes('WHERE id = $1'))).toBe(true)
  })

  it('returns restricted mode when trial has expired', async () => {
    const { app, repository, queries, paramsByQuery } = createTestApp()

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
    expect(queries.some((query) => query.includes('WHERE id = $1'))).toBe(true)

    const insertQuery = queries.find((query) => query.includes('INSERT INTO installation_state'))
    expect(insertQuery).toBeTruthy()
    if (!insertQuery) return

    expect(paramsByQuery.get(insertQuery)?.[0]).toBe('installation')
  })

  it('creates the default licensing service only once across repeated requests', async () => {
    const createDbMock = vi.fn(() => ({
      query: vi.fn(async () => ({ rows: [] })),
    }))

    vi.doMock('../../server/db/index.js', () => ({
      createDb: createDbMock,
    }))

    const { createApp: createDefaultApp } = await import('../../server/app.js')
    const app = createDefaultApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
    })

    await request(app).get('/api/system/license').expect(200)
    await request(app).get('/api/system/license').expect(200)

    expect(createDbMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the default wiring path unactivated when database configuration is unavailable', async () => {
    vi.doMock('../../server/db/index.js', () => ({
      createDb: () => {
        throw new Error('DATABASE_URL is not configured')
      },
    }))

    const { createApp: createDefaultApp } = await import('../../server/app.js')
    const app = createDefaultApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
    })

    const res = await request(app).get('/api/system/license').expect(200)

    expect(res.body.status).toBe('unactivated')
    expect(res.body.restrictedMode).toBe(false)
    expect(res.body.lastCheckAt).toBeNull()
  })
})
