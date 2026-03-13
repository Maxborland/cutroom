import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallationState, LicensingRepository } from './types.js';

const DEFAULT_INSTALLATION_STATE_PATH = path.resolve(process.cwd(), 'data', 'installation-state.json');

interface FileLicensingRepositoryOptions {
  filePath?: string;
}

export class FileLicensingRepository implements LicensingRepository {
  private readonly filePath: string;

  constructor(options: FileLicensingRepositoryOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_INSTALLATION_STATE_PATH;
  }

  async getInstallationState(): Promise<InstallationState | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as InstallationState;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async saveInstallationState(state: InstallationState): Promise<InstallationState> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    return state;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createLicensingRepository(options: FileLicensingRepositoryOptions = {}): LicensingRepository {
  return new FileLicensingRepository(options);
}
