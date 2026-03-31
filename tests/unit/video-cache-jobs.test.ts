import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const originalFetch = global.fetch

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
  global.fetch = originalFetch
  delete process.env.VIDEO_DOWNLOAD_MAX_BYTES
})

describe('video-cache durable jobs', () => {
  it('enqueues a background cache job when an external video URL needs local caching', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const videoCache = await import('../../server/lib/jobs/video-cache.js')

    const jobId = await videoCache.enqueueVideoCacheJob({
      projectId: 'project-123',
      shotId: 'shot-001',
      externalUrl: 'https://replicate.example/cache-me.mp4',
    })

    expect(jobId).toMatch(/^video-cache-/)
    expect(fake.queries.some((sql) => sql.includes('INSERT INTO background_jobs'))).toBe(true)
  })

  it('claims a queued video-cache job and swaps the shot to a local file', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('cached-video-binary'),
    } as Response)

    const storage = await import('../../server/lib/storage.js')
    const videoCache = await import('../../server/lib/jobs/video-cache.js')
    const project = await storage.createProject('Video cache worker project')

    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        scene: 'Exterior',
        audioDescription: '',
        imagePrompt: 'prompt',
        videoPrompt: 'video prompt',
        duration: 4,
        assetRefs: [],
        status: 'vid_review',
        generatedImages: [],
        enhancedImages: [],
        selectedImage: null,
        videoFile: 'https://replicate.example/cache-me.mp4',
      },
    ]
    await storage.saveProject(project)

    await videoCache.enqueueVideoCacheJob({
      projectId: project.id,
      shotId: 'shot-001',
      externalUrl: 'https://replicate.example/cache-me.mp4',
    })

    const processed = await videoCache.runNextVideoCacheJob('video-cache-worker-a')
    const updatedProject = await storage.getProject(project.id)
    const updatedShot = updatedProject?.shots.find((shot) => shot.id === 'shot-001')

    expect(processed).toBe(true)
    expect(updatedShot?.videoFile).toMatch(/^vid_\d+\.mp4$/)
    expect(updatedShot?.status).toBe('vid_review')
    expect(fake.queries.some((sql) => sql.includes("status = 'running'"))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes("status = 'done'"))).toBe(true)

    const localFilename = updatedShot?.videoFile
    expect(localFilename).toBeTruthy()
    if (localFilename) {
      const localPath = path.join(storage.resolveProjectPath(project.id), 'shots', 'shot-001', 'video', localFilename)
      await expect(fs.stat(localPath)).resolves.toBeTruthy()
    }

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('sanitizes shot ids before logging background cache failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as typeof fetch

    const videoCache = await import('../../server/lib/jobs/video-cache.js')

    const jobId = await videoCache.enqueueVideoCacheJob({
      projectId: 'project-123',
      shotId: 'shot-001\nforged-log',
      externalUrl: 'https://replicate.example/cache-me.mp4',
    })

    expect(jobId).toBeNull()
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled()
    })

    expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).not.toContain('\n')
  })

  it('rejects oversized external videos before buffering the full response body', async () => {
    process.env.VIDEO_DOWNLOAD_MAX_BYTES = String(1024)

    const arrayBufferSpy = vi.fn(async () => Buffer.from('should-not-be-read'))
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-length' ? '4096' : null),
      },
      arrayBuffer: arrayBufferSpy,
      body: null,
    } as unknown as Response)

    const storage = await import('../../server/lib/storage.js')
    const videoCache = await import('../../server/lib/jobs/video-cache.js')
    const project = await storage.createProject('Video cache size limit project')

    await expect(
      videoCache.cacheVideoLocally(project.id, 'shot-001', 'https://replicate.example/too-large.mp4'),
    ).rejects.toThrow(/too large/i)

    expect(arrayBufferSpy).not.toHaveBeenCalled()

    await storage.deleteProject(project.id)
  })

  it('aborts streamed downloads that exceed the configured byte limit', async () => {
    process.env.VIDEO_DOWNLOAD_MAX_BYTES = String(5)

    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => null,
      },
      body: oversizedBody,
    } as unknown as Response)

    const storage = await import('../../server/lib/storage.js')
    const videoCache = await import('../../server/lib/jobs/video-cache.js')
    const project = await storage.createProject('Video cache streamed size limit project')

    await expect(
      videoCache.cacheVideoLocally(project.id, 'shot-001', 'https://replicate.example/streamed-too-large.mp4'),
    ).rejects.toThrow(/too large/i)

    await storage.deleteProject(project.id)
  })
})
