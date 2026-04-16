import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const eocdOffset = buffer.lastIndexOf(eocdSignature)
  if (eocdOffset < 0) {
    throw new Error('End of central directory not found')
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory header at offset ${offset}`)
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const filenameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength)

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    })

    offset += 46 + filenameLength + extraLength + commentLength
  }

  return entries
}

function readZipText(buffer: Buffer, entry: ZipEntry): string {
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid local file header at offset ${offset}`)
  }

  const filenameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataOffset = offset + 30 + filenameLength + extraLength
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)

  if (entry.compressionMethod === 0) {
    return compressed.toString('utf8')
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed).toString('utf8')
  }

  throw new Error(`Unsupported compression method: ${entry.compressionMethod}`)
}

function createFakeCompositeDb() {
  const projectRows = new Map<string, Record<string, unknown>>()
  const jobRows = new Map<string, Record<string, unknown>>()
  const queries: string[] = []

  return {
    queries,
    db: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push(sql)

        if (sql.includes('INSERT INTO projects')) {
          const [id, name, createdAt, updatedAt, stage, payload] = params as [
            string,
            string,
            string,
            string,
            string,
            Record<string, unknown>,
          ]
          const row: Record<string, unknown> = {
            id,
            name,
            created_at: projectRows.get(id)?.created_at ?? createdAt,
            updated_at: updatedAt,
            stage,
            payload,
          }
          projectRows.set(id, row)
          return { rows: [row] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('WHERE id = $1')) {
          const row = projectRows.get(params[0] as string)
          return { rows: row ? [row] : [] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('ORDER BY created_at DESC')) {
          return { rows: [...projectRows.values()] }
        }

        if (sql.includes('DELETE FROM projects')) {
          projectRows.delete(params[0] as string)
          return { rowCount: 1, rows: [] }
        }

        if (sql.includes('INSERT INTO background_jobs')) {
          const [id, projectId, jobType, status, payload] = params as [
            string,
            string,
            string,
            string,
            Record<string, unknown>,
          ]
          const row: Record<string, unknown> = {
            id,
            project_id: projectId,
            job_type: jobType,
            status,
            payload,
            result: null,
            error_message: null,
            attempts: 0,
            created_at: '2026-03-13T00:00:00.000Z',
            updated_at: '2026-03-13T00:00:00.000Z',
            started_at: null,
            completed_at: null,
            claimed_by: null,
            claimed_at: null,
          }
          jobRows.set(id, row)
          return { rows: [row] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM background_jobs') && sql.includes('WHERE id = $1')) {
          const row = jobRows.get(params[0] as string)
          return { rows: row ? [row] : [] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'running'")) {
          const [jobType, workerId] = params as [string, string]
          const row = [...jobRows.values()]
            .filter((candidate) => candidate.job_type === jobType && candidate.status === 'queued')
            .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))[0]

          if (!row) {
            return { rows: [] }
          }

          row.status = 'running'
          row.attempts = Number(row.attempts ?? 0) + 1
          row.claimed_by = workerId
          row.claimed_at = '2026-03-13T00:01:00.000Z'
          row.started_at = row.started_at ?? row.claimed_at
          row.updated_at = row.claimed_at
          jobRows.set(String(row.id), row)
          return { rows: [row] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'done'")) {
          const [jobId, result] = params as [string, Record<string, unknown>]
          const row = jobRows.get(jobId)
          if (!row) {
            return { rows: [] }
          }

          row.status = 'done'
          row.result = result
          row.error_message = null
          row.completed_at = '2026-03-13T00:02:00.000Z'
          row.updated_at = row.completed_at
          jobRows.set(jobId, row)
          return { rows: [row] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'failed'")) {
          const [jobId, errorMessage] = params as [string, string]
          const row = jobRows.get(jobId)
          if (!row) {
            return { rows: [] }
          }

          row.status = 'failed'
          row.error_message = errorMessage
          row.completed_at = '2026-03-13T00:02:00.000Z'
          row.updated_at = row.completed_at
          jobRows.set(jobId, row)
          return { rows: [row] }
        }

        throw new Error(`Unexpected SQL in fake composite db: ${sql}`)
      }),
    },
  }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.doUnmock('../../server/db/index.js')
})

describe('export durable jobs', () => {
  it('packages external-edit exports with final full-res photos, separate audio, and no intermediate folders', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { appendProjectArchiveEntries } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('External edit export package project')

    project.voiceoverFile = 'montage/voiceover.mp3'
    project.musicFile = 'montage/music.mp3'
    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Facade',
        audioDescription: 'Wide establishing shot',
        imagePrompt: 'hero shot',
        videoPrompt: 'push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png', 'generated-b.png'],
        enhancedImages: ['enhanced-a.png', 'enhanced-b.png'],
        selectedImage: null,
        videoFile: 'clip.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const videoDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'video')
    const referenceDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'reference')
    const montageDir = storage.resolveProjectPath(project.id, 'montage')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(videoDir, { recursive: true })
    await fs.mkdir(referenceDir, { recursive: true })
    await fs.mkdir(montageDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'generated-a.png'), 'generated-a')
    await fs.writeFile(path.join(generatedDir, 'generated-b.png'), 'generated-b')
    await fs.writeFile(path.join(generatedDir, 'enhanced-a.png'), 'enhanced-a')
    await fs.writeFile(path.join(generatedDir, 'enhanced-b.png'), 'enhanced-b')
    await fs.writeFile(path.join(videoDir, 'clip.mp4'), 'video-bytes')
    await fs.writeFile(path.join(referenceDir, 'reference.png'), 'reference-bytes')
    await fs.writeFile(path.join(montageDir, 'voiceover.mp3'), 'voiceover-bytes')
    await fs.writeFile(path.join(montageDir, 'music.mp3'), 'music-bytes')

    const entries: Array<{ kind: 'append' | 'file'; name: string; content?: string; filePath?: string }> = []
    const archive = {
      append: vi.fn((content: unknown, options: { name: string }) => {
        entries.push({ kind: 'append', name: options.name, content: String(content) })
      }),
      file: vi.fn((filePath: string, options: { name: string }) => {
        entries.push({ kind: 'file', name: options.name, filePath })
      }),
      pipe: vi.fn(),
      on: vi.fn(),
    } as never

    await appendProjectArchiveEntries(archive, project.id)

    const names = entries.map((entry) => entry.name)
    const metadataEntry = entries.find((entry) => entry.name === 'metadata.json' && entry.kind === 'append')
    const metadata = JSON.parse(String(metadataEntry?.content ?? '{}')) as {
      exportType?: string
      shots?: Array<{ id: string; promptPath: string; photoPath: string | null; videoPath: string | null; missingAssets: string[] }>
      audio?: { voiceoverPath: string | null; musicPath: string | null; missingAssets: string[] }
    }

    expect(names).toContain('metadata.json')
    expect(names).toContain('prompts/01_shot-001.txt')
    expect(names).toContain('shots/01_shot-001/photo/01_facade.png')
    expect(names).toContain('shots/01_shot-001/video/01_facade.mp4')
    expect(names).toContain('audio/voiceover.mp3')
    expect(names).toContain('audio/music.mp3')
    expect(names).not.toEqual(expect.arrayContaining(['images/generated-a.png', 'reference/reference.png']))
    expect(names.some((name) => name.includes('/images/'))).toBe(false)
    expect(names.some((name) => name.includes('/reference/'))).toBe(false)
    expect(metadata.exportType).toBe('external-edit-package')
    expect(metadata.shots).toEqual([
      expect.objectContaining({
        id: 'shot-001',
        promptPath: 'prompts/01_shot-001.txt',
        photoPath: 'shots/01_shot-001/photo/01_facade.png',
        videoPath: 'shots/01_shot-001/video/01_facade.mp4',
        missingAssets: [],
      }),
    ])
    expect(metadata.audio).toEqual({
      voiceoverPath: 'audio/voiceover.mp3',
      musicPath: 'audio/music.mp3',
      missingAssets: [],
    })

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('uses shot order and a truncated scene slug for exported photo and video filenames', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { appendProjectArchiveEntries } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('Friendly export names project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Scene 3 - Waterfront promenade, young couple walking at dawn with reflective water and skyline',
        audioDescription: '',
        imagePrompt: 'hero shot',
        videoPrompt: 'slow push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png'],
        enhancedImages: ['enhanced-a.png'],
        selectedImage: null,
        videoFile: 'vid_1774673601233.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const videoDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'video')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(videoDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'enhanced-a.png'), 'enhanced-a')
    await fs.writeFile(path.join(videoDir, 'vid_1774673601233.mp4'), 'video-bytes')

    const entries: Array<{ kind: 'append' | 'file'; name: string; content?: string; filePath?: string }> = []
    const archive = {
      append: vi.fn((content: unknown, options: { name: string }) => {
        entries.push({ kind: 'append', name: options.name, content: String(content) })
      }),
      file: vi.fn((filePath: string, options: { name: string }) => {
        entries.push({ kind: 'file', name: options.name, filePath })
      }),
      pipe: vi.fn(),
      on: vi.fn(),
    } as never

    await appendProjectArchiveEntries(archive, project.id)

    const expectedBase = '01_scene-3-waterfront-promenade-young-couple-walking'
    const names = entries.map((entry) => entry.name)
    const metadataEntry = entries.find((entry) => entry.name === 'metadata.json' && entry.kind === 'append')
    const metadata = JSON.parse(String(metadataEntry?.content ?? '{}')) as {
      shots?: Array<{ photoPath?: string | null; videoPath?: string | null }>
    }

    expect(names).toContain(`shots/01_shot-001/photo/${expectedBase}.png`)
    expect(names).toContain(`shots/01_shot-001/video/${expectedBase}.mp4`)
    expect(names).not.toContain('shots/01_shot-001/photo/final.png')
    expect(names).not.toContain('shots/01_shot-001/video/vid_1774673601233.mp4')
    expect(metadata.shots?.[0]).toMatchObject({
      photoPath: `shots/01_shot-001/photo/${expectedBase}.png`,
      videoPath: `shots/01_shot-001/video/${expectedBase}.mp4`,
    })

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('transliterates Cyrillic shot titles for exported filenames', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { appendProjectArchiveEntries } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('Cyrillic export names project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Ночной двор',
        audioDescription: '',
        imagePrompt: 'hero shot',
        videoPrompt: 'slow push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png'],
        enhancedImages: ['enhanced-a.png'],
        selectedImage: null,
        videoFile: 'vid_1774673601233.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const videoDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'video')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(videoDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'enhanced-a.png'), 'enhanced-a')
    await fs.writeFile(path.join(videoDir, 'vid_1774673601233.mp4'), 'video-bytes')

    const entries: Array<{ kind: 'append' | 'file'; name: string; content?: string; filePath?: string }> = []
    const archive = {
      append: vi.fn((content: unknown, options: { name: string }) => {
        entries.push({ kind: 'append', name: options.name, content: String(content) })
      }),
      file: vi.fn((filePath: string, options: { name: string }) => {
        entries.push({ kind: 'file', name: options.name, filePath })
      }),
      pipe: vi.fn(),
      on: vi.fn(),
    } as never

    await appendProjectArchiveEntries(archive, project.id)

    const expectedBase = '01_nochnoy-dvor'
    const names = entries.map((entry) => entry.name)
    const metadataEntry = entries.find((entry) => entry.name === 'metadata.json' && entry.kind === 'append')
    const metadata = JSON.parse(String(metadataEntry?.content ?? '{}')) as {
      shots?: Array<{ photoPath?: string | null; videoPath?: string | null }>
    }

    expect(names).toContain(`shots/01_shot-001/photo/${expectedBase}.png`)
    expect(names).toContain(`shots/01_shot-001/video/${expectedBase}.mp4`)
    expect(names).not.toContain('shots/01_shot-001/photo/01_shot.png')
    expect(names).not.toContain('shots/01_shot-001/video/01_shot.mp4')
    expect(metadata.shots?.[0]).toMatchObject({
      photoPath: `shots/01_shot-001/photo/${expectedBase}.png`,
      videoPath: `shots/01_shot-001/video/${expectedBase}.mp4`,
    })

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('falls back to shot when the scene title has no slug-safe characters', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { appendProjectArchiveEntries } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('Fallback export names project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: '!!!   ???',
        audioDescription: '',
        imagePrompt: 'hero shot',
        videoPrompt: 'slow push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png'],
        enhancedImages: ['enhanced-a.png'],
        selectedImage: null,
        videoFile: 'vid_1774673601233.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const videoDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'video')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(videoDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'enhanced-a.png'), 'enhanced-a')
    await fs.writeFile(path.join(videoDir, 'vid_1774673601233.mp4'), 'video-bytes')

    const entries: Array<{ kind: 'append' | 'file'; name: string; content?: string; filePath?: string }> = []
    const archive = {
      append: vi.fn((content: unknown, options: { name: string }) => {
        entries.push({ kind: 'append', name: options.name, content: String(content) })
      }),
      file: vi.fn((filePath: string, options: { name: string }) => {
        entries.push({ kind: 'file', name: options.name, filePath })
      }),
      pipe: vi.fn(),
      on: vi.fn(),
    } as never

    await appendProjectArchiveEntries(archive, project.id)

    const expectedBase = '01_shot'
    const names = entries.map((entry) => entry.name)
    const metadataEntry = entries.find((entry) => entry.name === 'metadata.json' && entry.kind === 'append')
    const metadata = JSON.parse(String(metadataEntry?.content ?? '{}')) as {
      shots?: Array<{ photoPath?: string | null; videoPath?: string | null }>
    }

    expect(names).toContain(`shots/01_shot-001/photo/${expectedBase}.png`)
    expect(names).toContain(`shots/01_shot-001/video/${expectedBase}.mp4`)
    expect(metadata.shots?.[0]).toMatchObject({
      photoPath: `shots/01_shot-001/photo/${expectedBase}.png`,
      videoPath: `shots/01_shot-001/video/${expectedBase}.mp4`,
    })

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('skips unreadable or external media while preserving best-effort metadata', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { appendProjectArchiveEntries } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('External edit export missing media project')

    project.voiceoverFile = 'https://cdn.example.com/voiceover.mp3'
    project.musicFile = 'montage/music.mp3'
    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Facade',
        audioDescription: '',
        imagePrompt: 'hero shot',
        videoPrompt: 'push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png'],
        enhancedImages: ['missing-enhanced.png'],
        selectedImage: null,
        videoFile: 'https://cdn.example.com/clip.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const montageDir = storage.resolveProjectPath(project.id, 'montage')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(montageDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'generated-a.png'), 'generated-a')
    await fs.writeFile(path.join(montageDir, 'music.mp3'), 'music-bytes')

    const entries: Array<{ kind: 'append' | 'file'; name: string; content?: string; filePath?: string }> = []
    const archive = {
      append: vi.fn((content: unknown, options: { name: string }) => {
        entries.push({ kind: 'append', name: options.name, content: String(content) })
      }),
      file: vi.fn((filePath: string, options: { name: string }) => {
        entries.push({ kind: 'file', name: options.name, filePath })
      }),
      pipe: vi.fn(),
      on: vi.fn(),
    } as never

    await appendProjectArchiveEntries(archive, project.id)

    const names = entries.map((entry) => entry.name)
    const metadataEntry = entries.find((entry) => entry.name === 'metadata.json' && entry.kind === 'append')
    const metadata = JSON.parse(String(metadataEntry?.content ?? '{}')) as {
      shots?: Array<{ photoPath: string | null; videoPath: string | null; missingAssets: string[] }>
      audio?: { voiceoverPath: string | null; musicPath: string | null; missingAssets: string[] }
    }

    expect(names).toContain('shots/01_shot-001/photo/01_facade.png')
    expect(names).not.toContain('shots/01_shot-001/video/01_facade.mp4')
    expect(names).not.toContain('audio/voiceover.mp3')
    expect(names).toContain('audio/music.mp3')
    expect(metadata.shots?.[0]).toMatchObject({
      photoPath: 'shots/01_shot-001/photo/01_facade.png',
      videoPath: null,
      missingAssets: ['video'],
    })
    expect(metadata.audio).toEqual({
      voiceoverPath: null,
      musicPath: 'audio/music.mp3',
      missingAssets: ['voiceover'],
    })

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('enqueues a queued export job and writes the archive during worker execution', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const exportJobs = await import('../../server/lib/jobs/export.js')
    const project = await storage.createProject('Export queue project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Facade',
        audioDescription: '',
        imagePrompt: 'hero shot',
        videoPrompt: 'push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: [],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ]
    await storage.saveProject(project)

    const jobId = await exportJobs.enqueueExportJob(project.id)
    const processed = await exportJobs.runNextExportJob('export-worker-a')
    const job = await exportJobs.getExportJob(jobId)

    expect(jobId).toMatch(/^export-/)
    expect(processed).toBe(true)
    expect(job?.status).toBe('done')
    expect(job?.result).toEqual(
      expect.objectContaining({
        outputFile: expect.stringMatching(/^montage\/exports\/export-\d+-[0-9a-f-]+\.zip$/),
      }),
    )

    const outputFile = String((job?.result as { outputFile?: string } | null)?.outputFile ?? '')
    const outputPath = storage.resolveProjectPath(project.id, outputFile)
    const stat = await fs.stat(outputPath)
    expect(stat.isFile()).toBe(true)
    const archiveBuffer = await fs.readFile(outputPath)
    const entries = listZipEntries(archiveBuffer)
    expect(entries.map((entry) => entry.name)).toContain('metadata.json')
    expect(fake.queries.some((sql) => sql.includes("job_type = 'export'") || sql.includes('job_type = $1'))).toBe(true)

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('generates collision-resistant export job ids when requests land in the same millisecond', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_741_824_000_000)
    const storage = await import('../../server/lib/storage.js')
    const exportJobs = await import('../../server/lib/jobs/export.js')
    const project = await storage.createProject('Export collision project')

    try {
      const [firstJobId, secondJobId] = await Promise.all([
        exportJobs.enqueueExportJob(project.id),
        exportJobs.enqueueExportJob(project.id),
      ])

      expect(firstJobId).toMatch(/^export-/)
      expect(secondJobId).toMatch(/^export-/)
      expect(firstJobId).not.toBe(secondJobId)
    } finally {
      nowSpy.mockRestore()
      await storage.deleteProject(project.id)
      await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
    }
  })

  it('writes a real zip with archive-oriented metadata and final media paths', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { writeProjectArchive } = await import('../../server/lib/export-archive.js')
    const project = await storage.createProject('Real zip export package project')

    project.voiceoverFile = 'montage/voiceover.mp3'
    project.musicFile = 'montage/music.mp3'
    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Facade',
        audioDescription: 'Wide establishing shot',
        imagePrompt: 'hero shot',
        videoPrompt: 'push in',
        duration: 4,
        assetRefs: [],
        status: 'approved',
        generatedImages: ['generated-a.png'],
        enhancedImages: ['enhanced-a.png'],
        selectedImage: null,
        videoFile: 'clip.mp4',
      },
    ]
    await storage.saveProject(project)

    const generatedDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'generated')
    const videoDir = storage.resolveProjectPath(project.id, 'shots', 'shot-001', 'video')
    const montageDir = storage.resolveProjectPath(project.id, 'montage')

    await fs.mkdir(generatedDir, { recursive: true })
    await fs.mkdir(videoDir, { recursive: true })
    await fs.mkdir(montageDir, { recursive: true })

    await fs.writeFile(path.join(generatedDir, 'generated-a.png'), 'generated-a')
    await fs.writeFile(path.join(generatedDir, 'enhanced-a.png'), 'enhanced-a')
    await fs.writeFile(path.join(videoDir, 'clip.mp4'), 'video-bytes')
    await fs.writeFile(path.join(montageDir, 'voiceover.mp3'), 'voiceover-bytes')
    await fs.writeFile(path.join(montageDir, 'music.mp3'), 'music-bytes')

    try {
      const outputFile = await writeProjectArchive(project.id, 'real-export.zip')
      const outputPath = storage.resolveProjectPath(project.id, outputFile)
      const archiveBuffer = await fs.readFile(outputPath)
      const entries = listZipEntries(archiveBuffer)
      const names = entries.map((entry) => entry.name)
      const metadataEntry = entries.find((entry) => entry.name === 'metadata.json')
      const metadata = JSON.parse(readZipText(archiveBuffer, metadataEntry!)) as {
        exportType?: string
        shots?: Array<{ photoPath?: string; videoPath?: string }>
        audio?: { voiceoverPath?: string; musicPath?: string }
      }

      expect(names).toEqual(expect.arrayContaining([
        'metadata.json',
        'prompts/01_shot-001.txt',
        'shots/01_shot-001/photo/01_facade.png',
        'shots/01_shot-001/video/01_facade.mp4',
        'audio/voiceover.mp3',
        'audio/music.mp3',
      ]))
      expect(metadata.exportType).toBe('external-edit-package')
      expect(metadata.shots?.[0]).toMatchObject({
        photoPath: 'shots/01_shot-001/photo/01_facade.png',
        videoPath: 'shots/01_shot-001/video/01_facade.mp4',
      })
      expect(metadata.audio).toMatchObject({
        voiceoverPath: 'audio/voiceover.mp3',
        musicPath: 'audio/music.mp3',
      })
    } finally {
      await storage.deleteProject(project.id)
      await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
    }
  })
})
