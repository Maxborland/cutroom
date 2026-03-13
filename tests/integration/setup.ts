import { type Express } from 'express'
import { createApp as createServerApp } from '../../server/app.js'
import { createDb } from '../../server/db/index.js'

export function createApp(): Express {
  return createServerApp({ allowMissingApiKey: true, apiAccessKey: '' })
}

export function createDbForTest(connectionString: string) {
  return createDb(connectionString)
}
