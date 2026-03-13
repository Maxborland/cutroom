export type InstallationLicenseStatus = 'unactivated' | 'trial' | 'active';

export type LicenseStatus = 'unactivated' | 'trial' | 'active' | 'grace' | 'trial_expired';

export interface InstallationState {
  id: string;
  installationId: string;
  tenantName: string | null;
  licenseStatus: InstallationLicenseStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  activatedAt: string | null;
  lastLicenseCheckAt: string | null;
  graceEndsAt: string | null;
}

export interface LicenseStatusResponse {
  status: LicenseStatus;
  trialDaysRemaining: number;
  restrictedMode: boolean;
  lastCheckAt: string | null;
}

export interface LicensingRepository {
  getInstallationState(): Promise<InstallationState | null>;
  saveInstallationState(state: InstallationState): Promise<InstallationState>;
}

export interface LicensingService {
  getLicenseStatus(): Promise<LicenseStatusResponse>;
}
