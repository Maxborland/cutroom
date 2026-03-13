import type { Pool } from 'pg';
import { createDb } from '../../db/index.js';
import {
  INSTALLATION_STATE_SINGLETON_ID,
  type InstallationState,
  type LicensingRepository,
} from './types.js';

type LicensingDb = Pick<Pool, 'query'>;

interface CreateLicensingRepositoryOptions {
  db?: LicensingDb;
  connectionString?: string;
}

type InstallationStateRow = {
  id: string;
  installation_id: string;
  tenant_name: string | null;
  license_status: InstallationState['licenseStatus'];
  trial_started_at: Date | string | null;
  trial_ends_at: Date | string | null;
  activated_at: Date | string | null;
  last_license_check_at: Date | string | null;
  grace_ends_at: Date | string | null;
};

export class PostgresLicensingRepository implements LicensingRepository {
  private readonly db: LicensingDb;

  constructor(options: CreateLicensingRepositoryOptions = {}) {
    this.db = options.db ?? createDb(options.connectionString);
  }

  async getInstallationState(): Promise<InstallationState | null> {
    const result = await this.db.query<InstallationStateRow>(`
      SELECT
        id,
        installation_id,
        tenant_name,
        license_status,
        trial_started_at,
        trial_ends_at,
        activated_at,
        last_license_check_at,
        grace_ends_at
      FROM installation_state
      WHERE id = $1
      LIMIT 1
    `, [INSTALLATION_STATE_SINGLETON_ID]);

    return mapInstallationStateRow(result.rows[0]);
  }

  async saveInstallationState(state: InstallationState): Promise<InstallationState> {
    const normalizedState: InstallationState = {
      ...state,
      id: INSTALLATION_STATE_SINGLETON_ID,
    };

    const result = await this.db.query<InstallationStateRow>(
      `
        INSERT INTO installation_state (
          id,
          installation_id,
          tenant_name,
          license_status,
          trial_started_at,
          trial_ends_at,
          activated_at,
          last_license_check_at,
          grace_ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          installation_id = EXCLUDED.installation_id,
          tenant_name = EXCLUDED.tenant_name,
          license_status = EXCLUDED.license_status,
          trial_started_at = EXCLUDED.trial_started_at,
          trial_ends_at = EXCLUDED.trial_ends_at,
          activated_at = EXCLUDED.activated_at,
          last_license_check_at = EXCLUDED.last_license_check_at,
          grace_ends_at = EXCLUDED.grace_ends_at
        RETURNING
          id,
          installation_id,
          tenant_name,
          license_status,
          trial_started_at,
          trial_ends_at,
          activated_at,
          last_license_check_at,
          grace_ends_at
      `,
      [
        normalizedState.id,
        normalizedState.installationId,
        normalizedState.tenantName,
        normalizedState.licenseStatus,
        normalizedState.trialStartedAt,
        normalizedState.trialEndsAt,
        normalizedState.activatedAt,
        normalizedState.lastLicenseCheckAt,
        normalizedState.graceEndsAt,
      ],
    );

    return mapInstallationStateRow(result.rows[0]) as InstallationState;
  }
}

function mapInstallationStateRow(row: InstallationStateRow | undefined): InstallationState | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    installationId: row.installation_id,
    tenantName: row.tenant_name,
    licenseStatus: row.license_status,
    trialStartedAt: normalizeTimestampValue(row.trial_started_at),
    trialEndsAt: normalizeTimestampValue(row.trial_ends_at),
    activatedAt: normalizeTimestampValue(row.activated_at),
    lastLicenseCheckAt: normalizeTimestampValue(row.last_license_check_at),
    graceEndsAt: normalizeTimestampValue(row.grace_ends_at),
  };
}

function normalizeTimestampValue(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function createLicensingRepository(options: CreateLicensingRepositoryOptions = {}): LicensingRepository {
  return new PostgresLicensingRepository(options);
}
