/**
 * tts-providers.ts — Multi-provider TTS abstraction.
 * Supports: Kokoro (fal.ai), ElevenLabs via fal.ai, ElevenLabs direct.
 */

import { fal } from '@fal-ai/client';
import { configureFal } from './fal-client.js';
import { getGlobalSettings, getFalApiKey } from './config.js';

export type TtsProvider = 'kokoro' | 'elevenlabs-fal' | 'elevenlabs';

export interface TtsVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  language: string;
  provider: TtsProvider;
}

export interface TtsResult {
  audioBuffer: Buffer;
  contentType: string;
  provider: TtsProvider;
  voiceId: string;
}

// ── Kokoro voices (fal-ai/kokoro) ───────────────────────────────────

const KOKORO_VOICES: TtsVoice[] = [
  // American English — female
  { id: 'af_heart', name: 'Heart', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_alloy', name: 'Alloy', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_bella', name: 'Bella', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_jessica', name: 'Jessica', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_nicole', name: 'Nicole', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_nova', name: 'Nova', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_river', name: 'River', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_sarah', name: 'Sarah', gender: 'female', language: 'en-US', provider: 'kokoro' },
  { id: 'af_sky', name: 'Sky', gender: 'female', language: 'en-US', provider: 'kokoro' },
  // American English — male
  { id: 'am_adam', name: 'Adam', gender: 'male', language: 'en-US', provider: 'kokoro' },
  { id: 'am_echo', name: 'Echo', gender: 'male', language: 'en-US', provider: 'kokoro' },
  { id: 'am_eric', name: 'Eric', gender: 'male', language: 'en-US', provider: 'kokoro' },
  { id: 'am_liam', name: 'Liam', gender: 'male', language: 'en-US', provider: 'kokoro' },
  { id: 'am_michael', name: 'Michael', gender: 'male', language: 'en-US', provider: 'kokoro' },
  { id: 'am_onyx', name: 'Onyx', gender: 'male', language: 'en-US', provider: 'kokoro' },
  // British English
  { id: 'bf_emma', name: 'Emma (UK)', gender: 'female', language: 'en-GB', provider: 'kokoro' },
  { id: 'bf_isabella', name: 'Isabella (UK)', gender: 'female', language: 'en-GB', provider: 'kokoro' },
  { id: 'bf_lily', name: 'Lily (UK)', gender: 'female', language: 'en-GB', provider: 'kokoro' },
  { id: 'bm_daniel', name: 'Daniel (UK)', gender: 'male', language: 'en-GB', provider: 'kokoro' },
  { id: 'bm_george', name: 'George (UK)', gender: 'male', language: 'en-GB', provider: 'kokoro' },
  { id: 'bm_lewis', name: 'Lewis (UK)', gender: 'male', language: 'en-GB', provider: 'kokoro' },
  // French / Spanish / Italian / Japanese / Mandarin / Hindi
  { id: 'ff_siwis', name: 'Siwis (FR)', gender: 'female', language: 'fr', provider: 'kokoro' },
  { id: 'ef_dora', name: 'Dora (ES)', gender: 'female', language: 'es', provider: 'kokoro' },
  { id: 'em_alex', name: 'Alex (ES)', gender: 'male', language: 'es', provider: 'kokoro' },
  { id: 'if_sara', name: 'Sara (IT)', gender: 'female', language: 'it', provider: 'kokoro' },
  { id: 'im_nicola', name: 'Nicola (IT)', gender: 'male', language: 'it', provider: 'kokoro' },
  { id: 'jf_alpha', name: 'Alpha (JP)', gender: 'female', language: 'ja', provider: 'kokoro' },
  { id: 'jm_kumo', name: 'Kumo (JP)', gender: 'male', language: 'ja', provider: 'kokoro' },
  { id: 'zf_xiaobei', name: 'Xiaobei (ZH)', gender: 'female', language: 'zh', provider: 'kokoro' },
  { id: 'zm_yunxi', name: 'Yunxi (ZH)', gender: 'male', language: 'zh', provider: 'kokoro' },
  { id: 'hf_alpha', name: 'Alpha (HI)', gender: 'female', language: 'hi', provider: 'kokoro' },
  { id: 'hm_omega', name: 'Omega (HI)', gender: 'male', language: 'hi', provider: 'kokoro' },
];

const KOKORO_ENDPOINTS: Record<string, string> = {
  'en-US': 'fal-ai/kokoro/american-english',
  'en-GB': 'fal-ai/kokoro/british-english',
  'fr': 'fal-ai/kokoro/french',
  'es': 'fal-ai/kokoro/spanish',
  'it': 'fal-ai/kokoro/italian',
  'ja': 'fal-ai/kokoro/japanese',
  'zh': 'fal-ai/kokoro/mandarin',
  'hi': 'fal-ai/kokoro/hindi',
};

// ── ElevenLabs via fal.ai voices ────────────────────────────────────
// Uses fal-ai/elevenlabs/text-to-dialogue/eleven-v3
// Voices are referenced by name, supports language_code for Russian etc.

const ELEVENLABS_FAL_VOICES: TtsVoice[] = [
  { id: 'Aria', name: 'Aria', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Charlotte', name: 'Charlotte', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Sarah', name: 'Sarah', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Laura', name: 'Laura', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Alice', name: 'Alice', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Jessica', name: 'Jessica', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Lily', name: 'Lily', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'River', name: 'River', gender: 'female', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Roger', name: 'Roger', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'George', name: 'George', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Daniel', name: 'Daniel', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Chris', name: 'Chris', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Brian', name: 'Brian', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Bill', name: 'Bill', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
  { id: 'Callum', name: 'Callum', gender: 'male', language: 'multilingual', provider: 'elevenlabs-fal' },
];

// ── ElevenLabs direct API voices ────────────────────────────────────

const ELEVENLABS_DIRECT_VOICES: TtsVoice[] = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', language: 'multilingual', provider: 'elevenlabs' },
];

// ── Provider interface ──────────────────────────────────────────────

/**
 * Get available voices for a provider (or all providers).
 */
export function getVoices(provider?: TtsProvider): TtsVoice[] {
  if (provider === 'kokoro') return KOKORO_VOICES;
  if (provider === 'elevenlabs-fal') return ELEVENLABS_FAL_VOICES;
  if (provider === 'elevenlabs') return ELEVENLABS_DIRECT_VOICES;
  return [...KOKORO_VOICES, ...ELEVENLABS_FAL_VOICES, ...ELEVENLABS_DIRECT_VOICES];
}

/**
 * Get available providers based on which API keys are configured.
 */
export async function getAvailableProviders(): Promise<{ id: TtsProvider; name: string; configured: boolean }[]> {
  const settings = await getGlobalSettings();
  return [
    { id: 'elevenlabs-fal', name: 'ElevenLabs via fal.ai (multilingual)', configured: !!settings.falApiKey },
    { id: 'kokoro', name: 'Kokoro (fal.ai)', configured: !!settings.falApiKey },
    { id: 'elevenlabs', name: 'ElevenLabs (direct API)', configured: !!settings.elevenLabsApiKey },
  ];
}

/**
 * Generate speech from text using the specified provider.
 */
export async function generateSpeech(
  text: string,
  provider: TtsProvider,
  voiceId: string,
  options?: { speed?: number; languageCode?: string },
): Promise<TtsResult> {
  if (provider === 'kokoro') {
    return generateKokoroSpeech(text, voiceId, options);
  }
  if (provider === 'elevenlabs-fal') {
    return generateElevenLabsFalSpeech(text, voiceId, options);
  }
  if (provider === 'elevenlabs') {
    return generateElevenLabsDirectSpeech(text, voiceId);
  }
  throw new Error(`Unknown TTS provider: ${provider}`);
}

// ── Kokoro (fal.ai) implementation ──────────────────────────────────

async function generateKokoroSpeech(
  text: string,
  voiceId: string,
  options?: { speed?: number },
): Promise<TtsResult> {
  const falApiKey = await getFalApiKey();
  if (!falApiKey) {
    throw new Error('fal.ai API key is not configured. Please set it in Settings.');
  }
  configureFal(falApiKey);

  const voice = KOKORO_VOICES.find(v => v.id === voiceId);
  const endpoint = voice ? (KOKORO_ENDPOINTS[voice.language] || 'fal-ai/kokoro') : 'fal-ai/kokoro';

  const safeVoiceId = voiceId.replace(/[\r\n\t]/g, '');
  console.log(`[tts] Kokoro: endpoint=${endpoint} voice=${safeVoiceId} text=${text.length} chars`);

  const result = await withRetry(
    () => fal.subscribe(endpoint, {
      input: {
        prompt: text,
        voice: voiceId,
        speed: options?.speed ?? 1,
      },
    }),
    'Kokoro',
  );

  const audioUrl = (result.data as { audio?: { url?: string } })?.audio?.url;
  if (!audioUrl) throw new Error('Kokoro TTS returned no audio URL');

  const parsedUrl = new URL(audioUrl);
  if (!parsedUrl.hostname.endsWith('.fal.media') && !parsedUrl.hostname.endsWith('.fal.ai')) {
    throw new Error(`Unexpected audio URL domain: ${parsedUrl.hostname}`);
  }

  const response = await withRetry(
    async () => {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Failed to download Kokoro audio: ${res.status}`);
      return res;
    },
    'Kokoro download',
  );

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'audio/wav';
  return { audioBuffer, contentType, provider: 'kokoro', voiceId };
}

// ── Retry helper for transient network errors ──────────────────────

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN']);

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  // Check direct code
  const code = String(e.code ?? '').toUpperCase();
  if (RETRYABLE_CODES.has(code)) return true;
  // Check cause.code (Node.js fetch wraps in TypeError with cause)
  const cause = e.cause as Record<string, unknown> | undefined;
  if (cause) {
    const causeCode = String(cause.code ?? '').toUpperCase();
    if (RETRYABLE_CODES.has(causeCode)) return true;
  }
  // Check message
  const msg = String(e.message ?? '').toLowerCase();
  if (msg.includes('terminated') || msg.includes('econnreset') || msg.includes('socket hang up')) return true;
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = 1000 * (attempt + 1); // 1s, 2s
        console.warn(`[tts] ${label}: retryable error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, (err as Error).message);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ── ElevenLabs via fal.ai implementation ────────────────────────────

async function generateElevenLabsFalSpeech(
  text: string,
  voiceId: string,
  options?: { languageCode?: string },
): Promise<TtsResult> {
  const falApiKey = await getFalApiKey();
  if (!falApiKey) {
    throw new Error('fal.ai API key is not configured. Please set it in Settings.');
  }
  configureFal(falApiKey);

  const languageCode = options?.languageCode || detectLanguage(text);

  const safeVoiceId = voiceId.replace(/[\r\n\t]/g, '');
  console.log(`[tts] ElevenLabs-fal: voice=${safeVoiceId} lang=${languageCode} text=${text.length} chars`);

  const result = await withRetry(
    () => fal.subscribe('fal-ai/elevenlabs/text-to-dialogue/eleven-v3', {
      input: {
        inputs: [{ text, voice: voiceId }],
        language_code: languageCode,
        stability: 0.5,
      },
    }),
    'ElevenLabs-fal',
  );

  const audioUrl = (result.data as { audio?: { url?: string } })?.audio?.url;
  if (!audioUrl) throw new Error('ElevenLabs-fal TTS returned no audio URL');

  const parsedUrl = new URL(audioUrl);
  if (!parsedUrl.hostname.endsWith('.fal.media') && !parsedUrl.hostname.endsWith('.fal.ai')) {
    throw new Error(`Unexpected audio URL domain: ${parsedUrl.hostname}`);
  }

  // Download with retry (fal.media can also ECONNRESET)
  const response = await withRetry(
    async () => {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Failed to download ElevenLabs-fal audio: ${res.status}`);
      return res;
    },
    'ElevenLabs-fal download',
  );

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  return { audioBuffer, contentType, provider: 'elevenlabs-fal', voiceId };
}

/**
 * Simple language detection: Cyrillic chars → ru, else en.
 */
function detectLanguage(text: string): string {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const totalAlpha = (text.match(/\p{L}/gu) || []).length;
  if (totalAlpha > 0 && cyrillicCount / totalAlpha > 0.3) return 'ru';
  return 'en';
}

// ── ElevenLabs direct API implementation ────────────────────────────

const ELEVENLABS_TIMEOUT_MS = 120_000;

async function generateElevenLabsDirectSpeech(
  text: string,
  voiceId: string,
): Promise<TtsResult> {
  const settings = await getGlobalSettings();
  const apiKey = settings.elevenLabsApiKey;
  if (!apiKey) {
    throw new Error('ElevenLabs API key is not configured. Please set it in Settings.');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(voiceId)) {
    throw new Error('Invalid ElevenLabs voice ID format: contains disallowed characters');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);

  const safeVoiceId = voiceId.replace(/[\r\n\t]/g, '');
  console.log(`[tts] ElevenLabs-direct: voice=${safeVoiceId} text=${text.length} chars`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (controller.signal.aborted) throw new Error('ElevenLabs TTS request timed out (120s)');
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return { audioBuffer, contentType: 'audio/mpeg', provider: 'elevenlabs', voiceId };
}
