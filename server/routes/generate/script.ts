import { Router, Request, Response } from 'express';
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
  type ShotMeta,
} from '../../lib/storage.js';
import { chatCompletion } from '../../lib/openrouter.js';
import { buildAssetAngleManifest } from '../../lib/pipeline-utils.js';
import { getErrorMessage, sendApiError } from '../../lib/api-error.js';
import { resolveSettings, clampShotDuration, MAX_SHOT_DURATION_SEC } from './shared.js';

const router = Router({ mergeParams: true });

// POST /api/projects/:id/generate-script - generate script from brief
router.post('/generate-script', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const briefText = project.brief.text || '';
    if (!briefText.trim()) {
      sendApiError(res, 400, 'Brief text is empty');
      return;
    }

    const effective = await resolveSettings(project);
    const assets = project.brief.assets || [];

    let assetManifest = '';
    if (assets.length > 0) {
      const manifest = buildAssetAngleManifest(assets);
      const angleList = manifest
        .map(({ base, files, description }) => {
          const fileList = files.map((f) => `[${f}]`).join(', ');
          const suffix = description ? ` - ${description}` : '';
          return `  - Angle "${base}": ${fileList}${suffix}`;
        })
        .join('\n');

      assetManifest = [
        '',
        '',
        '## ATTACHED REFERENCE FILES',
        'Use these files in the script where relevant, referencing filenames in square brackets.',
        '',
        'Available angles:',
        angleList,
        '',
        'When a scene uses a specific visual angle, reference it directly as [filename.ext].',
      ].join('\n');
    }

    const durationNote = project.brief.targetDuration
      ? `\n\nTarget video duration: ${project.brief.targetDuration} seconds. Plan scene count and pacing to match this total.`
      : '';
    const userMessage = briefText + durationNote + assetManifest;

    console.log(
      `[generate-script] model=${effective.scriptModel}, assets=${assets.length}`
    );

    const script = await chatCompletion(
      effective.scriptModel,
      [
        { role: 'system', content: effective.scriptwriterPrompt },
        { role: 'user', content: userMessage },
      ],
      effective.temperature
    );

    project.script = script;
    project.stage = 'script';
    await saveProject(project);

    res.json({ script });
  } catch (err) {
    console.error('Failed to generate script:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to generate script'), 'SCRIPT_GENERATION_FAILED');
  }
});

// POST /api/projects/:id/split-shots - split script into structured shots
router.post('/split-shots', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    if (!project.script.trim()) {
      sendApiError(res, 400, 'Script is empty. Generate a script first.');
      return;
    }

    const effective = await resolveSettings(project);
    const assets = project.brief.assets || [];
    const manifest = buildAssetAngleManifest(assets);

    let assetSection = '';
    if (manifest.length > 0) {
      const angleList = manifest
        .map(({ base, files, description }) => {
          const start = files[0] || '';
          const end = files[1] ? `, end frame ${files[1]}` : '';
          const note = description ? `\n    Description: ${description}` : '';
          return `  - Angle "${base}": start frame ${start}${end}${note}`;
        })
        .join('\n');

      assetSection = [
        '',
        '## REFERENCE FRAMES (REQUIRED WHEN RELEVANT)',
        'The brief includes reference image pairs for camera angles.',
        'Use them to ground shot planning and assetRefs assignment.',
        '',
        'Available angles:',
        angleList,
        '',
        'Asset rules:',
        '- Include relevant filenames in "assetRefs".',
        '- If an angle has a pair, include both files when applicable.',
        '- Reuse is allowed when it matches narrative intent.',
        '- Use an empty array only when no relevant reference exists.',
      ].join('\n');
    }

    const systemPrompt = [
      effective.shotSplitterPrompt,
      assetSection,
      '',
      '## HUMAN PRESENCE REQUIREMENT',
      'Every imagePrompt should include plausible real people for the scene, unless it is a pure aerial overview or abstract detail close-up.',
      '',
      '## OUTPUT FORMAT',
      'Return ONLY a valid JSON array. No markdown, no commentary.',
      'Each item must contain:',
      '- "scene": string',
      '- "imagePrompt": string',
      '- "videoPrompt": string',
      '- "duration": number (2-5 seconds)',
      '- "assetRefs": string[]',
      '- "audioDescription": string (optional)',
      '',
      'Example:',
      '[',
      '  {',
      '    "scene": "Sunrise reveal of the residential complex",',
      '    "imagePrompt": "Cinematic aerial view of modern residential towers at sunrise, real residents walking paths, warm natural light, photorealistic",',
      '    "videoPrompt": "Slow ascending drone reveal, camera tilts down to show courtyards and facades",',
      '    "duration": 4,',
      '    "assetRefs": ["angle_001_00000.jpg", "angle_001_00001.jpg"],',
      '    "audioDescription": "Soft ambient city morning atmosphere"',
      '  }',
      ']',
    ].join('\n');

    console.log(`[split-shots] model=${effective.splitModel}`);

    const response = await chatCompletion(
      effective.splitModel,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: project.script },
      ],
      effective.temperature
    );

    // Strip markdown code fences if present.
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '');
      jsonStr = jsonStr.replace(/\n?```\s*$/, '');
    }

    // If extra text appears, try to recover the first JSON array.
    if (!jsonStr.startsWith('[')) {
      const match = jsonStr.match(/\[[\s\S]*\]/);
      if (match) {
        jsonStr = match[0];
      }
    }

    interface RawShot {
      scene?: string;
      description?: string;
      imagePrompt?: string;
      videoPrompt?: string;
      prompt?: string;
      duration?: number;
      durationSec?: number;
      assetRefs?: string[];
      audioDescription?: string;
    }

    let rawShots: RawShot[];
    try {
      rawShots = JSON.parse(jsonStr);
    } catch {
      console.error('[split-shots] Failed to parse JSON. Raw response:\n', response.slice(0, 500));
      res.status(422).json({
        error: 'Failed to parse LLM response as JSON',
        raw: response,
      });
      return;
    }

    if (!Array.isArray(rawShots)) {
      res.status(422).json({
        error: 'LLM response is not an array',
        raw: response,
      });
      return;
    }

    const shots: ShotMeta[] = rawShots.map((raw, index) => {
      const shotId = `shot-${String(index + 1).padStart(3, '0')}`;
      const prompt = raw.imagePrompt || raw.prompt || '';
      return {
        id: shotId,
        order: index,
        scene: raw.scene || raw.description || '',
        audioDescription: raw.audioDescription || '',
        imagePrompt: prompt,
        videoPrompt: raw.videoPrompt || prompt,
        duration: clampShotDuration(raw.duration ?? raw.durationSec ?? MAX_SHOT_DURATION_SEC),
        assetRefs: Array.isArray(raw.assetRefs) ? raw.assetRefs : [],
        status: 'draft',
        generatedImages: [],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      };
    });

    for (const shot of shots) {
      await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'reference'));
      await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'generated'));
      await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'video'));
    }

    project.shots = shots;
    project.stage = 'shots';
    await saveProject(project);

    res.json({ shots });
  } catch (err) {
    console.error('Failed to split shots:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to split shots'), 'SHOT_SPLIT_FAILED');
  }
});

export default router;
