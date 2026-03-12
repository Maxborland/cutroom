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

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

function createSingleMigrationPool() {
  const poolQueries: string[] = []
  const lockClientQueries: string[] = []
  const migrationClientQueries: string[] = []

  const lockClient: FakeClient = {
    query: vi.fn(async (sql: string) => {
      lockClientQueries.push(sql)

      if (sql.includes('SELECT pg_advisory_lock')) {
        return { rows: [] }
      }

      if (sql.includes('SELECT pg_advisory_unlock')) {
        return { rows: [{ unlocked: true }] }
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
    lockClientQueries,
    migrationClientQueries,
  }
}

function createSerializedMigrationPools() {
  const sharedState = {
    lockHeld: false,
    migrationApplied: false,
    waiters: [] as Array<() => void>,
  }
  const firstMigrationStarted = createDeferred()
  const releaseFirstMigration = createDeferred()

  function createPool(runLabel: 'first' | 'second') {
    const lockClientQueries: string[] = []
    const migrationClientQueries: string[] = []

    const lockClient: FakeClient = {
      query: vi.fn(async (sql: string) => {
        lockClientQueries.push(sql)

        if (sql.includes('SELECT pg_advisory_lock')) {
          if (sharedState.lockHeld) {
            await new Promise<void>((resolve) => {
              sharedState.waiters.push(resolve)
            })
          }

          sharedState.lockHeld = true
          return { rows: [] }
        }

        if (sql.includes('SELECT pg_advisory_unlock')) {
          sharedState.lockHeld = false
          const nextWaiter = sharedState.waiters.shift()
          nextWaiter?.()
          return { rows: [{ unlocked: true }] }
        }

        throw new Error(`Unexpected advisory-lock query: ${sql}`)
      }),
      release: vi.fn(),
    }

    const migrationClient: FakeClient = {
      query: vi.fn(async (sql: string) => {
        migrationClientQueries.push(sql)

        if (runLabel === 'first' && sql === 'CREATE TABLE app_metadata ();') {
          firstMigrationStarted.resolve()
          await releaseFirstMigration.promise
        }

        if (sql.includes('INSERT INTO schema_migrations')) {
          sharedState.migrationApplied = true
        }

        return { rows: [] }
      }),
      release: vi.fn(),
    }

    const pool: FakePool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
          return { rows: [] }
        }

        if (sql.includes('SELECT version FROM schema_migrations')) {
          return {
            rows: sharedState.migrationApplied ? [{ version: '0001_initial' }] : [],
          }
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
      lockClientQueries,
      migrationClientQueries,
    }
  }

  return {
    first: createPool('first'),
    second: createPool('second'),
    firstMigrationStarted,
    releaseFirstMigration,
  }
}

describe('db:migrate locking', () => {
  it('acquires and releases an advisory lock around migration execution', async () => {
    const state = createSingleMigrationPool()
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
    expect(state.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_lock'))).toBe(true)
    expect(state.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_unlock'))).toBe(true)
    expect(state.migrationClientQueries).toContain('BEGIN')
    expect(state.migrationClientQueries).toContain('CREATE TABLE app_metadata ();')
    expect(state.migrationClientQueries).toContain('COMMIT')
    expect(errorLog).not.toHaveBeenCalled()
    expect(state.pool.end).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight migrator, then reports no pending migrations on the second run', async () => {
    const state = createSerializedMigrationPools()
    const createDb = vi
      .fn()
      .mockImplementationOnce(() => state.first.pool)
      .mockImplementationOnce(() => state.second.pool)
    const firstLog = vi.fn()
    const secondLog = vi.fn()
    const firstErrorLog = vi.fn()
    const secondErrorLog = vi.fn()

    const firstRun = runMigrationCommand({
      checkOnly: false,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb,
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log: firstLog,
      errorLog: firstErrorLog,
    })

    await state.firstMigrationStarted.promise

    let secondFinished = false
    const secondRun = runMigrationCommand({
      checkOnly: false,
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test',
      createDb,
      healthcheckDb: vi.fn(async () => true),
      loadMigrations: vi.fn(async () => [
        { version: '0001_initial', sql: 'CREATE TABLE app_metadata ();' },
      ]),
      log: secondLog,
      errorLog: secondErrorLog,
    }).then((exitCode) => {
      secondFinished = true
      return exitCode
    })

    await Promise.resolve()
    expect(secondFinished).toBe(false)

    state.releaseFirstMigration.resolve()

    await expect(firstRun).resolves.toBe(0)
    await expect(secondRun).resolves.toBe(0)

    expect(state.first.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_lock'))).toBe(true)
    expect(state.second.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_lock'))).toBe(true)
    expect(state.first.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_unlock'))).toBe(true)
    expect(state.second.lockClientQueries.some((query) => query.includes('SELECT pg_advisory_unlock'))).toBe(true)
    expect(state.first.migrationClientQueries).toContain('CREATE TABLE app_metadata ();')
    expect(state.second.migrationClientQueries).toEqual([])
    expect(firstLog).toHaveBeenCalledWith('[db] Applying migration 0001_initial')
    expect(firstLog).toHaveBeenCalledWith('[db] Applied 1 migration(s).')
    expect(secondLog).toHaveBeenCalledWith('[db] No pending migrations.')
    expect(firstErrorLog).not.toHaveBeenCalled()
    expect(secondErrorLog).not.toHaveBeenCalled()
    expect(state.first.pool.end).toHaveBeenCalledTimes(1)
    expect(state.second.pool.end).toHaveBeenCalledTimes(1)
  })
})
