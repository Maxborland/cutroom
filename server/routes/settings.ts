import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = Router();

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

interface Settings {
  openrouterApiKey: string;
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = {
  openrouterApiKey: '',
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
  return settings.openrouterApiKey || '';
}

// GET /api/settings — return settings with masked API key
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await readSettings();
    res.json({
      ...settings,
      openrouterApiKey: maskApiKey(settings.openrouterApiKey),
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

    // If the API key starts with ••••, keep the existing key
    if (
      typeof updates.openrouterApiKey === 'string' &&
      updates.openrouterApiKey.startsWith('••••')
    ) {
      updates.openrouterApiKey = existing.openrouterApiKey;
    }

    const merged: Settings = {
      ...existing,
      ...updates,
    };

    await writeSettings(merged);

    // Return with masked key
    res.json({
      ...merged,
      openrouterApiKey: maskApiKey(merged.openrouterApiKey),
    });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
