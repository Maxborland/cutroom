import { createLicensingRepository } from './repository.js';
import type {
  InstallationState,
  LicenseStatus,
  LicenseStatusResponse,
  LicensingRepository,
  LicensingService,
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
      return {
        status: 'unactivated',
        trialDaysRemaining: DEFAULT_TRIAL_DAYS,
        restrictedMode: false,
        lastCheckAt: null,
      };
    }

    const now = this.now();
    const lastCheckAt = state.lastLicenseCheckAt;
    const trialDaysRemaining = getDaysRemaining(state.trialEndsAt, now, DEFAULT_TRIAL_DAYS);
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
  if (state.activatedAt || state.licenseStatus === 'active') {
    return 'active';
  }

  if (isFutureDate(state.graceEndsAt, now)) {
    return 'grace';
  }

  if (state.trialEndsAt && trialDaysRemaining === 0) {
    return 'trial_expired';
  }

  if (state.licenseStatus === 'trial') {
    return 'trial';
  }

  return 'unactivated';
}

function getDaysRemaining(dateValue: string | null, now: Date, fallback: number): number {
  if (!dateValue) {
    return fallback;
  }

  const deadline = new Date(dateValue);
  if (Number.isNaN(deadline.getTime())) {
    return fallback;
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

export function createLicensingService(
  repository: LicensingRepository = createLicensingRepository(),
  options: CreateLicensingServiceOptions = {},
): LicensingService {
  return new DefaultLicensingService(repository, options);
}
