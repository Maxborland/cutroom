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
