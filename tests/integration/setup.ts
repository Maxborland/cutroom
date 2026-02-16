import express, { type Express } from 'express'
import cors from 'cors'
import projectRoutes from '../../server/routes/projects.js'
import settingsRoutes from '../../server/routes/settings.js'
import assetRoutes from '../../server/routes/assets.js'
import generateRoutes from '../../server/routes/generate.js'
import shotRoutes from '../../server/routes/shots.js'
import exportRoutes from '../../server/routes/export.js'

let _app: Express | null = null

export function createApp(): Express {
  if (_app) return _app

  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '50mb' }))

  app.use('/api/projects', projectRoutes)
  app.use('/api/settings', settingsRoutes)
  app.use('/api/projects/:id/assets', assetRoutes)
  app.use('/api/projects/:id', generateRoutes)
  app.use('/api/projects/:id/shots', shotRoutes)
  app.use('/api/projects/:id', exportRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  _app = app
  return app
}
