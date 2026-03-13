import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'

const tempDirs: string[] = []

async function createStaticBundleFixture(): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'cutroom-static-'))
  tempDirs.push(baseDir)

  await mkdir(path.join(baseDir, 'assets'), { recursive: true })
  await writeFile(
    path.join(baseDir, 'index.html'),
    '<!doctype html><html><body><div id="root">CutRoom Self Hosted</div></body></html>',
    'utf8',
  )
  await writeFile(path.join(baseDir, 'assets', 'app.js'), 'console.log("cutroom")', 'utf8')

  return baseDir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('Self-hosted static delivery', () => {
  it('serves index.html for root and client-side routes when a client bundle is configured', async () => {
    const clientDistDir = await createStaticBundleFixture()
    const app = createApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
      clientDistDir,
    })

    const rootResponse = await request(app)
      .get('/')
      .expect(200)

    expect(rootResponse.text).toContain('CutRoom Self Hosted')

    const clientRouteResponse = await request(app)
      .get('/settings/license')
      .expect(200)

    expect(clientRouteResponse.text).toContain('CutRoom Self Hosted')
  })

  it('allows same-origin api requests when the self-hosted bundle is served from the same app origin', async () => {
    const clientDistDir = await createStaticBundleFixture()
    const app = createApp({
      allowMissingApiKey: true,
      apiAccessKey: '',
      bootstrapSetupToken: '',
      clientDistDir,
    })

    const response = await request(app)
      .options('/api/users/bootstrap-owner-invite')
      .set('Host', 'cutroom.example')
      .set('Origin', 'http://cutroom.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)

    expect(response.headers['access-control-allow-origin']).toBe('http://cutroom.example')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })
})
