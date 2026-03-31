import { type Express } from 'express'
import { createApp as createServerApp } from '../../server/app.js'
import { createDb } from '../../server/db/index.js'

type TestCreateAppOptions = {
  enableLegacyMontageRender?: boolean
}

export function createApp(options: TestCreateAppOptions = {}): Express {
  return createServerApp({
    allowMissingApiKey: true,
    apiAccessKey: '',
    enableLegacyMontageRender: options.enableLegacyMontageRender,
  })
}

export function createDbForTest(connectionString: string) {
  return createDb(connectionString)
}
