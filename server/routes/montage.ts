import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import path from 'node:path';
import { getProject, withProject, ensureDir, resolveProjectPath } from '../lib/storage.js';
import { sendApiError } from '../lib/api-error.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getApiKey, getGlobalSettings } from '../lib/config.js';

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

// POST /api/projects/:id/montage/generate-voiceover
router.post('/montage/generate-voiceover', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;

    if (!project.voiceoverScriptApproved) {
      sendApiError(res, 400, 'Voiceover script must be approved before generating audio');
      return;
    }

    const settings = await getGlobalSettings();
    const elevenLabsApiKey = settings.elevenLabsApiKey;
    if (!elevenLabsApiKey) {
      sendApiError(res, 400, 'ElevenLabs API key is not configured. Please set it in Settings.');
      return;
    }

    const voiceId = project.voiceoverVoiceId
      || settings.defaultVoiceoverVoiceId
      || 'pNInz6obpgDQGcFmaJgB'; // Default ElevenLabs voice (Adam)

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: project.voiceoverScript,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      sendApiError(res, 500, `ElevenLabs API error (${response.status}): ${errorText}`);
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Save to montage directory
    const montageDir = resolveProjectPath(project.id, 'montage');
    await ensureDir(montageDir);
    const voiceoverPath = path.join(montageDir, 'voiceover.mp3');
    await fs.writeFile(voiceoverPath, audioBuffer);

    // Re-check approval inside withProject to prevent TOCTOU race
    // (user may have edited script during the long TTS request, resetting approval)
    const updateResult = await withProject(project.id, (proj) => {
      if (!proj.voiceoverScriptApproved) {
        return { error: 'Voiceover script was modified during generation. Please re-approve and try again.' } as const;
      }
      proj.voiceoverFile = 'montage/voiceover.mp3';
      proj.voiceoverProvider = 'elevenlabs';
      return { ok: true } as const;
    });

    if ('error' in updateResult) {
      // Clean up the audio file since we won't use it
      await fs.unlink(voiceoverPath).catch(() => {});
      sendApiError(res, 409, updateResult.error);
      return;
    }

    res.json({ voiceoverFile: 'montage/voiceover.mp3', provider: 'elevenlabs' });
  } catch (err) {
    console.error('Failed to generate voiceover:', err);
    sendApiError(res, 500, 'Failed to generate voiceover');
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

    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = fsCb.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        sendApiError(res, 500, 'Failed to stream voiceover');
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Failed to stream voiceover:', err);
    sendApiError(res, 500, 'Failed to stream voiceover');
  }
});

// POST /api/projects/:id/montage/generate-music
router.post('/montage/generate-music', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to generate music:', err);
    sendApiError(res, 500, 'Failed to generate music');
  }
});

// POST /api/projects/:id/montage/generate-plan
router.post('/montage/generate-plan', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
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
    sendApiError(res, 501, 'Not implemented yet');
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
    sendApiError(res, 501, 'Not implemented yet');
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
    sendApiError(res, 501, 'Not implemented yet');
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
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to get render status:', err);
    sendApiError(res, 500, 'Failed to get render status');
  }
});

// GET /api/projects/:id/montage/render/:jobId/download
router.get('/montage/render/:jobId/download', async (req: Request, res: Response) => {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    sendApiError(res, 501, 'Not implemented yet');
  } catch (err) {
    console.error('Failed to download render:', err);
    sendApiError(res, 500, 'Failed to download render');
  }
});

export default router;
