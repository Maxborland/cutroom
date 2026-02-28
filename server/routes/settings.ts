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
  // Legacy field names kept for migration.
  openrouterApiKey?: string;
  higgsfieldCredentials?: string;
  higgsfieldKeyId?: string;
  higgsfieldKeySecret?: string;
  [key: string]: unknown;
}

/**
 * Allowed keys that clients may send in PUT /api/settings.
 * Unknown keys are rejected with 400 to prevent mass-assignment.
 * remotionConcurrency is the only numeric field; all others are strings.
 */
export const SETTINGS_ALLOWLIST: ReadonlyMap<string, 'string' | 'number'> = new Map([
  // API keys
  ['openRouterApiKey', 'string'],
  ['falApiKey', 'string'],
  ['replicateApiToken', 'string'],
  ['elevenLabsApiKey', 'string'],
  ['sunoApiKey', 'string'],

  // Text models
  ['defaultTextModel', 'string'],
  ['defaultDescribeModel', 'string'],
  ['defaultScriptModel', 'string'],
  ['defaultShotSplitModel', 'string'],
  ['defaultReviewModel', 'string'],
  ['defaultDirectorModel', 'string'],

  // Image/video models
  ['defaultImageModel', 'string'],
  ['defaultEnhanceModel', 'string'],
  ['defaultImageGenModel', 'string'],
  ['defaultImageNoRefGenModel', 'string'],
  ['defaultVideoGenModel', 'string'],

  // Generation params
  ['imageSize', 'string'],
  ['imageQuality', 'string'],
  ['videoQuality', 'string'],
  ['enhanceSize', 'string'],
  ['enhanceQuality', 'string'],
  ['imageAspectRatio', 'string'],
  ['remotionConcurrency', 'number'],

  // Master prompts
  ['masterPromptScriptwriter', 'string'],
  ['masterPromptShotSplitter', 'string'],
  ['masterPromptEnhance', 'string'],
  ['masterPromptDescribe', 'string'],
  ['masterPromptImageGen', 'string'],
  ['masterPromptDirector', 'string'],

  // Montage
  ['defaultVoiceoverProvider', 'string'],
  ['defaultVoiceoverVoiceId', 'string'],
  ['defaultMusicStyle', 'string'],
  ['defaultMontagePreset', 'string'],
]);

type ValidationError = { key: string; reason: string };

function validateSettingsUpdate(updates: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const expectedType = SETTINGS_ALLOWLIST.get(key);
    if (!expectedType) {
      errors.push({ key, reason: 'unknown key' });
      continue;
    }
    if (value !== null && value !== undefined && typeof value !== expectedType) {
      errors.push({ key, reason: `expected ${expectedType}, got ${typeof value}` });
    }
  }
  return errors;
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

    const {
      openrouterApiKey: _legacy,
      higgsfieldCredentials: _legacyHf,
      higgsfieldKeyId: _legacyHfId,
      higgsfieldKeySecret: _legacyHfSecret,
      ...rest
    } = settings;

    res.json({
      ...rest,
      openRouterApiKey: maskApiKey(apiKey),
      falApiKey: maskApiKey(settings.falApiKey || ''),
      replicateApiToken: maskApiKey(settings.replicateApiToken || ''),
      elevenLabsApiKey: maskApiKey((settings as any).elevenLabsApiKey || ''),
      sunoApiKey: maskApiKey((settings as any).sunoApiKey || ''),
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

    // Validate that the client only sends known keys with correct types.
    const validationErrors = validateSettingsUpdate(updates as Record<string, unknown>);
    if (validationErrors.length > 0) {
      const detail = validationErrors.map((e) => `"${e.key}": ${e.reason}`).join('; ');
      sendApiError(res, 400, `Invalid settings update: ${detail}`, 'SETTINGS_INVALID');
      return;
    }

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

    if (isMaskedKey((updates as any).elevenLabsApiKey)) {
      (updates as any).elevenLabsApiKey = (existing as any).elevenLabsApiKey || '';
    }

    if (isMaskedKey((updates as any).sunoApiKey)) {
      (updates as any).sunoApiKey = (existing as any).sunoApiKey || '';
    }

    const {
      openrouterApiKey: _legacy,
      higgsfieldCredentials: _legacyHf,
      higgsfieldKeyId: _legacyHfId,
      higgsfieldKeySecret: _legacyHfSecret,
      ...existingClean
    } = existing;

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
      elevenLabsApiKey: maskApiKey((merged as any).elevenLabsApiKey || ''),
      sunoApiKey: maskApiKey((merged as any).sunoApiKey || ''),
    });
  } catch (err) {
    console.error('Failed to update settings:', err);
    sendApiError(res, 500, 'Failed to update settings', 'SETTINGS_UPDATE_FAILED');
  }
});

export default router;
