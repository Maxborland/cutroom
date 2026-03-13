-- Canonical schema snapshot for the initial PostgreSQL bootstrap.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installation_state (
  id TEXT PRIMARY KEY CHECK (id = 'installation'),
  installation_id TEXT NOT NULL,
  tenant_name TEXT,
  license_status TEXT NOT NULL,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  last_license_check_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ
);
