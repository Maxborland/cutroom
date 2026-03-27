import { createRequire } from 'node:module'
import { inflateRawSync } from 'node:zlib'
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
void require

const ZIP_LOCAL_FILE_HEADER = 0x04034b50
const ZIP_CENTRAL_DIR_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50
const ZIP_STORE = 0
const ZIP_DEFLATE = 8

async function readZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) {
    throw new Error('Failed to locate ZIP central directory')
  }

  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const entries = new Map<string, Buffer>()

  let offset = centralDirectoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIR_HEADER) {
      throw new Error('Invalid ZIP central directory header')
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength)

    if (fileName.endsWith('/')) {
      entries.set(fileName, Buffer.alloc(0))
    } else {
      entries.set(
        fileName,
        readZipFileData(buffer, localHeaderOffset, compressedSize, compressionMethod),
      )
    }

    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIR) {
      return offset
    }
  }

  return -1
}

function readZipFileData(
  archive: Buffer,
  localHeaderOffset: number,
  compressedSize: number,
  compressionMethod: number,
): Buffer {
  if (archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error('Invalid ZIP local file header')
  }

  const fileNameLength = archive.readUInt16LE(localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(localHeaderOffset + 28)
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength
  const compressedData = archive.subarray(dataOffset, dataOffset + compressedSize)

  if (compressionMethod === ZIP_STORE) {
    return Buffer.from(compressedData)
  }

  if (compressionMethod === ZIP_DEFLATE) {
    return inflateRawSync(compressedData)
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`)
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
