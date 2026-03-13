export type BackgroundJobType = 'render' | 'video_cache' | 'export'

export type BackgroundJobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface BackgroundJob<Payload = Record<string, unknown>, Result = Record<string, unknown> | null> {
  id: string
  projectId: string
  jobType: BackgroundJobType
  status: BackgroundJobStatus
  payload: Payload
  result: Result
  errorMessage: string | null
  attempts: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  claimedBy: string | null
  claimedAt: string | null
}

export interface EnqueueBackgroundJobInput<Payload = Record<string, unknown>> {
  id: string
  projectId: string
  jobType: BackgroundJobType
  payload: Payload
}

export interface JobsRepository {
  enqueueJob<Payload = Record<string, unknown>>(input: EnqueueBackgroundJobInput<Payload>): Promise<BackgroundJob<Payload>>
  getJob<Payload = Record<string, unknown>, Result = Record<string, unknown> | null>(jobId: string): Promise<BackgroundJob<Payload, Result> | null>
  claimNextJob<Payload = Record<string, unknown>, Result = Record<string, unknown> | null>(
    jobType: BackgroundJobType,
    workerId: string,
  ): Promise<BackgroundJob<Payload, Result> | null>
  markJobDone<Result = Record<string, unknown>>(jobId: string, result: Result): Promise<BackgroundJob<Record<string, unknown>, Result> | null>
  markJobFailed(jobId: string, errorMessage: string): Promise<BackgroundJob | null>
  deleteJob(jobId: string): Promise<boolean>
}
