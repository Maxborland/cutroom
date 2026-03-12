import { describe, expect, it, vi } from 'vitest'
import { runMigrationCommand } from '../../server/db/migrate.js'

type FakePool = {
  connect: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
}

function createFakePool(appliedVersions: string[]): { pool: FakePool; queries: string[] } {
  const queries: string[] = []

  const pool: FakePool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql)

      if (sql.includes('SELECT version FROM schema_migrations')) {
        return {
          rows: appliedVersions.map((version) => ({ version })),
        }
      }

      throw new Error(`Unexpected query in check mode: ${sql}`)
    }),
    connect: vi.fn(),
    end: vi.fn(async () => undefined),
  }

  return { pool, queries }
}

describe('db:check contract', () => {
  it('returns exit code 1 when DATABASE_URL is not configured', async () => {
    const createDbMock = vi.fn()
    const log = vi.fn()
    const errorLog = vi.fn()

    const exitCode = await runMigrationCommand({
      checkOnly: true,
      connectionString: '',
      createDb: createDbMock,
      log,
      errorLog,
    })

    expect(exitCode).toBe(1)
    expect(createDbMock).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalledWith('[db] Migration command failed: DATABASE_URL is not configured')
    expect(log).not.toHaveBeenCalled()
  })

  it('returns exit code 1 when tracked migrations are still pending', async () => {
    const { pool, queries } = createFakePool([])
    const log = vi.fn()
    const errorLog = vi.fn()

    const exitCode = await runMigrationCommand({
      checkOnly: true,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb: vi.fn(() => pool),
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log,
      errorLog,
    })

    expect(exitCode).toBe(1)
    expect(errorLog).toHaveBeenCalledWith(
      '[db] Migration command failed: pending migrations detected (1): 0001_initial',
    )
    expect(log).not.toHaveBeenCalled()
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(false)
    expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('returns exit code 0 when all tracked migrations are already applied', async () => {
    const { pool, queries } = createFakePool(['0001_initial'])
    const log = vi.fn()
    const errorLog = vi.fn()

    const exitCode = await runMigrationCommand({
      checkOnly: true,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb: vi.fn(() => pool),
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log,
      errorLog,
    })

    expect(exitCode).toBe(0)
    expect(log).toHaveBeenCalledWith('[db] Migration status: ok (1 applied, 0 pending).')
    expect(errorLog).not.toHaveBeenCalled()
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(false)
    expect(pool.end).toHaveBeenCalledTimes(1)
  })
})
