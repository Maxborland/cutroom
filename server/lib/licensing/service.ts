import { createLicensingRepository } from './repository.js';
import {
  InstallationState,
  LicenseStatus,
  LicenseStatusResponse,
  LicensingRepository,
  LicensingService,
  isInstallationLicenseStatus,
} from './types.js';

const DEFAULT_TRIAL_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface CreateLicensingServiceOptions {
  now?: () => Date;
}

export class DefaultLicensingService implements LicensingService {
  private readonly repository: LicensingRepository;
  private readonly now: () => Date;

  constructor(repository: LicensingRepository, options: CreateLicensingServiceOptions = {}) {
    this.repository = repository;
    this.now = options.now ?? (() => new Date());
  }

  async getLicenseStatus(): Promise<LicenseStatusResponse> {
    const state = await this.repository.getInstallationState();
    if (!state) {
      return createUnactivatedStatus();
    }

    if (state.licenseStatus === 'unactivated') {
      return createUnactivatedStatus(state.lastLicenseCheckAt);
    }

    const now = this.now();
    const lastCheckAt = state.lastLicenseCheckAt;
    const trialDaysRemaining = getDaysRemaining(state.trialEndsAt, now) ?? 0;
    const status = resolveStatus(state, now, trialDaysRemaining);

    return {
      status,
      trialDaysRemaining,
      restrictedMode: status === 'trial_expired',
      lastCheckAt,
    };
  }
}

function resolveStatus(state: InstallationState, now: Date, trialDaysRemaining: number): LicenseStatus {
  if (!isInstallationLicenseStatus(state.licenseStatus)) {
    throw new Error(`Invalid installation_state license_status: ${state.licenseStatus}`);
  }

  switch (state.licenseStatus) {
    case 'active':
      return isFutureDate(state.graceEndsAt, now) ? 'grace' : 'active';
    case 'trial':
      if (!hasValidTimestamp(state.trialEndsAt)) {
        return 'trial_expired';
      }

      if (trialDaysRemaining === 0) {
        return 'trial_expired';
      }

      return 'trial';
    case 'unactivated':
      return 'unactivated';
  }

  throw new Error(`Unhandled installation_state license_status: ${state.licenseStatus}`);
}

function getDaysRemaining(dateValue: string | null, now: Date): number | null {
  if (!dateValue) {
    return null;
  }

  const deadline = new Date(dateValue);
  if (Number.isNaN(deadline.getTime())) {
    return null;
  }

  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / MS_PER_DAY);
}

function isFutureDate(dateValue: string | null, now: Date): boolean {
  if (!dateValue) {
    return false;
  }

  const value = new Date(dateValue);
  return !Number.isNaN(value.getTime()) && value.getTime() > now.getTime();
}

function hasValidTimestamp(dateValue: string | null): boolean {
  if (!dateValue) {
    return false;
  }

  return !Number.isNaN(new Date(dateValue).getTime());
}

function createUnactivatedStatus(lastCheckAt: string | null = null): LicenseStatusResponse {
  return {
    status: 'unactivated',
    trialDaysRemaining: DEFAULT_TRIAL_DAYS,
    restrictedMode: false,
    lastCheckAt,
  };
}

function isDatabaseConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('DATABASE_URL is not configured');
}

export function createLicensingService(
  repository?: LicensingRepository,
  options: CreateLicensingServiceOptions = {},
): LicensingService {
  return new DefaultLicensingService(repository ?? createLicensingRepository(), options);
}

export function createFallbackLicensingService(): LicensingService {
  return {
    async getLicenseStatus(): Promise<LicenseStatusResponse> {
      return createUnactivatedStatus();
    },
  };
}

export function createDefaultLicensingService(options: CreateLicensingServiceOptions = {}): LicensingService {
  try {
    return createLicensingService(undefined, options);
  } catch (error) {
    if (isDatabaseConfigError(error)) {
      return createFallbackLicensingService();
    }

    throw error;
  }
}
