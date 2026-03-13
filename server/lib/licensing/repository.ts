import type { Pool } from 'pg';
import { createDb } from '../../db/index.js';
import type { InstallationState, LicensingRepository } from './types.js';

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
  trial_started_at: string | null;
  trial_ends_at: string | null;
  activated_at: string | null;
  last_license_check_at: string | null;
  grace_ends_at: string | null;
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
      ORDER BY id ASC
      LIMIT 1
    `);

    return mapInstallationStateRow(result.rows[0]);
  }

  async saveInstallationState(state: InstallationState): Promise<InstallationState> {
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
        state.id,
        state.installationId,
        state.tenantName,
        state.licenseStatus,
        state.trialStartedAt,
        state.trialEndsAt,
        state.activatedAt,
        state.lastLicenseCheckAt,
        state.graceEndsAt,
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
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    activatedAt: row.activated_at,
    lastLicenseCheckAt: row.last_license_check_at,
    graceEndsAt: row.grace_ends_at,
  };
}

export function createLicensingRepository(options: CreateLicensingRepositoryOptions = {}): LicensingRepository {
  return new PostgresLicensingRepository(options);
}
