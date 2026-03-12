import { describe, expect, it } from 'vitest'
import { healthcheckDb } from '../../server/db/index.js'
import { createDbForTest } from './setup.js'

describe('database bootstrap', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL

  it.skipIf(!testDatabaseUrl)('creates a database pool when TEST_DATABASE_URL is configured', async () => {
    const db = createDbForTest(testDatabaseUrl!)

    try {
      await expect(healthcheckDb(db)).resolves.toBe(true)
    } finally {
      await db.end()
    }
  })
})
