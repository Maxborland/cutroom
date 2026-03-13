import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

function createFakeCompositeDb() {
  const projectRows = new Map<string, Record<string, unknown>>()
  const jobRows = new Map<string, Record<string, unknown>>()

  return {
    db: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
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

describe('Export jobs route contract', () => {
  it('returns a queued export job from the prepare endpoint and exposes queued status', async () => {
    const fake = createFakeCompositeDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const { createApp } = await import('../../server/app.js')
    const app = createApp({ allowMissingApiKey: true, apiAccessKey: '' })
    const project = await storage.createProject('Queued export project')

    const prepareRes = await request(app)
      .post(`/api/projects/${project.id}/export/prepare`)
      .expect(200)

    expect(prepareRes.body.jobId).toMatch(/^export-/)
    expect(prepareRes.body.status).toBe('queued')

    const statusRes = await request(app)
      .get(`/api/projects/${project.id}/export/jobs/${prepareRes.body.jobId}`)
      .expect(200)

    expect(statusRes.body.id).toBe(prepareRes.body.jobId)
    expect(statusRes.body.status).toBe('queued')

    await storage.deleteProject(project.id)
  })
})
