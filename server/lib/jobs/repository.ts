import type { Pool } from 'pg'
import { createDb } from '../../db/index.js'
import type {
  BackgroundJob,
  BackgroundJobType,
  EnqueueBackgroundJobInput,
  JobsRepository,
} from './types.js'

type JobsDb = Pick<Pool, 'query'>

interface CreateJobsRepositoryOptions {
  db?: JobsDb
  connectionString?: string
}

type BackgroundJobRow = {
  id: string
  project_id: string
  job_type: BackgroundJobType
  status: 'queued' | 'running' | 'done' | 'failed'
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error_message: string | null
  attempts: number
  created_at: Date | string
  updated_at: Date | string
  started_at: Date | string | null
  completed_at: Date | string | null
  claimed_by: string | null
  claimed_at: Date | string | null
}

export class PostgresJobsRepository implements JobsRepository {
  private readonly db: JobsDb

  constructor(options: CreateJobsRepositoryOptions = {}) {
    this.db = options.db ?? createDb(options.connectionString)
  }

  async enqueueJob<Payload = Record<string, unknown>>(
    input: EnqueueBackgroundJobInput<Payload>,
  ): Promise<BackgroundJob<Payload>> {
    const result = await this.db.query<BackgroundJobRow>(
      `
        INSERT INTO background_jobs (
          id,
          project_id,
          job_type,
          status,
          payload
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          job_type = EXCLUDED.job_type,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          result = NULL,
          error_message = NULL,
          updated_at = NOW(),
          started_at = NULL,
          completed_at = NULL,
          claimed_by = NULL,
          claimed_at = NULL
        RETURNING
          id,
          project_id,
          job_type,
          status,
          payload,
          result,
          error_message,
          attempts,
          created_at,
          updated_at,
          started_at,
          completed_at,
          claimed_by,
          claimed_at
      `,
      [input.id, input.projectId, input.jobType, 'queued', input.payload],
    )

    return mapBackgroundJobRow<Payload>(result.rows[0]) as BackgroundJob<Payload>
  }

  async getJob<Payload = Record<string, unknown>, Result = Record<string, unknown> | null>(
    jobId: string,
  ): Promise<BackgroundJob<Payload, Result> | null> {
    const result = await this.db.query<BackgroundJobRow>(
      `
        SELECT
          id,
          project_id,
          job_type,
          status,
          payload,
          result,
          error_message,
          attempts,
          created_at,
          updated_at,
          started_at,
          completed_at,
          claimed_by,
          claimed_at
        FROM background_jobs
        WHERE id = $1
        LIMIT 1
      `,
      [jobId],
    )

    return mapBackgroundJobRow<Payload, Result>(result.rows[0])
  }

  async claimNextJob<Payload = Record<string, unknown>, Result = Record<string, unknown> | null>(
    jobType: BackgroundJobType,
    workerId: string,
  ): Promise<BackgroundJob<Payload, Result> | null> {
    const result = await this.db.query<BackgroundJobRow>(
      `
        UPDATE background_jobs
        SET
          status = 'running',
          attempts = attempts + 1,
          updated_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          claimed_by = $2,
          claimed_at = NOW()
        WHERE id = (
          SELECT id
          FROM background_jobs
          WHERE job_type = $1
            AND status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
        )
        RETURNING
          id,
          project_id,
          job_type,
          status,
          payload,
          result,
          error_message,
          attempts,
          created_at,
          updated_at,
          started_at,
          completed_at,
          claimed_by,
          claimed_at
      `,
      [jobType, workerId],
    )

    return mapBackgroundJobRow<Payload, Result>(result.rows[0])
  }

  async markJobDone<Result = Record<string, unknown>>(
    jobId: string,
    resultPayload: Result,
  ): Promise<BackgroundJob<Record<string, unknown>, Result> | null> {
    const result = await this.db.query<BackgroundJobRow>(
      `
        UPDATE background_jobs
        SET
          status = 'done',
          result = $2::jsonb,
          error_message = NULL,
          updated_at = NOW(),
          completed_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          project_id,
          job_type,
          status,
          payload,
          result,
          error_message,
          attempts,
          created_at,
          updated_at,
          started_at,
          completed_at,
          claimed_by,
          claimed_at
      `,
      [jobId, resultPayload],
    )

    return mapBackgroundJobRow<Record<string, unknown>, Result>(result.rows[0])
  }

  async markJobFailed(jobId: string, errorMessage: string): Promise<BackgroundJob | null> {
    const result = await this.db.query<BackgroundJobRow>(
      `
        UPDATE background_jobs
        SET
          status = 'failed',
          error_message = $2,
          updated_at = NOW(),
          completed_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          project_id,
          job_type,
          status,
          payload,
          result,
          error_message,
          attempts,
          created_at,
          updated_at,
          started_at,
          completed_at,
          claimed_by,
          claimed_at
      `,
      [jobId, errorMessage],
    )

    return mapBackgroundJobRow(result.rows[0])
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const result = await this.db.query(
      `
        DELETE FROM background_jobs
        WHERE id = $1
      `,
      [jobId],
    )

    return Number(result.rowCount ?? 0) > 0
  }
}

function mapBackgroundJobRow<Payload = Record<string, unknown>, Result = Record<string, unknown> | null>(
  row: BackgroundJobRow | undefined,
): BackgroundJob<Payload, Result> | null {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    projectId: row.project_id,
    jobType: row.job_type,
    status: row.status,
    payload: (row.payload ?? {}) as Payload,
    result: (row.result ?? null) as Result,
    errorMessage: row.error_message,
    attempts: row.attempts,
    createdAt: normalizeTimestampValue(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestampValue(row.updated_at) ?? new Date(0).toISOString(),
    startedAt: normalizeTimestampValue(row.started_at),
    completedAt: normalizeTimestampValue(row.completed_at),
    claimedBy: row.claimed_by,
    claimedAt: normalizeTimestampValue(row.claimed_at),
  }
}

function normalizeTimestampValue(value: Date | string | null): string | null {
  if (value == null) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

export function createJobsRepository(options: CreateJobsRepositoryOptions = {}): JobsRepository {
  return new PostgresJobsRepository(options)
}
