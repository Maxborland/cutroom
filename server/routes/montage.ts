import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { readLimiter, mutationLimiter, generationLimiter } from '../lib/rate-limit.js';
import { getProject, withProject, ensureDir, resolveProjectPath } from '../lib/storage.js';
import type { NarrationAnchor, ShotVideoDescription, ShotVideoDescriptionMoment } from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getApiKey, getGlobalSettings } from '../lib/config.js';
import { normalizeVoiceoverText } from '../lib/tts-utils.js';
import { matchNarrationAnchors, summarizeAnchorCoverage } from '../lib/montage-anchor-matching.js';

const router = Router({ mergeParams: true });
const VIDEO_DESCRIPTION_VERSION = 1;

// Helper: load project or 404
async function loadProject(req: Request, res: Response) {
  const project = await getProject(req.params.id);
  if (!project) {
    sendApiError(res, 404, 'Project not found');
    return null;
  }
  return project;
}

function isExternalMediaRef(value: string) {
  return /^https?:\/\//i.test(value) || /^data:/i.test(value);
}

async function resolveLocalShotVideoPath(projectId: string, shotId: string, videoFile: string) {
  const candidates = [
    resolveProjectPath(projectId, 'shots', shotId, 'video', videoFile),
    resolveProjectPath(projectId, videoFile),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeMoment(moment: unknown, index: number): ShotVideoDescriptionMoment | null {
  if (!moment || typeof moment !== 'object') {
    return null;
  }

  const record = moment as Record<string, unknown>;
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : `Moment ${index + 1}`;
  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary.trim()
    : label;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `moment-${index + 1}`;
  const startSec = typeof record.startSec === 'number' && Number.isFinite(record.startSec)
    ? record.startSec
    : undefined;
  const endSec = typeof record.endSec === 'number' && Number.isFinite(record.endSec)
    ? record.endSec
    : undefined;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];

  return { id, label, startSec, endSec, tags, summary };
}

function buildFallbackVideoDescription(shot: {
  scene?: string;
  audioDescription?: string;
  imagePrompt?: string;
  videoPrompt?: string;
}): ShotVideoDescription {
  const summarySource = [
    shot.videoPrompt,
    shot.audioDescription,
    shot.imagePrompt,
    shot.scene,
  ].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || 'Видео шота готово к монтажу.';
  const tags = [
    shot.scene,
    shot.audioDescription,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const matchHints = [
    shot.videoPrompt,
    shot.imagePrompt,
    shot.audioDescription,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    version: VIDEO_DESCRIPTION_VERSION,
    summary: summarySource,
    tags,
    matchHints,
    moments: [],
  };
}

function parseVideoDescriptionResponse(
  rawResponse: string,
  shot: {
    scene?: string;
    audioDescription?: string;
    imagePrompt?: string;
    videoPrompt?: string;
  },
): ShotVideoDescription {
  const trimmed = rawResponse.trim();
  const normalized = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const fallback = buildFallbackVideoDescription(shot);
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallback.summary;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : fallback.tags;
    const matchHints = Array.isArray(parsed.matchHints)
      ? parsed.matchHints.filter((hint): hint is string => typeof hint === 'string' && hint.trim().length > 0)
      : fallback.matchHints;
    const moments = Array.isArray(parsed.moments)
      ? parsed.moments
        .map((moment, index) => normalizeMoment(moment, index))
        .filter((moment): moment is ShotVideoDescriptionMoment => Boolean(moment))
      : [];

    return {
      version: VIDEO_DESCRIPTION_VERSION,
      summary,
      tags,
      matchHints,
      moments,
    };
  } catch {
    return buildFallbackVideoDescription(shot);
  }
}

const VALID_ANCHOR_INTENTS: NarrationAnchor['intent'][] = ['hook', 'feature', 'detail', 'lifestyle', 'cta'];

function normalizeAnchor(anchor: unknown, index: number): NarrationAnchor | null {
  if (!anchor || typeof anchor !== 'object') {
    return null;
  }

  const record = anchor as Record<string, unknown>;
  const sourceText = typeof record.sourceText === 'string' && record.sourceText.trim()
    ? record.sourceText.trim()
    : typeof record.label === 'string' && record.label.trim()
      ? record.label.trim()
      : null;

  if (!sourceText) {
    return null;
  }

  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : sourceText;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `anchor-${index + 1}`;
  const order = typeof record.order === 'number' && Number.isFinite(record.order) && record.order >= 0
    ? record.order
    : index;
  const intent = typeof record.intent === 'string' && VALID_ANCHOR_INTENTS.includes(record.intent as NarrationAnchor['intent'])
    ? record.intent as NarrationAnchor['intent']
    : 'feature';

  return {
    id,
    sourceText,
    label,
    order,
    intent,
  };
}

function buildFallbackAnchors(voiceoverScript: string): NarrationAnchor[] {
  const segments = voiceoverScript
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.map((segment, index) => ({
    id: `anchor-${index + 1}`,
    sourceText: segment,
    label: segment,
    order: index,
    intent: index === 0 ? 'hook' : 'feature',
  }));
}

function parseNarrationAnchorsResponse(rawResponse: string, voiceoverScript: string): NarrationAnchor[] {
  const trimmed = rawResponse.trim();
  const normalized = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const rawAnchors = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { anchors?: unknown[] }).anchors)
        ? (parsed as { anchors: unknown[] }).anchors
        : [];
    const anchors = rawAnchors
      .map((anchor, index) => normalizeAnchor(anchor, index))
      .filter((anchor): anchor is NarrationAnchor => Boolean(anchor));

    const orderedAnchors = anchors
      .map((anchor, index) => ({ anchor, sourceIndex: index }))
      .sort((left, right) => {
        const byOrder = left.anchor.order - right.anchor.order;
        if (byOrder !== 0) return byOrder;
        const byStart = (left.anchor.startSec ?? left.sourceIndex) - (right.anchor.startSec ?? right.sourceIndex);
        if (byStart !== 0) return byStart;
        return left.sourceIndex - right.sourceIndex;
      })
      .map(({ anchor }, index) => ({
        ...anchor,
        order: index + 1,
      }));

    return orderedAnchors.length > 0 ? orderedAnchors : buildFallbackAnchors(voiceoverScript);
  } catch {
    return buildFallbackAnchors(voiceoverScript);
  }
}

// POST /api/projects/:id/montage/generate-vo-script
router.post('/montage/generate-vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.script || !project.script.trim()) {
      sendApiError(res, 400, 'Project has no script. Generate a script first.');
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendApiError(res, 400, 'OpenRouter API key is not configured. Please set it in Settings.');
      return;
    }

    const settings = await getGlobalSettings();
    const model = settings.defaultScriptModel || settings.defaultTextModel || 'openai/gpt-4o';
    const targetDuration = project.brief?.targetDuration || 60;

    const systemPrompt = `You are a professional narrator script writer for premium real estate video ads.

Given the full production script (which contains camera directions, shot descriptions,
and technical prompts), extract ONLY the narrator's spoken text.

Rules:
- Write in Russian
- Remove all camera/technical directions
- Keep the emotional arc: hook -> reveal -> payoff
- One flowing text, not per-shot fragments
- Target duration: approximately ${targetDuration} seconds of speech
- Elegant, premium tone -- selling a lifestyle, not square meters
- No stage directions in brackets`;

    const voiceoverScript = await chatCompletion(
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: project.script },
      ],
      0.7,
    );

    await withProject(project.id, (proj) => {
      proj.voiceoverScript = voiceoverScript;
      proj.voiceoverScriptApproved = false;
    });

    res.json({ voiceoverScript });
  } catch (err) {
    console.error('Failed to generate voiceover script:', err);
    sendApiError(res, 500, 'Failed to generate voiceover script');
  }
});

// PUT /api/projects/:id/montage/vo-script
router.put('/montage/vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { voiceoverScript } = req.body;
    if (typeof voiceoverScript !== 'string') {
      sendApiError(res, 400, 'voiceoverScript is required and must be a string');
      return;
    }

    const updated = await withProject(project.id, (proj) => {
      proj.voiceoverScript = voiceoverScript;
      proj.voiceoverScriptApproved = false;
      return proj;
    });

    res.json(updated);
  } catch (err) {
    console.error('Failed to update voiceover script:', err);
    sendApiError(res, 500, 'Failed to update voiceover script');
  }
});

// POST /api/projects/:id/montage/approve-vo-script
router.post('/montage/approve-vo-script', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    // Validation inside withProject to avoid race with concurrent PUT /vo-script
    const result = await withProject(project.id, (proj) => {
      if (!proj.voiceoverScript || !proj.voiceoverScript.trim()) {
        return { error: 'Cannot approve: voiceover script is empty or missing' } as const;
      }
      proj.voiceoverScriptApproved = true;
      return { approved: true } as const;
    });

    if ('error' in result) {
      sendApiError(res, 400, result.error);
      return;
    }

    res.json({ approved: true });
  } catch (err) {
    console.error('Failed to approve voiceover script:', err);
    sendApiError(res, 500, 'Failed to approve voiceover script');
  }
});

// GET /api/projects/:id/montage/voices
// Returns available TTS providers and voices
router.get('/montage/voices', async (_req: Request, res: Response) => {
  try {
    const { getAvailableProviders, getVoices } = await import('../lib/tts-providers.js');
    const providers = await getAvailableProviders();
    const voices = getVoices();
    res.json({ providers, voices });
  } catch (err) {
    console.error('Failed to get voices:', err);
    sendApiError(res, 500, 'Failed to get voices');
  }
});

// POST /api/projects/:id/montage/normalize-vo-text
// Preview endpoint for text normalization before TTS generation
router.post('/montage/normalize-vo-text', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { text, pass, provider } = req.body ?? {};
    const sourceText = typeof text === 'string'
      ? text
      : (project.voiceoverScript || '');

    if (!sourceText.trim()) {
      sendApiError(res, 400, 'Text is required for normalization');
      return;
    }

    const parsedPass = typeof pass === 'number'
      ? pass
      : Number.parseInt(String(pass ?? ''), 10);

    const validProviders = ['elevenlabs-fal', 'elevenlabs', 'kokoro'] as const;
    const resolvedProvider = validProviders.includes(provider) ? provider : undefined;

    const normalizedText = normalizeVoiceoverText(sourceText, {
      pass: Number.isFinite(parsedPass) && parsedPass > 0 ? parsedPass : 1,
      provider: resolvedProvider,
    });
    res.json({ normalizedText });
  } catch (err) {
    console.error('Failed to normalize voiceover text:', err);
    sendApiError(res, 500, 'Failed to normalize voiceover text');
  }
});

// POST /api/projects/:id/montage/generate-voiceover
router.post('/montage/generate-voiceover', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.voiceoverScriptApproved) {
      sendApiError(res, 400, 'Voiceover script must be approved before generating audio');
      return;
    }

    // Capture the script text at generation time for TOCTOU comparison
    const scriptAtGeneration = project.voiceoverScript || '';

    // Determine provider and voice from request body → project → settings → defaults
    const settings = await getGlobalSettings();
    const { getAvailableProviders, generateSpeech } = await import('../lib/tts-providers.js');
    type TtsProvider = 'kokoro' | 'elevenlabs-fal' | 'elevenlabs';

    const requestedProvider = (req.body.provider || project.voiceoverProvider || settings.defaultVoiceoverProvider || 'elevenlabs-fal') as TtsProvider;
    const defaultVoices: Record<string, string> = {
      'kokoro': 'af_heart',
      'elevenlabs-fal': 'Aria',
      'elevenlabs': 'pNInz6obpgDQGcFmaJgB',
    };
    const requestedVoice = req.body.voiceId || project.voiceoverVoiceId || settings.defaultVoiceoverVoiceId || defaultVoices[requestedProvider] || 'Aria';

    // Validate provider is a known value
    const validProviders: TtsProvider[] = ['kokoro', 'elevenlabs-fal', 'elevenlabs'];
    if (!validProviders.includes(requestedProvider)) {
      sendApiError(res, 400, `Unknown TTS provider: ${String(requestedProvider).slice(0, 50)}`);
      return;
    }

    const normalizedScript = normalizeVoiceoverText(scriptAtGeneration, {
      provider: requestedProvider,
      pass: 1,
    });

    if (!normalizedScript.trim()) {
      sendApiError(res, 400, 'Voiceover text is empty after normalization');
      return;
    }

    // Validate voiceId belongs to the selected provider
    const { getVoices } = await import('../lib/tts-providers.js');
    const providerVoices = getVoices(requestedProvider);
    if (providerVoices.length > 0 && !providerVoices.some(v => v.id === requestedVoice)) {
      sendApiError(res, 400, `Voice '${String(requestedVoice).slice(0, 50)}' does not belong to provider '${requestedProvider}'`);
      return;
    }

    // Verify provider is configured
    const providers = await getAvailableProviders();
    const providerInfo = providers.find(p => p.id === requestedProvider);
    if (!providerInfo?.configured) {
      const keyName = requestedProvider === 'kokoro' ? 'fal.ai' : 'ElevenLabs';
      sendApiError(res, 400, `${keyName} API key is not configured. Please set it in Settings.`);
      return;
    }

    // Generate speech using normalized text for better TTS prosody
    const result = await generateSpeech(normalizedScript, requestedProvider, requestedVoice);

    // Validate audio content type before writing to disk
    const allowedAudioTypes = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/wave', 'audio/x-wav'];
    if (!allowedAudioTypes.some(t => result.contentType.includes(t))) {
      sendApiError(res, 500, `Unexpected audio content type from TTS provider: ${result.contentType.slice(0, 50)}`);
      return;
    }

    // Write to unique temp file first, promote only after validation passes
    const montageDir = resolveProjectPath(project.id, 'montage');
    await ensureDir(montageDir);
    const ext = result.contentType.includes('wav') ? 'wav' : 'mp3';
    const tmpName = `voiceover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp.${ext}`;
    const tmpPath = path.join(montageDir, tmpName);
    // Validate write path stays within montage dir
    if (!path.resolve(tmpPath).startsWith(path.resolve(montageDir) + path.sep)) {
      throw new Error('Path escapes montage directory');
    }
    // Validate audio buffer before writing (size cap 50MB, must be Buffer)
    if (!Buffer.isBuffer(result.audioBuffer) || result.audioBuffer.length > 50 * 1024 * 1024) {
      throw new Error('Invalid or oversized audio data');
    }
    const safeAudio = Buffer.from(result.audioBuffer);
    await fs.writeFile(tmpPath, safeAudio);

    // Re-check approval AND script content inside withProject to prevent TOCTOU race
    const finalFilename = `voiceover.${ext}`;
    const updateResult = await withProject(project.id, (proj) => {
      if (!proj.voiceoverScriptApproved) {
        return { error: 'Voiceover script approval was reset during generation. Please re-approve and try again.' } as const;
      }
      if (proj.voiceoverScript !== scriptAtGeneration) {
        return { error: 'Voiceover script was modified during generation. Please re-approve and regenerate.' } as const;
      }
      proj.voiceoverFile = `montage/${finalFilename}`;
      proj.voiceoverProvider = requestedProvider;
      proj.voiceoverVoiceId = requestedVoice;
      return { ok: true } as const;
    });

    if ('error' in updateResult) {
      await fs.unlink(tmpPath).catch(() => {});
      sendApiError(res, 409, updateResult.error);
      return;
    }

    // Promote temp file to final path
    const voiceoverPath = path.join(montageDir, finalFilename);
    await fs.rename(tmpPath, voiceoverPath);

    res.json({
      voiceoverFile: `montage/${finalFilename}`,
      provider: requestedProvider,
      voiceId: requestedVoice,
    });
  } catch (err) {
    console.error('Failed to generate voiceover:', err);
    const msg = err instanceof Error ? err.message : 'Failed to generate voiceover';
    sendApiError(res, 500, msg);
  }
});

// ─── Audio upload helpers ───────────────────────────────────────────

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

const ALLOWED_AUDIO_EXTENSIONS = new Set(Object.keys(AUDIO_MIME_TYPES));

function getMimeForExt(ext: string): string {
  return AUDIO_MIME_TYPES[ext] || 'application/octet-stream';
}

const ALLOWED_AUDIO_MIMES = new Set(Object.values(AUDIO_MIME_TYPES));

function createAudioUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const extValid = ALLOWED_AUDIO_EXTENSIONS.has(ext);
      const mimeValid = ALLOWED_AUDIO_MIMES.has(file.mimetype);
      if (extValid && mimeValid) {
        cb(null, true);
      } else {
        cb(new Error('Недопустимый формат файла. Разрешены: mp3, wav, m4a, ogg, aac'));
      }
    },
  });
}

const voiceoverUpload = createAudioUpload();
const musicUpload = createAudioUpload();

// DELETE /api/projects/:id/montage/voiceover
router.delete('/montage/voiceover', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    // Atomic: check + clear inside withProject to prevent race with concurrent upload
    const deletedFile = await withProject(project.id, (proj) => {
      if (!proj.voiceoverFile) return null;
      const file = proj.voiceoverFile;
      delete proj.voiceoverFile;
      delete proj.voiceoverProvider;
      delete proj.voiceoverVoiceId;
      return file;
    });

    if (!deletedFile) {
      sendApiError(res, 404, 'No voiceover to delete');
      return;
    }

    // Remove file after clearing reference (safe even if file missing)
    const filePath = resolveProjectPath(project.id, deletedFile);
    await fs.unlink(filePath).catch(() => {});

    res.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete voiceover:', err);
    sendApiError(res, 500, 'Failed to delete voiceover');
  }
});

// POST /api/projects/:id/montage/upload-voiceover
// Upload custom voiceover audio — validates project before buffering
router.post('/montage/upload-voiceover', mutationLimiter, async (req: Request, res: Response) => {
  const project = await loadProject(req, res);
  if (!project) return;

  voiceoverUpload.single('voiceover')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        sendApiError(res, 400, multerErr.message);
        return;
      }

      if (!req.file) {
        sendApiError(res, 400, 'Файл озвучки не предоставлен');
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const ALLOWED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']);
      if (!ALLOWED_AUDIO_EXTS.has(ext)) {
        sendApiError(res, 400, `Unsupported audio format: ${ext}`);
        return;
      }

      const montageDir = resolveProjectPath(project.id, 'montage');
      await ensureDir(montageDir);

      const filename = `voiceover${ext}`;
      const filePath = path.join(montageDir, filename);
      await fs.writeFile(filePath, req.file.buffer);

      const voiceoverFile = `montage/${filename}`;
      await withProject(project.id, (proj) => {
        proj.voiceoverFile = voiceoverFile;
        proj.voiceoverProvider = 'manual';
        delete proj.voiceoverVoiceId;
      });

      res.json({ voiceoverFile, provider: 'manual' });
    } catch (err) {
      console.error('Failed to upload voiceover:', err);
      sendApiError(res, 500, 'Failed to upload voiceover');
    }
  });
});

// GET /api/projects/:id/montage/voiceover
router.get('/montage/voiceover', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.voiceoverFile) {
      sendApiError(res, 404, 'Voiceover file not found');
      return;
    }

    const filePath = resolveProjectPath(project.id, project.voiceoverFile);

    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'Voiceover file not found on disk');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', getMimeForExt(ext));
    const stream = fsCb.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        sendApiError(res, 500, 'Failed to stream voiceover');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Failed to stream voiceover:', err);
    sendApiError(res, 500, 'Failed to stream voiceover');
  }
});

// POST /api/projects/:id/montage/generate-music-prompt
// Generates a music prompt via LLM that the user can copy into Suno UI
router.post('/montage/generate-music-prompt', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendApiError(res, 400, 'OpenRouter API key is not configured. Please set it in Settings.');
      return;
    }

    const settings = await getGlobalSettings();
    const model = settings.defaultTextModel || 'openai/gpt-4o';
    const targetDuration = project.brief?.targetDuration || 60;
    const style = settings.defaultMusicStyle || 'cinematic instrumental';

    const systemPrompt = `You are a music director for premium real estate video ads.
Generate a detailed music prompt for Suno AI that will produce the perfect background track.

Rules:
- Output ONLY the prompt text, nothing else
- Instrumental only, no vocals
- Style: ${style}
- Target duration: approximately ${targetDuration} seconds
- The music must work as background for voiceover narration
- Premium, sophisticated tone matching luxury real estate
- Include specific mood, instruments, tempo, and energy arc
- Write in English (Suno works best with English prompts)`;

    const userContent = project.script
      ? `Based on this video script, generate a music prompt:\n\n${project.script}`
      : `Generate a music prompt for a ${targetDuration}-second premium real estate video ad.`;

    const musicPrompt = await chatCompletion(
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      0.7,
    );

    // Save the generated prompt to the project
    await withProject(project.id, (proj) => {
      proj.musicPrompt = musicPrompt;
    });

    res.json({ musicPrompt });
  } catch (err) {
    console.error('Failed to generate music prompt:', err);
    sendApiError(res, 500, 'Failed to generate music prompt');
  }
});

// POST /api/projects/:id/montage/upload-music
// Check project existence BEFORE multer parses body (avoid buffering 50MB for 404)
router.post('/montage/upload-music', mutationLimiter, async (req: Request, res: Response) => {
  const project = await loadProject(req, res);
  if (!project) return;

  musicUpload.single('music')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        sendApiError(res, 400, multerErr.message);
        return;
      }

      if (!req.file) {
        sendApiError(res, 400, 'No music file provided');
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const montageDir = resolveProjectPath(project.id, 'montage');
      await ensureDir(montageDir);

      const filename = `music${ext}`;
      const filePath = path.join(montageDir, filename);
      await fs.writeFile(filePath, req.file.buffer);

      const musicFile = `montage/${filename}`;
      await withProject(project.id, (proj) => {
        proj.musicFile = musicFile;
        proj.musicProvider = 'manual';
      });

      res.json({ musicFile, provider: 'manual' });
    } catch (err) {
      console.error('Failed to upload music:', err);
      sendApiError(res, 500, 'Failed to upload music');
    }
  });
});

// DELETE /api/projects/:id/montage/music
router.delete('/montage/music', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    // Atomic: check + clear inside withProject to prevent race with concurrent upload
    const deletedFile = await withProject(project.id, (proj) => {
      if (!proj.musicFile) return null;
      const file = proj.musicFile;
      delete proj.musicFile;
      delete proj.musicProvider;
      // Keep musicPrompt for re-generation convenience
      return file;
    });

    if (!deletedFile) {
      sendApiError(res, 404, 'No music to delete');
      return;
    }

    // Remove file after clearing reference
    const filePath = resolveProjectPath(project.id, deletedFile);
    await fs.unlink(filePath).catch(() => {});

    res.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete music:', err);
    sendApiError(res, 500, 'Failed to delete music');
  }
});

// GET /api/projects/:id/montage/music
router.get('/montage/music', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.musicFile) {
      sendApiError(res, 404, 'Music file not found');
      return;
    }

    const filePath = resolveProjectPath(project.id, project.musicFile);

    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'Music file not found on disk');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', getMimeForExt(ext));
    const stream = fsCb.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        sendApiError(res, 500, 'Failed to stream music');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Failed to stream music:', err);
    sendApiError(res, 500, 'Failed to stream music');
  }
});

// PUT /api/projects/:id/montage/music-prompt
router.put('/montage/music-prompt', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { musicPrompt } = req.body;
    if (typeof musicPrompt !== 'string') {
      sendApiError(res, 400, 'musicPrompt is required and must be a string');
      return;
    }

    const updated = await withProject(project.id, (proj) => {
      proj.musicPrompt = musicPrompt;
      return proj;
    });

    res.json(updated);
  } catch (err) {
    console.error('Failed to update music prompt:', err);
    sendApiError(res, 500, 'Failed to update music prompt');
  }
});

// POST /api/projects/:id/montage/describe-videos
router.post('/montage/describe-videos', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const approvedShots = project.shots.filter((shot) => shot.status === 'approved');
    if (approvedShots.length === 0) {
      res.json({ described: 0, skipped: 0, shots: [], skippedShots: [] });
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendApiError(res, 400, 'OpenRouter API key is not configured. Please set it in Settings.');
      return;
    }

    const settings = await getGlobalSettings();
    const model = settings.defaultDescribeModel || settings.defaultTextModel || settings.defaultScriptModel || 'openai/gpt-4o-mini';
    const describedShots: Array<{ shotId: string; videoDescription: ShotVideoDescription }> = [];
    const skippedShots: Array<{ shotId: string; reason: string }> = [];

    for (const shot of approvedShots) {
      if (!shot.videoFile) {
        skippedShots.push({ shotId: shot.id, reason: 'missing_local_video' });
        continue;
      }

      if (isExternalMediaRef(shot.videoFile)) {
        skippedShots.push({ shotId: shot.id, reason: 'external_video_not_cached' });
        continue;
      }

      const localVideoPath = await resolveLocalShotVideoPath(project.id, shot.id, shot.videoFile);
      if (!localVideoPath) {
        skippedShots.push({ shotId: shot.id, reason: 'missing_local_video' });
        continue;
      }

      const systemPrompt = `You describe a finished real-estate video shot for AI-assisted montage planning.
Return ONLY valid JSON with this exact shape:
{
  "summary": "short Russian summary",
  "tags": ["visual tag"],
  "matchHints": ["phrase usable to match narrator anchors"],
  "moments": [
    {
      "id": "moment-1",
      "label": "short label",
      "startSec": 0,
      "endSec": 3,
      "tags": ["tag"],
      "summary": "moment summary in Russian"
    }
  ]
}
If exact moments are unclear, return an empty moments array.`;

      const userPrompt = [
        `Shot scene: ${shot.scene || 'n/a'}`,
        `Audio description: ${shot.audioDescription || 'n/a'}`,
        `Image prompt: ${shot.imagePrompt || 'n/a'}`,
        `Video prompt: ${shot.videoPrompt || 'n/a'}`,
        `Local video file is available: ${path.basename(localVideoPath)}`,
      ].join('\n');

      try {
        const llmResponse = await chatCompletion(
          model,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          0.2,
        );

        describedShots.push({
          shotId: shot.id,
          videoDescription: parseVideoDescriptionResponse(llmResponse, shot),
        });
      } catch (err) {
        console.error(`Failed to describe video for shot ${shot.id}:`, err);
        skippedShots.push({ shotId: shot.id, reason: 'description_failed' });
      }
    }

    if (describedShots.length > 0) {
      const descriptionsByShotId = new Map(
        describedShots.map(({ shotId, videoDescription }) => [shotId, videoDescription]),
      );

      await withProject(project.id, (proj) => {
        for (const shot of proj.shots) {
          const videoDescription = descriptionsByShotId.get(shot.id);
          if (videoDescription) {
            shot.videoDescription = videoDescription;
          }
        }
      });
    }

    res.json({
      described: describedShots.length,
      skipped: skippedShots.length,
      shots: describedShots,
      skippedShots,
    });
  } catch (err) {
    console.error('Failed to describe montage videos:', err);
    sendApiError(res, 500, 'Failed to describe videos');
  }
});

// POST /api/projects/:id/montage/extract-anchors
router.post('/montage/extract-anchors', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const voiceoverScript = project.voiceoverScript?.trim();
    if (!voiceoverScript) {
      sendApiError(res, 400, 'Сначала добавьте текст озвучки, чтобы извлечь смысловые якоря.');
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendApiError(res, 400, 'OpenRouter API key is not configured. Please set it in Settings.');
      return;
    }

    const settings = await getGlobalSettings();
    const model = settings.defaultScriptModel || settings.defaultTextModel || 'openai/gpt-4o-mini';
    const systemPrompt = `You extract ordered narrator anchors for AI-assisted montage planning.
Return ONLY valid JSON in one of these forms:
[
  {
    "id": "anchor-1",
    "sourceText": "exact Russian phrase from the voiceover",
    "label": "short Russian anchor label",
    "order": 1,
    "intent": "hook|feature|detail|lifestyle|cta"
  }
]
or
{ "anchors": [ ... ] }

Rules:
- Keep sourceText in Russian and close to the original voiceover wording
- Preserve story order
- Prefer 3-8 meaningful anchors
- Keep labels short and montage-friendly`;

    const anchorsResponse = await chatCompletion(
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: voiceoverScript },
      ],
      0.2,
    );

    const anchors = parseNarrationAnchorsResponse(anchorsResponse, voiceoverScript);

    await withProject(project.id, (proj) => {
      proj.narrationAnchors = anchors;
      delete proj.anchorMatches;
      delete proj.anchorCoverageSummary;
    });

    res.json({ anchors });
  } catch (err) {
    console.error('Failed to extract narration anchors:', err);
    sendApiError(res, 500, 'Failed to extract narration anchors');
  }
});

// POST /api/projects/:id/montage/match-anchors
router.post('/montage/match-anchors', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.narrationAnchors || project.narrationAnchors.length === 0) {
      sendApiError(res, 400, 'Сначала извлеките смысловые якоря из текста озвучки.');
      return;
    }

    const approvedShots = project.shots.filter((shot) => shot.status === 'approved');
    if (approvedShots.length === 0) {
      sendApiError(res, 400, 'Нет утвержденных шотов для сопоставления с якорями.');
      return;
    }

    const result = matchNarrationAnchors(project);

    await withProject(project.id, (proj) => {
      proj.anchorMatches = result.anchorMatches;
      proj.anchorCoverageSummary = result.anchorCoverageSummary;
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to match narration anchors:', err);
    sendApiError(res, 500, 'Failed to match narration anchors');
  }
});

// PUT /api/projects/:id/montage/anchor-matches
router.put('/montage/anchor-matches', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.narrationAnchors || project.narrationAnchors.length === 0) {
      sendApiError(res, 400, 'Сначала извлеките смысловые якоря из текста озвучки.');
      return;
    }

    const rawAnchorMatches = req.body?.anchorMatches;
    if (!Array.isArray(rawAnchorMatches)) {
      sendApiError(res, 400, 'anchorMatches must be an array');
      return;
    }

    const anchorIds = new Set(project.narrationAnchors.map((anchor) => anchor.id));
    const approvedShotIds = new Set(project.shots.filter((shot) => shot.status === 'approved').map((shot) => shot.id));
    const normalizedMatches = [];

    for (const rawMatch of rawAnchorMatches) {
      if (!rawMatch || typeof rawMatch !== 'object') {
        sendApiError(res, 400, 'Некорректный формат anchorMatches.');
        return;
      }

      const match = rawMatch as Record<string, unknown>;
      const anchorId = typeof match.anchorId === 'string' ? match.anchorId : '';
      const selectedShotId = typeof match.selectedShotId === 'string' && match.selectedShotId.trim()
        ? match.selectedShotId.trim()
        : undefined;
      const selectedMomentId = typeof match.selectedMomentId === 'string' && match.selectedMomentId.trim()
        ? match.selectedMomentId.trim()
        : undefined;
      const confidence = typeof match.confidence === 'number' && Number.isFinite(match.confidence)
        ? match.confidence
        : 0;
      const status = match.status;
      const candidates = Array.isArray(match.candidates)
        ? match.candidates.filter((candidate): candidate is {
          shotId: string;
          momentId?: string;
          confidence: number;
          reason: string;
        } => {
          if (!candidate || typeof candidate !== 'object') return false;
          const record = candidate as Record<string, unknown>;
          return typeof record.shotId === 'string'
            && typeof record.confidence === 'number'
            && typeof record.reason === 'string';
        })
        : [];

      if (!anchorId || !anchorIds.has(anchorId)) {
        sendApiError(res, 400, 'Указан неизвестный якорь для ручного сопоставления.');
        return;
      }

      if (selectedShotId && !approvedShotIds.has(selectedShotId)) {
        sendApiError(res, 400, 'Для якоря выбран неизвестный или неутвержденный шот.');
        return;
      }

      if (status !== 'matched' && status !== 'weak_match' && status !== 'unmatched') {
        sendApiError(res, 400, 'Недопустимый статус сопоставления якоря.');
        return;
      }

      normalizedMatches.push({
        anchorId,
        selectedShotId,
        selectedMomentId,
        confidence,
        status,
        candidates,
      });
    }

    const coverage = summarizeAnchorCoverage(normalizedMatches);

    await withProject(project.id, (proj) => {
      proj.anchorMatches = normalizedMatches;
      proj.anchorCoverageSummary = coverage;
    });

    res.json({
      anchorMatches: normalizedMatches,
      anchorCoverageSummary: coverage,
    });
  } catch (err) {
    console.error('Failed to update anchor matches:', err);
    sendApiError(res, 500, 'Failed to update anchor matches');
  }
});

// POST /api/projects/:id/montage/generate-plan
router.post('/montage/generate-plan', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const approvedShots = project.shots.filter(s => s.status === 'approved');
    if (approvedShots.length === 0) {
      sendApiError(res, 400, 'No approved shots. Approve at least one shot before generating a montage plan.');
      return;
    }

    let planningProject = project;

    if (project.narrationAnchors?.length && (!project.anchorMatches || project.anchorMatches.length === 0)) {
      const matchResult = matchNarrationAnchors(project);
      planningProject = {
        ...project,
        anchorMatches: matchResult.anchorMatches,
        anchorCoverageSummary: matchResult.anchorCoverageSummary,
      };

      await withProject(project.id, (p) => {
        p.anchorMatches = matchResult.anchorMatches;
        p.anchorCoverageSummary = matchResult.anchorCoverageSummary;
      });
    }

    // Determine voiceover duration
    let voiceoverDurationSec: number;

    if (planningProject.voiceoverFile) {
      const voPath = resolveProjectPath(project.id, planningProject.voiceoverFile);
      const { probeDuration } = await import('../lib/normalize.js');
      voiceoverDurationSec = await probeDuration(voPath);
    } else {
      // Estimate from script: ~150 words/min for Russian
      const wordCount = (planningProject.script || '').split(/\s+/).filter(Boolean).length;
      voiceoverDurationSec = Math.max((wordCount / 150) * 60, 10);
    }

    // Normalize clips
    const { normalizeClips } = await import('../lib/normalize.js');
    await normalizeClips(project.id, approvedShots);

    // Generate plan
    const { generateMontagePlan } = await import('../lib/montage-plan.js');
    const montagePlan = generateMontagePlan(planningProject, voiceoverDurationSec);

    // Save to project
    await withProject(project.id, (p) => {
      p.montagePlan = montagePlan;
      p.stage = 'montage_draft';
    });

    res.json({ montagePlan });
  } catch (err) {
    console.error('Failed to generate montage plan:', err);
    sendApiError(res, 500, 'Failed to generate montage plan');
  }
});

// PUT /api/projects/:id/montage/plan
router.put('/montage/plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { montagePlan } = req.body;
    if (!montagePlan) {
      sendApiError(res, 400, 'montagePlan is required');
      return;
    }

    // Validate required fields
    if (!montagePlan.version || !montagePlan.timeline || !montagePlan.format || !montagePlan.audio || !montagePlan.style) {
      sendApiError(res, 400, 'Invalid montagePlan: missing required fields (version, timeline, format, audio, style)');
      return;
    }

    await withProject(project.id, (p) => {
      p.montagePlan = montagePlan;
    });

    res.json({ montagePlan });
  } catch (err) {
    console.error('Failed to update montage plan:', err);
    sendApiError(res, 500, 'Failed to update montage plan');
  }
});

// ─── Timeline editing endpoints ─────────────────────────────────────

const VALID_TRANSITION_TYPES = ['cut', 'fade', 'crossfade', 'slide_left', 'slide_right', 'zoom_blur', 'wipe'] as const;
const VALID_MOTION_EFFECTS = ['ken_burns', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right'] as const;

function getTimelineEntryIdentity(entry: { clipId?: string; shotId: string }): string {
  return typeof entry.clipId === 'string' && entry.clipId.trim() ? entry.clipId : entry.shotId;
}

function findTimelineEntryByIdentity<T extends { clipId?: string; shotId: string }>(timeline: T[], identity: string): T | undefined {
  return timeline.find((entry) => getTimelineEntryIdentity(entry) === identity);
}

function getTransitionEndpointIdentity(
  transition: { fromClipId?: string; fromShotId: string; toClipId?: string; toShotId: string },
  side: 'from' | 'to',
): string {
  if (side === 'from') {
    return typeof transition.fromClipId === 'string' && transition.fromClipId.trim()
      ? transition.fromClipId
      : transition.fromShotId;
  }

  return typeof transition.toClipId === 'string' && transition.toClipId.trim()
    ? transition.toClipId
    : transition.toShotId;
}

function resolveRequestedTimelineIdentity<T extends { clipId?: string; shotId: string }>(
  timeline: T[],
  entry: { clipId?: string; shotId: string },
): string | null {
  if (typeof entry.clipId === 'string' && entry.clipId.trim()) {
    return entry.clipId;
  }

  const matchingByShot = timeline.filter((timelineEntry) => timelineEntry.shotId === entry.shotId);
  if (matchingByShot.length === 1) {
    return getTimelineEntryIdentity(matchingByShot[0]);
  }

  if (matchingByShot.length === 0) {
    return entry.shotId;
  }

  return null;
}

// PUT /api/projects/:id/montage/plan/timeline
// Reorder timeline + rebuild transitions
router.put('/montage/plan/timeline', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'Сначала создайте план монтажа');
      return;
    }

    const rawTimeline = req.body.timeline;
    if (!Array.isArray(rawTimeline)) {
      sendApiError(res, 400, 'timeline must be an array');
      return;
    }
    const timeline = rawTimeline as Array<Record<string, unknown> & { shotId: string; clipId?: string; durationSec: number }>;

    // Validate: all entries must have clip identity and duration
    for (const entry of timeline) {
      if (!entry.shotId || typeof entry.durationSec !== 'number' || entry.durationSec <= 0) {
        sendApiError(res, 400, `Invalid timeline entry: shotId and positive durationSec required`);
        return;
      }
    }

    // Validate: incoming clip identities must match existing plan
    const existingIds = new Set(project.montagePlan.timeline.map((entry) => getTimelineEntryIdentity(entry)));
    const newIds = new Set<string>();
    for (const entry of timeline) {
      const identity = resolveRequestedTimelineIdentity(project.montagePlan.timeline, entry);
      if (!identity) {
        sendApiError(res, 400, `Timeline entry shot ${String(entry.shotId).slice(0, 50)} is ambiguous; provide clipId`);
        return;
      }
      if (!existingIds.has(identity)) {
        sendApiError(res, 400, `Unknown timeline entry ID: ${String(identity).slice(0, 50)}`);
        return;
      }
      newIds.add(identity);
    }

    if (timeline.length !== project.montagePlan.timeline.length || newIds.size !== existingIds.size) {
      sendApiError(res, 400, 'Timeline must contain all existing clips exactly once');
      return;
    }

    // Rebuild startSec based on new order
    const introSec = project.montagePlan.motionGraphics.intro?.durationSec ?? 0;
    let cursor = introSec;
    const reordered = timeline.map((entry) => {
      const entryId = resolveRequestedTimelineIdentity(project.montagePlan.timeline, entry);
      if (!entryId) {
        throw new Error(`Timeline entry shot ${entry.shotId} is ambiguous`);
      }
      const existing = findTimelineEntryByIdentity(project.montagePlan!.timeline, entryId);
      const result = {
        ...existing,
        ...entry,
        clipId: entryId,
        startSec: cursor,
      };
      cursor += result.durationSec;
      return result;
    });

    // Rebuild transitions for new order
    const transitions = [];
    if (reordered.length > 0 && project.montagePlan.motionGraphics.intro) {
      transitions.push({
        fromClipId: 'intro',
        toClipId: reordered[0].clipId,
        fromShotId: 'intro',
        toShotId: reordered[0].shotId,
        type: 'fade' as const,
        durationSec: 0.5,
      });
    }
    for (let i = 0; i < reordered.length - 1; i++) {
      // Preserve existing transition type if it exists between these shots
      const existing = project.montagePlan.transitions.find(
        t =>
          getTransitionEndpointIdentity(t, 'from') === getTimelineEntryIdentity(reordered[i]) &&
          getTransitionEndpointIdentity(t, 'to') === getTimelineEntryIdentity(reordered[i + 1])
      );
      transitions.push({
        fromClipId: reordered[i].clipId,
        toClipId: reordered[i + 1].clipId,
        fromShotId: reordered[i].shotId,
        toShotId: reordered[i + 1].shotId,
        type: existing?.type ?? 'crossfade',
        durationSec: existing?.durationSec ?? 0.5,
      });
    }
    if (reordered.length > 0 && project.montagePlan.motionGraphics.outro) {
      transitions.push({
        fromClipId: reordered[reordered.length - 1].clipId,
        toClipId: 'outro',
        fromShotId: reordered[reordered.length - 1].shotId,
        toShotId: 'outro',
        type: 'fade' as const,
        durationSec: 0.5,
      });
    }

    const updatedPlan = await withProject(project.id, (p) => {
      if (!p.montagePlan) return null;
      p.montagePlan.timeline = reordered;
      p.montagePlan.transitions = transitions;
      return p.montagePlan;
    });

    res.json({ montagePlan: updatedPlan });
  } catch (err) {
    console.error('Failed to update timeline:', err);
    sendApiError(res, 500, 'Failed to update timeline');
  }
});

// PUT /api/projects/:id/montage/plan/timeline/:clipId
// Update individual clip: durationSec, trimEndSec, motionEffect
router.put('/montage/plan/timeline/:clipId', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'Сначала создайте план монтажа');
      return;
    }

    const { clipId } = req.params;
    const entryId = resolveRequestedTimelineIdentity(project.montagePlan.timeline, { shotId: clipId, clipId });
    const entry = entryId ? findTimelineEntryByIdentity(project.montagePlan.timeline, entryId) : undefined;
    if (!entry) {
      sendApiError(res, 404, `Clip ${String(clipId).slice(0, 50)} not in timeline`);
      return;
    }

    const { durationSec, trimEndSec, motionEffect } = req.body;

    if (durationSec !== undefined) {
      if (typeof durationSec !== 'number' || durationSec <= 0 || durationSec > 120) {
        sendApiError(res, 400, 'durationSec must be a number between 0 and 120');
        return;
      }
    }

    if (trimEndSec !== undefined && (typeof trimEndSec !== 'number' || trimEndSec < 0)) {
      sendApiError(res, 400, 'trimEndSec must be a non-negative number');
      return;
    }

    if (motionEffect !== undefined && motionEffect !== null) {
      if (!VALID_MOTION_EFFECTS.includes(motionEffect)) {
        sendApiError(res, 400, `Invalid motionEffect. Allowed: ${VALID_MOTION_EFFECTS.join(', ')}`);
        return;
      }
    }

    const updatedPlan = await withProject(project.id, (p) => {
      if (!p.montagePlan) return null;
      const target = entryId ? findTimelineEntryByIdentity(p.montagePlan.timeline, entryId) : undefined;
      if (!target) return null;

      if (durationSec !== undefined) target.durationSec = durationSec;
      if (trimEndSec !== undefined) target.trimEndSec = trimEndSec;
      if (motionEffect !== undefined) target.motionEffect = motionEffect || undefined;

      // Recalculate startSec for all entries
      const introSec = p.montagePlan.motionGraphics.intro?.durationSec ?? 0;
      let cursor = introSec;
      for (const e of p.montagePlan.timeline) {
        e.startSec = cursor;
        cursor += e.durationSec;
      }

      return p.montagePlan;
    });

    res.json({ montagePlan: updatedPlan });
  } catch (err) {
    console.error('Failed to update timeline entry:', err);
    sendApiError(res, 500, 'Failed to update timeline entry');
  }
});

// PUT /api/projects/:id/montage/plan/transitions/:index
// Update transition type and duration
router.put('/montage/plan/transitions/:index', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'Сначала создайте план монтажа');
      return;
    }

    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0 || index >= project.montagePlan.transitions.length) {
      sendApiError(res, 404, 'Transition index out of range');
      return;
    }

    const { type, durationSec } = req.body;

    if (type !== undefined) {
      if (!VALID_TRANSITION_TYPES.includes(type)) {
        sendApiError(res, 400, `Invalid transition type. Allowed: ${VALID_TRANSITION_TYPES.join(', ')}`);
        return;
      }
    }

    if (durationSec !== undefined) {
      if (typeof durationSec !== 'number' || durationSec < 0 || durationSec > 5) {
        sendApiError(res, 400, 'durationSec must be between 0 and 5');
        return;
      }
    }

    const updatedPlan = await withProject(project.id, (p) => {
      if (!p.montagePlan) return null;
      const transition = p.montagePlan.transitions[index];
      if (!transition) return null;

      if (type !== undefined) transition.type = type;
      if (durationSec !== undefined) transition.durationSec = durationSec;

      return p.montagePlan;
    });

    res.json({ montagePlan: updatedPlan });
  } catch (err) {
    console.error('Failed to update transition:', err);
    sendApiError(res, 500, 'Failed to update transition');
  }
});

// PUT /api/projects/:id/montage/plan/audio
// Update audio levels
router.put('/montage/plan/audio', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'Сначала создайте план монтажа');
      return;
    }

    const { audio } = req.body;
    if (!audio || typeof audio !== 'object') {
      sendApiError(res, 400, 'audio object is required');
      return;
    }

    const updatedPlan = await withProject(project.id, (p) => {
      if (!p.montagePlan) return null;

      // Merge audio levels (partial update)
      if (audio.voiceover) {
        if (typeof audio.voiceover.gainDb === 'number') {
          p.montagePlan.audio.voiceover.gainDb = audio.voiceover.gainDb;
        }
      }
      if (audio.music) {
        if (typeof audio.music.gainDb === 'number') {
          p.montagePlan.audio.music.gainDb = audio.music.gainDb;
        }
        if (typeof audio.music.duckingDb === 'number') {
          p.montagePlan.audio.music.duckingDb = audio.music.duckingDb;
        }
        if (typeof audio.music.duckFadeMs === 'number') {
          p.montagePlan.audio.music.duckFadeMs = audio.music.duckFadeMs;
        }
      }

      return p.montagePlan;
    });

    res.json({ montagePlan: updatedPlan });
  } catch (err) {
    console.error('Failed to update audio levels:', err);
    sendApiError(res, 500, 'Failed to update audio levels');
  }
});

// POST /api/projects/:id/montage/refine-plan
router.post('/montage/refine-plan', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'No montage plan exists. Generate a plan first.');
      return;
    }

    const { feedback } = req.body;
    if (!feedback || !feedback.trim()) {
      sendApiError(res, 400, 'feedback is required');
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendApiError(res, 500, 'OpenRouter API key not configured');
      return;
    }

    const systemPrompt = `You are a professional video editor. Given the current montage plan (JSON) and user feedback, output an updated JSON plan. Change only what the feedback asks. Preserve the overall structure. Return ONLY valid JSON, no markdown.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `Current montage plan:\n${JSON.stringify(project.montagePlan, null, 2)}\n\nFeedback: ${feedback}`,
      },
    ];

    const settings = await getGlobalSettings();
    const model = settings.defaultTextModel || 'openai/gpt-4o';

    const llmResponse = await chatCompletion(model, messages);

    // Parse LLM response as JSON
    let refinedPlan;
    try {
      // Strip markdown code fences if present
      const cleaned = llmResponse.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      refinedPlan = JSON.parse(cleaned);
    } catch {
      sendApiError(res, 500, 'LLM returned invalid JSON for refined plan');
      return;
    }

    // Validate refined plan has required structure
    if (!refinedPlan.version || !refinedPlan.timeline || !refinedPlan.format || !refinedPlan.audio || !refinedPlan.style) {
      sendApiError(res, 500, 'LLM returned plan missing required fields');
      return;
    }

    await withProject(project.id, (p) => {
      p.montagePlan = refinedPlan;
    });

    res.json({ montagePlan: refinedPlan });
  } catch (err) {
    console.error('Failed to refine montage plan:', err);
    sendApiError(res, 500, 'Failed to refine montage plan');
  }
});

// POST /api/projects/:id/montage/render
router.post('/montage/render', generationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'No montage plan exists. Generate a plan first.');
      return;
    }

    const requestedQuality = req.body?.quality;
    const quality = requestedQuality === 'final' ? 'final' : 'preview';
    const { startRender } = await import('../lib/render-worker.js');
    const jobId = await startRender(project.id, project.montagePlan, quality);
    res.json({ jobId, status: 'queued', quality });
  } catch (err) {
    console.error('Failed to start montage render:', err);
    sendApiError(res, 500, 'Failed to start montage render');
  }
});

// GET /api/projects/:id/montage/render/:jobId
router.get('/montage/render/:jobId', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { getRenderJob } = await import('../lib/render-worker.js');
    const job = await getRenderJob(project.id, req.params.jobId);
    if (!job) {
      sendApiError(res, 404, 'Render job not found');
      return;
    }

    res.json(job);
  } catch (err) {
    console.error('Failed to read render status:', err);
    sendApiError(res, 500, 'Failed to read render status');
  }
});

// DELETE /api/projects/:id/montage/render/:jobId
router.delete('/montage/render/:jobId', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { deleteRenderJob } = await import('../lib/render-worker.js');
    const deleted = await deleteRenderJob(project.id, req.params.jobId);
    if (!deleted) {
      sendApiError(res, 404, 'Render job not found');
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes('currently rendering')) {
      sendApiError(res, 409, err.message);
      return;
    }

    console.error('Failed to delete render job:', err);
    sendApiError(res, 500, 'Failed to delete render job');
  }
});

// GET /api/projects/:id/montage/render/:jobId/download
router.get('/montage/render/:jobId/download', readLimiter, async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { getRenderJob } = await import('../lib/render-worker.js');
    const job = await getRenderJob(project.id, req.params.jobId);
    if (!job) {
      sendApiError(res, 404, 'Render job not found');
      return;
    }

    if (job.status !== 'done' || !job.outputFile) {
      sendApiError(res, 400, `Render not complete. Status: ${job.status}`);
      return;
    }

    const outputPath = resolveProjectPath(project.id, job.outputFile);
    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat?.isFile()) {
      sendApiError(res, 404, 'Rendered file not found');
      return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outputPath)}"`);
    fsCb.createReadStream(outputPath).pipe(res);
  } catch (err) {
    console.error('Failed to download render:', err);
    sendApiError(res, 500, 'Failed to download render');
  }
});

export default router;
