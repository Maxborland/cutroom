import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from './setup.js'
import {
  createProject,
  deleteProject,
  getProjectDir,
  saveProject,
  type Project,
} from '../../server/lib/storage.js'

const app = createApp()
const require = createRequire(import.meta.url)
const yauzl = require('yauzl') as {
  fromBuffer: (
    buffer: Buffer,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: {
      readEntry: () => void
      on: (event: string, handler: (...args: any[]) => void) => void
      openReadStream: (
        entry: { fileName: string },
        callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void
      ) => void
    }) => void,
  ) => void
}

async function readZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('Failed to open ZIP archive'))
        return
      }

      const entries = new Map<string, Buffer>()

      zipFile.on('entry', (entry: { fileName: string }) => {
        if (entry.fileName.endsWith('/')) {
          entries.set(entry.fileName, Buffer.alloc(0))
          zipFile.readEntry()
          return
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`Failed to read ZIP entry ${entry.fileName}`))
            return
          }

          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zipFile.readEntry()
          })
          stream.on('error', reject)
        })
      })

      zipFile.on('end', () => resolve(entries))
      zipFile.on('error', reject)
      zipFile.readEntry()
    })
  })
}

describe('Export API', () => {
  let project: Project

  beforeAll(async () => {
    project = await createProject('Export Test Project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        prompt: 'Aerial view of building at golden hour',
        durationSec: 5,
        status: 'approved',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      },
      {
        id: 'shot-002',
        order: 1,
        prompt: 'Interior walkthrough of the lobby',
        durationSec: 8,
        status: 'draft',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ]
    await saveProject(project)
  })

  afterAll(async () => {
    await deleteProject(project.id)
  })

  describe('GET /api/projects/:id/export', () => {
    it('should return a ZIP file', async () => {
      const res = await request(app)
        .get(`/api/projects/${project.id}/export`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => cb(null, Buffer.concat(chunks)))
        })
        .expect(200)

      expect(res.headers['content-type']).toMatch(/application\/zip/)
      expect(res.headers['content-disposition']).toMatch(/attachment/)
      expect(res.headers['content-disposition']).toContain('.zip')
      // ZIP files start with PK signature (0x504B)
      const body = res.body as Buffer
      expect(body[0]).toBe(0x50)
      expect(body[1]).toBe(0x4b)
    })

    it('does not export files referenced via traversal metadata', async () => {
      const secretPath = path.join(getProjectDir(project.id), 'secret.txt')
      await fs.writeFile(secretPath, 'top-secret-export-data')

      project.shots[0]!.generatedImages = ['../../../secret.txt']
      await saveProject(project)

      const res = await request(app)
        .get(`/api/projects/${project.id}/export`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => cb(null, Buffer.concat(chunks)))
        })
        .expect(200)

      const entries = await readZipEntries(res.body as Buffer)
      const leakedEntry = [...entries.entries()].find(([name, contents]) =>
        name.includes('secret.txt') || contents.toString('utf-8') === 'top-secret-export-data'
      )

      expect(leakedEntry).toBeUndefined()
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .get('/api/projects/fake-project-id/export')
        .expect(404)
    })
  })

  describe('GET /api/projects/:id/export/prompts', () => {
    it('should return plain text with shot prompts', async () => {
      const res = await request(app)
        .get(`/api/projects/${project.id}/export/prompts`)
        .expect(200)

      expect(res.headers['content-type']).toMatch(/text\/plain/)

      const text = res.text
      expect(text).toContain('Export Test Project')
      expect(text).toContain('Aerial view of building at golden hour')
      expect(text).toContain('Interior walkthrough of the lobby')
      expect(text).toContain('shot-001')
      expect(text).toContain('shot-002')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .get('/api/projects/fake-project-id/export/prompts')
        .expect(404)
    })
  })
})
