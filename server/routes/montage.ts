import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { getProject, withProject, ensureDir, resolveProjectPath } from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getApiKey, getGlobalSettings } from '../lib/config.js';
import { normalizeVoiceoverText } from '../lib/tts-utils.js';

const router = Router({ mergeParams: true });

// Helper: load project or 404
async function loadProject(req: Request, res: Response) {
  const project = await getProject(req.params.id);
  if (!project) {
    sendApiError(res, 404, 'Project not found');
    return null;
  }
  return project;
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

    const sourceText = typeof req.body?.text === 'string'
      ? req.body.text
      : (project.voiceoverScript || '');

    if (!sourceText.trim()) {
      sendApiError(res, 400, 'Text is required for normalization');
      return;
    }

    const normalizedText = normalizeVoiceoverText(sourceText);
    res.json({ normalizedText });
  } catch (err) {
    console.error('Failed to normalize voiceover text:', err);
    sendApiError(res, 500, 'Failed to normalize voiceover text');
  }
});

// POST /api/projects/:id/montage/generate-voiceover
router.post('/montage/generate-voiceover', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.voiceoverScriptApproved) {
      sendApiError(res, 400, 'Voiceover script must be approved before generating audio');
      return;
    }

    // Capture the script text at generation time for TOCTOU comparison
    const scriptAtGeneration = project.voiceoverScript || '';
    const normalizedScript = normalizeVoiceoverText(scriptAtGeneration);

    if (!normalizedScript.trim()) {
      sendApiError(res, 400, 'Voiceover text is empty after normalization');
      return;
    }

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
    await fs.writeFile(tmpPath, result.audioBuffer);

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

// GET /api/projects/:id/montage/voiceover
router.get('/montage/voiceover', async (req: Request, res: Response) => {
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
    const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    res.setHeader('Content-Type', mimeType);
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

// DELETE /api/projects/:id/montage/voiceover
router.delete('/montage/voiceover', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.voiceoverFile) {
      sendApiError(res, 404, 'No voiceover to delete');
      return;
    }

    const filePath = resolveProjectPath(project.id, project.voiceoverFile);
    await fs.unlink(filePath).catch(() => {});

    await withProject(project.id, (proj) => {
      proj.voiceoverFile = undefined;
      proj.voiceoverProvider = undefined;
      proj.voiceoverVoiceId = undefined;
    });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete voiceover:', err);
    sendApiError(res, 500, 'Failed to delete voiceover');
  }
});

// POST /api/projects/:id/montage/upload-voiceover
router.post('/montage/upload-voiceover', async (req: Request, res: Response) => {
  const project = await loadProject(req, res);
  if (!project) return;

  musicUpload.single('voiceover')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        sendApiError(res, 400, multerErr.message);
        return;
      }

      if (!req.file) {
        sendApiError(res, 400, 'No voiceover file provided');
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const montageDir = resolveProjectPath(project.id, 'montage');
      await ensureDir(montageDir);

      const filename = `voiceover${ext}`;
      const filePath = path.join(montageDir, filename);
      await fs.writeFile(filePath, req.file.buffer);

      const voiceoverFile = `montage/${filename}`;
      await withProject(project.id, (proj) => {
        proj.voiceoverFile = voiceoverFile;
        proj.voiceoverProvider = 'manual';
        proj.voiceoverVoiceId = undefined;
      });

      res.json({ voiceoverFile, provider: 'manual' });
    } catch (err) {
      console.error('Failed to upload voiceover:', err);
      sendApiError(res, 500, 'Failed to upload voiceover');
    }
  });
});

// ─── Music helpers ──────────────────────────────────────────────────

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

// Allowed MIME types for audio upload validation
const ALLOWED_AUDIO_MIMES = new Set(Object.values(AUDIO_MIME_TYPES));

// Multer for music upload — validates by both extension and MIME type
const musicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const extValid = ALLOWED_AUDIO_EXTENSIONS.has(ext);
    const mimeValid = ALLOWED_AUDIO_MIMES.has(file.mimetype);
    if (extValid && mimeValid) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed audio formats: mp3, wav, m4a, ogg, aac'));
    }
  },
});

// POST /api/projects/:id/montage/generate-music-prompt
// Generates a music prompt via LLM that the user can copy into Suno UI
router.post('/montage/generate-music-prompt', async (req: Request, res: Response) => {
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
router.post('/montage/upload-music', async (req: Request, res: Response) => {
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
router.delete('/montage/music', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.musicFile) {
      sendApiError(res, 404, 'No music to delete');
      return;
    }

    const filePath = resolveProjectPath(project.id, project.musicFile);
    await fs.unlink(filePath).catch(() => {});

    await withProject(project.id, (proj) => {
      proj.musicFile = undefined;
      proj.musicProvider = undefined;
    });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete music:', err);
    sendApiError(res, 500, 'Failed to delete music');
  }
});

// GET /api/projects/:id/montage/music
router.get('/montage/music', async (req: Request, res: Response) => {
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

// POST /api/projects/:id/montage/generate-plan
router.post('/montage/generate-plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const approvedShots = project.shots.filter(s => s.status === 'approved');
    if (approvedShots.length === 0) {
      sendApiError(res, 400, 'No approved shots. Approve at least one shot before generating a montage plan.');
      return;
    }

    // Determine voiceover duration
    let voiceoverDurationSec: number;

    if (project.voiceoverFile) {
      const voPath = resolveProjectPath(project.id, project.voiceoverFile);
      const { probeDuration } = await import('../lib/normalize.js');
      voiceoverDurationSec = await probeDuration(voPath);
    } else {
      // Estimate from script: ~150 words/min for Russian
      const wordCount = (project.script || '').split(/\s+/).filter(Boolean).length;
      voiceoverDurationSec = Math.max((wordCount / 150) * 60, 10);
    }

    // Normalize clips
    const { normalizeClips } = await import('../lib/normalize.js');
    await normalizeClips(project.id, approvedShots);

    // Generate plan
    const { generateMontagePlan } = await import('../lib/montage-plan.js');
    const montagePlan = generateMontagePlan(project, voiceoverDurationSec);

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

// POST /api/projects/:id/montage/refine-plan
router.post('/montage/refine-plan', async (req: Request, res: Response) => {
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
router.post('/montage/render', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.montagePlan) {
      sendApiError(res, 400, 'No montage plan. Generate or upload a plan first.');
      return;
    }

    const quality = req.body.quality === 'final' ? 'final' : 'preview';

    const { startRender } = await import('../lib/render-worker.js');
    const jobId = await startRender(project.id, project.montagePlan, quality);

    res.json({ jobId, status: 'queued', quality });
  } catch (err) {
    console.error('Failed to start render:', err);
    sendApiError(res, 500, 'Failed to start render');
  }
});

// GET /api/projects/:id/montage/render/:jobId
router.get('/montage/render/:jobId', async (req: Request, res: Response) => {
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
    console.error('Failed to get render status:', err);
    sendApiError(res, 500, 'Failed to get render status');
  }
});

// DELETE /api/projects/:id/montage/render/:jobId
router.delete('/montage/render/:jobId', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    const { deleteRenderJob } = await import('../lib/render-worker.js');

    try {
      const deleted = await deleteRenderJob(project.id, req.params.jobId);
      if (!deleted) {
        sendApiError(res, 404, 'Render job not found');
        return;
      }
      res.json({ deleted: true });
    } catch (deleteErr) {
      if (deleteErr instanceof Error && deleteErr.message.includes('currently rendering')) {
        sendApiError(res, 409, deleteErr.message);
        return;
      }
      throw deleteErr;
    }
  } catch (err) {
    console.error('Failed to delete render job:', err);
    sendApiError(res, 500, 'Failed to delete render job');
  }
});

// GET /api/projects/:id/montage/render/:jobId/download
router.get('/montage/render/:jobId/download', async (req: Request, res: Response) => {
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

    const filePath = resolveProjectPath(project.id, job.outputFile);
    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'Rendered file not found on disk');
      return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${job.id}.mp4"`);
    const stream = fsCb.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Failed to download render:', err);
    sendApiError(res, 500, 'Failed to download render');
  }
});

export default router;
