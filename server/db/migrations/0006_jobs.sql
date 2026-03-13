CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('render', 'video_cache', 'export')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS background_jobs_status_created_idx
  ON background_jobs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS background_jobs_type_status_created_idx
  ON background_jobs (job_type, status, created_at ASC);
