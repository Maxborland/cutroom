import { type Express } from 'express'
import { createApp as createServerApp } from '../../server/app.js'

export function createApp(): Express {
  return createServerApp({ allowMissingApiKey: true, apiAccessKey: '' })
}
