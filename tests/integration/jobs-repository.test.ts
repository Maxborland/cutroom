import { describe, expect, it } from 'vitest'

function createFakeJobsDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const queries: string[] = []

  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push(sql)

        if (sql.includes('INSERT INTO background_jobs')) {
          const [id, projectId, jobType, status, payload] = params as [
            string,
            string,
            string,
            string,
            Record<string, unknown>,
          ]

          const now = new Date('2026-03-13T00:00:00.000Z').toISOString()
          const row: Record<string, unknown> = {
            id,
            project_id: projectId,
            job_type: jobType,
            status,
            payload,
            result: null,
            error_message: null,
            attempts: 0,
            created_at: rows.get(id)?.created_at ?? now,
            updated_at: now,
            started_at: null,
            completed_at: null,
            claimed_by: null,
            claimed_at: null,
          }

          rows.set(id, row)
          return { rows: [row] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM background_jobs') && sql.includes('WHERE id = $1')) {
          const row = rows.get(params[0] as string)
          return { rows: row ? [row] : [] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'running'")) {
          const [jobType, workerId] = params as [string, string]
          const row = [...rows.values()]
            .filter((candidate) => candidate.job_type === jobType && candidate.status === 'queued')
            .sort((left, right) => left.created_at.localeCompare(right.created_at))[0]

          if (!row) {
            return { rows: [] }
          }

          row.status = 'running'
          row.attempts += 1
          row.claimed_by = workerId
          row.claimed_at = '2026-03-13T00:01:00.000Z'
          row.started_at = row.started_at ?? row.claimed_at
          row.updated_at = row.claimed_at
          rows.set(row.id, row)
          return { rows: [row] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'done'")) {
          const [jobId, result] = params as [string, Record<string, unknown>]
          const row = rows.get(jobId)
          if (!row) {
            return { rows: [] }
          }

          row.status = 'done'
          row.result = result
          row.error_message = null
          row.completed_at = '2026-03-13T00:02:00.000Z'
          row.updated_at = row.completed_at
          rows.set(jobId, row)
          return { rows: [row] }
        }

        if (sql.includes('UPDATE background_jobs') && sql.includes("status = 'failed'")) {
          const [jobId, errorMessage] = params as [string, string]
          const row = rows.get(jobId)
          if (!row) {
            return { rows: [] }
          }

          row.status = 'failed'
          row.error_message = errorMessage
          row.completed_at = '2026-03-13T00:02:00.000Z'
          row.updated_at = row.completed_at
          rows.set(jobId, row)
          return { rows: [row] }
        }

        if (sql.includes('DELETE FROM background_jobs')) {
          const deleted = rows.delete(params[0] as string)
          return { rowCount: deleted ? 1 : 0, rows: [] }
        }

        throw new Error(`Unexpected SQL in fake jobs db: ${sql}`)
      },
    },
    queries,
  }
}

describe('Postgres jobs repository', () => {
  it('enqueues, claims, and completes a render job through postgres row mapping', async () => {
    const fake = createFakeJobsDb()
    const { createJobsRepository } = await import('../../server/lib/jobs/repository.js')

    const repository = createJobsRepository({ db: fake.db as never })

    await repository.enqueueJob({
      id: 'job-render-1',
      projectId: 'project-123',
      jobType: 'render',
      payload: {
        quality: 'preview',
        plan: {
          version: 1,
        },
      },
    })

    const queued = await repository.getJob('job-render-1')
    expect(queued?.status).toBe('queued')
    expect(queued?.attempts).toBe(0)

    const claimed = await repository.claimNextJob('render', 'worker-a')
    expect(claimed?.id).toBe('job-render-1')
    expect(claimed?.status).toBe('running')
    expect(claimed?.attempts).toBe(1)
    expect(claimed?.claimedBy).toBe('worker-a')

    const done = await repository.markJobDone('job-render-1', {
      outputFile: 'montage/renders/job-render-1.mp4',
    })
    expect(done?.status).toBe('done')
    expect(done?.result).toEqual({
      outputFile: 'montage/renders/job-render-1.mp4',
    })

    expect(fake.queries.some((sql) => sql.includes('INSERT INTO background_jobs'))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes("status = 'running'"))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes("status = 'done'"))).toBe(true)
  })
})
