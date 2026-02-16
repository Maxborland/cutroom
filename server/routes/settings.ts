import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = Router();

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

interface Settings {
  openRouterApiKey: string;
  // Legacy field name — kept for migration
  openrouterApiKey?: string;
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = {
  openRouterApiKey: '',
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

/** Returns all global settings for internal use (e.g. default models, master prompts) */
export async function getGlobalSettings(): Promise<Settings> {
  return readSettings();
}

// GET /api/settings — return settings with masked API key
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await readSettings();
    const apiKey = settings.openRouterApiKey || settings.openrouterApiKey || '';
    // Always return canonical field name, remove legacy
    const { openrouterApiKey: _legacy, ...rest } = settings;
    res.json({
      ...rest,
      openRouterApiKey: maskApiKey(apiKey),
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

    // Remove legacy field name, always use canonical
    const { openrouterApiKey: _legacy, ...existingClean } = existing;

    const merged: Settings = {
      ...existingClean,
      ...updates,
    };

    await writeSettings(merged);

    // Return with masked key
    res.json({
      ...merged,
      openRouterApiKey: maskApiKey(merged.openRouterApiKey),
    });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
