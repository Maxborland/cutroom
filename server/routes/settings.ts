import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = Router();

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

interface Settings {
  openRouterApiKey: string;
  higgsfieldKeyId: string;
  higgsfieldKeySecret: string;
  // Legacy field names — kept for migration
  openrouterApiKey?: string;
  higgsfieldCredentials?: string;
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = {
  openRouterApiKey: '',
  higgsfieldKeyId: '',
  higgsfieldKeySecret: '',
};

async function ensureSettingsFile(): Promise<void> {
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

async function readSettings(): Promise<Settings> {
  await ensureSettingsFile();
  const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw) as Settings;
}

async function writeSettings(settings: Settings): Promise<void> {
  await ensureSettingsFile();
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key;
  return '••••' + key.slice(-4);
}

/** Returns the raw (unmasked) API key for internal use */
export async function getApiKey(): Promise<string> {
  const settings = await readSettings();
  // Support both field names (openRouterApiKey is canonical, openrouterApiKey is legacy)
  return settings.openRouterApiKey || settings.openrouterApiKey || '';
}

/** Returns the raw Higgsfield credentials (KEY_ID:KEY_SECRET) for internal use */
export async function getHiggsfieldCredentials(): Promise<string> {
  const settings = await readSettings();
  // Migrate from legacy single-field format
  if (settings.higgsfieldCredentials && !settings.higgsfieldKeyId) {
    return settings.higgsfieldCredentials;
  }
  const keyId = settings.higgsfieldKeyId || '';
  const keySecret = settings.higgsfieldKeySecret || '';
  if (!keyId || !keySecret) return '';
  return `${keyId}:${keySecret}`;
}

/** Returns all global settings for internal use (e.g. default models, master prompts) */
export async function getGlobalSettings(): Promise<Settings> {
  return readSettings();
}

// GET /api/settings — return settings with masked API key
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await readSettings();
    const apiKey = settings.openRouterApiKey || settings.openrouterApiKey || '';
    // Always return canonical field names, remove legacy
    const { openrouterApiKey: _legacy, higgsfieldCredentials: _legacyHf, ...rest } = settings;
    res.json({
      ...rest,
      openRouterApiKey: maskApiKey(apiKey),
      higgsfieldKeyId: settings.higgsfieldKeyId || '',
      higgsfieldKeySecret: maskApiKey(settings.higgsfieldKeySecret || ''),
    });
  } catch (err) {
    console.error('Failed to read settings:', err);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// PUT /api/settings — update settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const existing = await readSettings();
    const updates = req.body as Partial<Settings>;

    // Resolve the existing API key (canonical or legacy)
    const existingKey = existing.openRouterApiKey || existing.openrouterApiKey || '';

    // If the API key starts with ••••, keep the existing key
    if (
      typeof updates.openRouterApiKey === 'string' &&
      updates.openRouterApiKey.startsWith('••••')
    ) {
      updates.openRouterApiKey = existingKey;
    }

    // Preserve masked Higgsfield secret
    if (
      typeof updates.higgsfieldKeySecret === 'string' &&
      updates.higgsfieldKeySecret.startsWith('••••')
    ) {
      updates.higgsfieldKeySecret = existing.higgsfieldKeySecret || '';
    }

    // Remove legacy field names, always use canonical
    const { openrouterApiKey: _legacy, higgsfieldCredentials: _legacyHf, ...existingClean } = existing;

    const merged: Settings = {
      ...existingClean,
      ...updates,
    };

    await writeSettings(merged);

    // Return with masked keys
    res.json({
      ...merged,
      openRouterApiKey: maskApiKey(merged.openRouterApiKey),
      higgsfieldKeySecret: maskApiKey(merged.higgsfieldKeySecret || ''),
    });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
