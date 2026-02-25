import fs from 'node:fs/promises';
import path from 'node:path';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

export interface GlobalSettings {
  openRouterApiKey: string;
  falApiKey: string;
  replicateApiToken: string;
  openrouterApiKey?: string;
  // Text models
  defaultTextModel?: string;
  defaultDescribeModel?: string;
  defaultScriptModel?: string;
  defaultShotSplitModel?: string;
  defaultReviewModel?: string;
  // Image/video models
  defaultImageModel?: string;
  defaultEnhanceModel?: string;
  defaultImageGenModel?: string;
  defaultImageNoRefGenModel?: string;
  defaultVideoGenModel?: string;
  // Generation params
  imageSize?: string;
  imageQuality?: string;
  videoQuality?: string;
  enhanceSize?: string;
  enhanceQuality?: string;
  imageAspectRatio?: string;
  // Master prompts
  masterPromptScriptwriter?: string;
  masterPromptShotSplitter?: string;
  masterPromptEnhance?: string;
  masterPromptDescribe?: string;
  masterPromptImageGen?: string;
  // Creative Director
  defaultDirectorModel?: string;
  masterPromptDirector?: string;
  // Montage
  defaultVoiceoverProvider?: string;
  defaultVoiceoverVoiceId?: string;
  elevenLabsApiKey?: string;
  sunoApiKey?: string;
  defaultMusicStyle?: string;
  defaultMontagePreset?: string;
  remotionConcurrency?: number;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  openRouterApiKey: '',
  falApiKey: '',
  replicateApiToken: '',
  videoQuality: 'high',
  defaultDescribeModel: 'openai/gpt-4o',
  defaultScriptModel: 'openai/gpt-4o',
  defaultShotSplitModel: 'openai/gpt-4o',
  defaultReviewModel: 'openai/gpt-4o',
};

async function ensureSettingsFile(): Promise<void> {
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

async function readSettings(): Promise<GlobalSettings> {
  await ensureSettingsFile();
  const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw) as GlobalSettings;
}

/** Returns the raw (unmasked) OpenRouter API key */
export async function getApiKey(): Promise<string> {
  const settings = await readSettings();
  return settings.openRouterApiKey || settings.openrouterApiKey || '';
}

/** Returns the raw fal.ai API key */
export async function getFalApiKey(): Promise<string> {
  const settings = await readSettings();
  return settings.falApiKey || '';
}

/** Returns the raw Replicate API token */
export async function getReplicateToken(): Promise<string> {
  const settings = await readSettings();
  return settings.replicateApiToken || '';
}

/** Returns all global settings (default models, master prompts, etc.) */
export async function getGlobalSettings(): Promise<GlobalSettings> {
  return readSettings();
}
