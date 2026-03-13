import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { createDbForTest } from './setup.js'

describe('database bootstrap', () => {
  it('creates and closes a database pool from an explicit connection string', async () => {
    const connectionString = 'postgres://postgres:postgres@127.0.0.1:5432/cut_room_test'
    const db = createDbForTest(connectionString)

    expect(db).toBeInstanceOf(Pool)
    expect(db.options.connectionString).toBe(connectionString)
    expect(db.ended).toBe(false)

    await db.end()

    expect(db.ended).toBe(true)
  })
})
