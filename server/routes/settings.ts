import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sendApiError } from '../lib/api-error.js';

// Re-export config functions so existing imports remain compatible.
export { getApiKey, getFalApiKey, getReplicateToken, getGlobalSettings } from '../lib/config.js';

const router = Router();
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

interface Settings {
  openRouterApiKey: string;
  falApiKey: string;
  replicateApiToken: string;
  elevenLabsApiKey?: string;
  sunoApiKey?: string;
  // Legacy field names kept for migration.
  openrouterApiKey?: string;
  higgsfieldCredentials?: string;
  higgsfieldKeyId?: string;
  higgsfieldKeySecret?: string;
  [key: string]: unknown;
}

type LegacySettingsKeys =
  | 'openrouterApiKey'
  | 'higgsfieldCredentials'
  | 'higgsfieldKeyId'
  | 'higgsfieldKeySecret';

function stripLegacySettingsFields(settings: Settings): Omit<Settings, LegacySettingsKeys> {
  const {
    openrouterApiKey,
    higgsfieldCredentials,
    higgsfieldKeyId,
    higgsfieldKeySecret,
    ...rest
  } = settings;
  void openrouterApiKey;
  void higgsfieldCredentials;
  void higgsfieldKeyId;
  void higgsfieldKeySecret;
  return rest;
}

async function readSettings(): Promise<Settings> {
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(
      SETTINGS_PATH,
      JSON.stringify({ openRouterApiKey: '', falApiKey: '', replicateApiToken: '' }, null, 2),
      'utf-8',
    );
  }

  const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw) as Settings;
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key;
  return `••••${key.slice(-4)}`;
}

function isMaskedKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('••••');
}

// GET /api/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await readSettings();
    const apiKey = settings.openRouterApiKey || settings.openrouterApiKey || '';
    const rest = stripLegacySettingsFields(settings);

    res.json({
      ...rest,
      openRouterApiKey: maskApiKey(apiKey),
      falApiKey: maskApiKey(settings.falApiKey || ''),
      replicateApiToken: maskApiKey(settings.replicateApiToken || ''),
      elevenLabsApiKey: maskApiKey(settings.elevenLabsApiKey || ''),
      sunoApiKey: maskApiKey(settings.sunoApiKey || ''),
    });
  } catch (err) {
    console.error('Failed to read settings:', err);
    sendApiError(res, 500, 'Failed to read settings', 'SETTINGS_READ_FAILED');
  }
});

// PUT /api/settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const existing = await readSettings();
    const updates = req.body as Partial<Settings>;

    const existingOpenRouter = existing.openRouterApiKey || existing.openrouterApiKey || '';

    if (isMaskedKey(updates.openRouterApiKey)) {
      updates.openRouterApiKey = existingOpenRouter;
    }

    if (isMaskedKey(updates.falApiKey)) {
      updates.falApiKey = existing.falApiKey || '';
    }

    if (isMaskedKey(updates.replicateApiToken)) {
      updates.replicateApiToken = existing.replicateApiToken || '';
    }

    if (isMaskedKey(updates.elevenLabsApiKey)) {
      updates.elevenLabsApiKey = existing.elevenLabsApiKey || '';
    }

    if (isMaskedKey(updates.sunoApiKey)) {
      updates.sunoApiKey = existing.sunoApiKey || '';
    }

    const existingClean = stripLegacySettingsFields(existing);

    const merged: Settings = {
      ...existingClean,
      ...updates,
    };

    await writeSettings(merged);

    res.json({
      ...merged,
      openRouterApiKey: maskApiKey(merged.openRouterApiKey || ''),
      falApiKey: maskApiKey(merged.falApiKey || ''),
      replicateApiToken: maskApiKey(merged.replicateApiToken || ''),
      elevenLabsApiKey: maskApiKey(merged.elevenLabsApiKey || ''),
      sunoApiKey: maskApiKey(merged.sunoApiKey || ''),
    });
  } catch (err) {
    console.error('Failed to update settings:', err);
    sendApiError(res, 500, 'Failed to update settings', 'SETTINGS_UPDATE_FAILED');
  }
});

export default router;
