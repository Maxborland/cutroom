import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'

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
})
