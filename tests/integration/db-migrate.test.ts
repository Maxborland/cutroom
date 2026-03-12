import { describe, expect, it, vi } from 'vitest'
import { runMigrationCommand } from '../../server/db/migrate.js'

type FakePool = {
  connect: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
}

type FakeClient = {
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
}

function createMigrationPool(options: { advisoryLockAvailable: boolean }) {
  const poolQueries: string[] = []
  const lockClientQueries: string[] = []
  const migrationClientQueries: string[] = []

  const lockClient: FakeClient = {
    query: vi.fn(async (sql: string) => {
      lockClientQueries.push(sql)

      if (sql.includes('SELECT pg_try_advisory_lock')) {
        return {
          rows: [{ locked: options.advisoryLockAvailable }],
        }
      }

      if (sql.includes('SELECT pg_advisory_unlock')) {
        return {
          rows: [{ unlocked: true }],
        }
      }

      throw new Error(`Unexpected advisory-lock query: ${sql}`)
    }),
    release: vi.fn(),
  }

  const migrationClient: FakeClient = {
    query: vi.fn(async (sql: string) => {
      migrationClientQueries.push(sql)
      return { rows: [] }
    }),
    release: vi.fn(),
  }

  const pool: FakePool = {
    query: vi.fn(async (sql: string) => {
      poolQueries.push(sql)

      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] }
      }

      if (sql.includes('SELECT version FROM schema_migrations')) {
        return { rows: [] }
      }

      throw new Error(`Unexpected pool query: ${sql}`)
    }),
    connect: vi
      .fn()
      .mockResolvedValueOnce(lockClient)
      .mockResolvedValueOnce(migrationClient),
    end: vi.fn(async () => undefined),
  }

  return {
    pool,
    poolQueries,
    lockClient,
    lockClientQueries,
    migrationClient,
    migrationClientQueries,
  }
}

describe('db:migrate locking', () => {
  it('acquires and releases an advisory lock around migration execution', async () => {
    const state = createMigrationPool({ advisoryLockAvailable: true })
    const log = vi.fn()
    const errorLog = vi.fn()

    const exitCode = await runMigrationCommand({
      checkOnly: false,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb: vi.fn(() => state.pool),
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log,
      errorLog,
    })

    expect(exitCode).toBe(0)
    expect(state.lockClientQueries.some((query) => query.includes('SELECT pg_try_advisory_lock'))).toBe(true)
    expect(state.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_unlock'))).toBe(true)
    expect(state.migrationClientQueries).toContain('BEGIN')
    expect(state.migrationClientQueries).toContain('CREATE TABLE app_metadata ();')
    expect(state.migrationClientQueries).toContain('COMMIT')
    expect(errorLog).not.toHaveBeenCalled()
    expect(state.pool.end).toHaveBeenCalledTimes(1)
  })

  it('fails before running migration statements when the advisory lock is already held', async () => {
    const state = createMigrationPool({ advisoryLockAvailable: false })
    const log = vi.fn()
    const errorLog = vi.fn()

    const exitCode = await runMigrationCommand({
      checkOnly: false,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb: vi.fn(() => state.pool),
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log,
      errorLog,
    })

    expect(exitCode).toBe(1)
    expect(errorLog).toHaveBeenCalledWith(
      '[db] Migration command failed: another migration process is already running',
    )
    expect(state.lockClientQueries.some((query) => query.includes('SELECT pg_try_advisory_lock'))).toBe(true)
    expect(state.migrationClientQueries).toEqual([])
    expect(log).not.toHaveBeenCalled()
    expect(state.pool.end).toHaveBeenCalledTimes(1)
  })
})
