import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const bundleMock = vi.fn()
const selectCompositionMock = vi.fn()
const renderMediaMock = vi.fn()

vi.mock('@remotion/bundler', () => ({
  bundle: bundleMock,
}))

vi.mock('@remotion/renderer', () => ({
  renderMedia: renderMediaMock,
  selectComposition: selectCompositionMock,
}))

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
          const row = {
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
          const row = {
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

function makePlan() {
  return {
    version: 1,
    format: { width: 1280, height: 720, fps: 30 },
    timeline: [],
    transitions: [],
    motionGraphics: {
      lowerThirds: [],
    },
    audio: {
      voiceover: { file: 'montage/voiceover.mp3', gainDb: 0 },
      music: { file: 'montage/music.mp3', gainDb: -18, duckingDb: -10, duckFadeMs: 500 },
    },
    style: {
      preset: 'premium',
      fontFamily: 'Montserrat',
      primaryColor: '#000000',
      secondaryColor: '#ffffff',
      textColor: '#ffffff',
    },
  }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.doUnmock('../../server/db/index.js')
})

describe('render-worker durable jobs', () => {
  it('enqueues a render job in postgres without starting Remotion inline', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const renderWorker = await import('../../server/lib/render-worker.js')
    const project = await storage.createProject('Queue-backed render project')
    const plan = makePlan()

    const jobId = await renderWorker.startRender(project.id, plan, 'preview')
    await Promise.resolve()

    const job = await renderWorker.getRenderJob(project.id, jobId)
    expect(jobId).toMatch(/^render-/)
    expect(job?.status).toBe('queued')
    expect(fake.queries.some((sql) => sql.includes('INSERT INTO background_jobs'))).toBe(true)
    expect(bundleMock).not.toHaveBeenCalled()
    expect(renderMediaMock).not.toHaveBeenCalled()

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })

  it('claims a queued render job and marks it done after the worker pass', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    bundleMock.mockResolvedValue('serve-url')
    selectCompositionMock.mockResolvedValue({
      id: 'Montage',
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 1,
    })
    renderMediaMock.mockImplementation(async ({ outputLocation }: { outputLocation: string }) => {
      await fs.mkdir(path.dirname(outputLocation), { recursive: true })
      await fs.writeFile(outputLocation, 'fake-render')
    })

    const storage = await import('../../server/lib/storage.js')
    const renderWorker = await import('../../server/lib/render-worker.js')
    const project = await storage.createProject('Worker render project')
    const plan = makePlan()

    const jobId = await renderWorker.startRender(project.id, plan, 'preview')
    const processed = await renderWorker.runNextRenderJob('worker-a')
    const job = await renderWorker.getRenderJob(project.id, jobId)

    expect(processed).toBe(true)
    expect(bundleMock).toHaveBeenCalledTimes(1)
    expect(selectCompositionMock).toHaveBeenCalledTimes(1)
    expect(renderMediaMock).toHaveBeenCalledTimes(1)
    expect(job?.status).toBe('done')
    expect(job?.outputFile).toBe(`montage/renders/${jobId}.mp4`)
    expect(fake.queries.some((sql) => sql.includes("status = 'running'"))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes("status = 'done'"))).toBe(true)

    await storage.deleteProject(project.id)
    await fs.rm(storage.resolveProjectPath(project.id), { recursive: true, force: true })
  })
})
