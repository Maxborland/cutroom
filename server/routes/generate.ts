import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject, saveProject, getProjectDir, ensureDir, type ShotMeta, type Project } from '../lib/storage.js';
import { chatCompletion, generateImage, type ReferenceImage, type ImageGenOptions } from '../lib/openrouter.js';
import { generateImageHiggsfield, generateVideo } from '../lib/higgsfield.js';
import { findImageModel, findVideoModel, HIGGSFIELD_IMAGE_MODELS, HIGGSFIELD_VIDEO_MODELS } from '../lib/higgsfield-models.js';
import { getGlobalSettings } from './settings.js';

const router = Router({ mergeParams: true });

// Track active generation requests for cancellation
const activeGenerations = new Map<string, AbortController>(); // key = "projectId/shotId"

function genKey(projectId: string, shotId: string) {
  return `${projectId}/${shotId}`;
}

const DEFAULT_ENHANCE_PROMPT = `Transform this architectural render into an ultra-photorealistic photograph as if captured by a professional architectural photographer using a Sony A7R V with a 24-70mm f/2.8 GM lens. Apply these enhancements:

- Natural lighting with realistic sun position, atmospheric haze, and volumetric light
- Photographic depth of field with subtle bokeh on background elements
- Real-world material textures: weathering on concrete, reflections on glass, grain in wood
- Natural environmental details: real sky with clouds, authentic vegetation, ground debris
- Human presence: realistic people, cars with motion blur, signs of life
- Color grading: cinematic but natural tones, no oversaturation
- Lens characteristics: subtle vignette, chromatic aberration, natural lens flare
- Post-processing: film grain, realistic shadows with ambient occlusion

ABSOLUTE RULE: Preserve the EXACT building geometry — shape, proportions, number of floors, facade pattern, window layout, balcony positions, roof silhouette. This is a real estate product being sold — any architectural deviation is unacceptable. Only change the rendering style to photographic, never the building itself. The result must be indistinguishable from a real photograph of this exact building.`;

/** Resolve the effective model and prompts by merging project + global settings */
async function resolveSettings(project: Project) {
  const global = await getGlobalSettings();
  return {
    model: (global as any).defaultTextModel || project.settings.model,
    imageModel: (global as any).defaultImageModel || 'openai/gpt-image-1',
    enhanceModel: (global as any).defaultEnhanceModel || 'openai/gpt-image-1',
    imageSize: ((global as any).imageSize as string) || 'auto',
    imageQuality: ((global as any).imageQuality as string) || 'high',
    enhanceSize: ((global as any).enhanceSize as string) || 'auto',
    enhanceQuality: ((global as any).enhanceQuality as string) || 'high',
    temperature: project.settings.temperature,
    scriptwriterPrompt: (global as any).masterPromptScriptwriter || project.settings.scriptwriterPrompt,
    shotSplitterPrompt: (global as any).masterPromptShotSplitter || project.settings.shotSplitterPrompt,
    enhancePrompt: (global as any).masterPromptEnhance || DEFAULT_ENHANCE_PROMPT,
    // Higgsfield
    higgsfieldImageModel: ((global as any).defaultHiggsfieldImageModel as string) || HIGGSFIELD_IMAGE_MODELS[0].id,
    higgsfieldVideoModel: ((global as any).defaultHiggsfieldVideoModel as string) || HIGGSFIELD_VIDEO_MODELS[0].id,
    imageAspectRatio: ((global as any).imageAspectRatio as string) || '16:9',
  };
}

// POST /api/projects/:id/generate-script — generate script from brief
router.post('/generate-script', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const briefText = project.brief.text || '';
    if (!briefText.trim()) {
      res.status(400).json({ error: 'Brief text is empty' });
      return;
    }

    const effective = await resolveSettings(project);

    // Build structured asset manifest grouped by camera angle
    let assetManifest = '';
    const assets = project.brief.assets;
    if (assets.length > 0) {
      const labelMap = new Map<string, string>();
      for (const a of assets) {
        if (a.label?.trim()) labelMap.set(a.filename, a.label.trim());
      }

      // Group into camera angles: Blago_nizko_001_00000.jpg + Blago_nizko_001_00001.jpg = one angle
      const angleMap = new Map<string, string[]>();
      for (const a of assets) {
        const base = a.filename.replace(/_\d{5}\.\w+$/, '');
        if (!angleMap.has(base)) angleMap.set(base, []);
        angleMap.get(base)!.push(a.filename);
      }

      const angleList = [...angleMap.entries()]
        .map(([base, files]) => {
          const sorted = files.sort();
          const desc = labelMap.get(sorted[0]) || labelMap.get(sorted[1]) || '';
          const descPart = desc ? ` — ${desc}` : '';
          const fileList = sorted.map(f => `[${f}]`).join(', ');
          return `  - Ракурс "${base}": ${fileList}${descPart}`;
        })
        .join('\n');

      assetManifest = [
        '',
        '',
        '## ПРИКРЕПЛЁННЫЕ ФАЙЛЫ (ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ В СЦЕНАРИИ)',
        'К брифу прикреплены рендеры камерных ракурсов. Каждый ракурс — пара кадров (начальный + конечный) для движения камеры.',
        'Ты ДОЛЖЕН ссылаться на эти файлы в сценарии в формате [filename.jpg].',
        '',
        'Доступные ракурсы:',
        angleList,
        '',
        'Для каждой сцены укажи, какой ракурс используется: "Используем ракурс [filename.jpg]".',
      ].join('\n');
    }

    const systemPrompt = effective.scriptwriterPrompt;
    const durationNote = project.brief.targetDuration
      ? `\n\nЦелевая длительность ролика: ${project.brief.targetDuration} секунд. Рассчитай количество сцен и их длительности так, чтобы суммарный хронометраж составил примерно ${project.brief.targetDuration} секунд.`
      : '';
    const userMessage = briefText + durationNote + assetManifest;

    console.log(`[generate-script] model=${effective.model}, assets=${project.brief.assets.length}`);

    const script = await chatCompletion(
      effective.model,
      [
        { role: 'system', content: systemPrompt },
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
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/split-shots — split script into shots
router.post('/split-shots', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!project.script.trim()) {
      res.status(400).json({ error: 'Script is empty. Generate a script first.' });
      return;
    }

    const effective = await resolveSettings(project);
    const userPrompt = effective.shotSplitterPrompt;
    const script = project.script;

    // Wrap the user's creative prompt with a strict JSON output requirement
    // Build asset manifest grouped by camera angle with descriptions
    const assets = project.brief.assets || [];
    // Build a label lookup: filename -> label
    const labelMap = new Map<string, string>();
    for (const a of assets) {
      if (a.label?.trim()) labelMap.set(a.filename, a.label.trim());
    }

    let assetSection = '';
    if (assets.length > 0) {
      // Group into camera angles: Blago_nizko_001_00000.jpg + Blago_nizko_001_00001.jpg = one angle
      const angleMap = new Map<string, string[]>();
      for (const a of assets) {
        const base = a.filename.replace(/_\d{5}\.\w+$/, '');
        if (!angleMap.has(base)) angleMap.set(base, []);
        angleMap.get(base)!.push(a.filename);
      }

      const angleList = [...angleMap.entries()]
        .map(([base, files]) => {
          const sorted = files.sort();
          // Use the label from the first frame as the angle description
          const desc = labelMap.get(sorted[0]) || labelMap.get(sorted[1]) || '';
          const descPart = desc ? `\n    Описание: ${desc}` : '';
          return `  - Ракурс "${base}": начальный кадр ${sorted[0]}${sorted[1] ? `, конечный кадр ${sorted[1]}` : ''}${descPart}`;
        })
        .join('\n');

      assetSection = [
        '',
        '## REFERENCE FRAMES (ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ)',
        'В брифе загружены рендеры камерных ракурсов — пары кадров (начальный + конечный) для каждого движения камеры.',
        'Описания ракурсов помогут тебе понять, что изображено на каждом.',
        'Эти кадры ДОЛЖНЫ использоваться как reference/initial frames для видеогенерации.',
        '',
        'Доступные ракурсы:',
        angleList,
        '',
        'ПРАВИЛА привязки ассетов:',
        '- Каждый шот ДОЛЖЕН иметь хотя бы один ассет в "assetRefs" если есть подходящий ракурс.',
        '- Указывай ОБА файла пары (начальный _00000 и конечный _00001) — они определяют движение камеры.',
        '- Один ракурс может использоваться в нескольких шотах.',
        '- Привязывай ракурс к шоту по смыслу: фасад → фасадный ракурс, двор → дворовой и т.д.',
        '- Если для шота нет подходящего ракурса, оставь "assetRefs": [].',
      ].join('\n');
    }

    const systemPrompt = [
      userPrompt,
      assetSection,
      '',
      '## HUMAN PRESENCE REQUIREMENT',
      'Every imagePrompt MUST include real people appropriate to the scene context unless the shot is a pure aerial/drone overview or an abstract detail close-up.',
      'Examples of appropriate people:',
      '- Exterior building shots: pedestrians walking, residents chatting, children playing, people at café terraces',
      '- Interior shots: residents relaxing, families, couples, people cooking or reading',
      '- Pool/gym/amenity areas: people swimming, exercising, lounging',
      '- Entrance/lobby: doorman, residents entering, guests arriving',
      '- Park/garden areas: joggers, dog walkers, families on benches, cyclists',
      'People must be described as REAL HUMANS with natural clothing, skin, and poses — never 3D models or mannequins.',
      'This is critical for making the project feel alive and lived-in.',
      '',
      '## CRITICAL OUTPUT FORMAT REQUIREMENT',
      'You MUST return ONLY a valid JSON array. No markdown, no tables, no explanations.',
      'Each element must have these fields:',
      '- "scene": string — brief Russian description of what happens in this shot',
      '- "imagePrompt": string — AI-ready image generation prompt in English (photorealistic, cinematic, MUST include people where appropriate)',
      '- "videoPrompt": string — AI-ready video generation prompt in English (include camera movement)',
      '- "duration": number — shot duration in seconds (2-5)',
      '- "assetRefs": string[] — filenames of reference frames for this shot (MUST include relevant assets!)',
      '- "audioDescription": string (optional) — what should be heard: voiceover text, ambient sounds',
      '',
      'Example:',
      '```json',
      '[',
      '  {',
      '    "scene": "Рассвет над жилым комплексом, вид с дрона",',
      '    "imagePrompt": "Cinematic aerial drone shot of luxury residential complex at golden hour, real people walking along tree-lined paths, a couple sitting on a bench near the fountain, warm natural lighting...",',
      '    "videoPrompt": "Slow ascending drone reveal of modern residential towers at sunrise, camera tilts down...",',
      '    "duration": 4,',
      '    "assetRefs": ["Blago_nizko_001_00000.jpg", "Blago_nizko_001_00001.jpg"],',
      '    "audioDescription": "Мягкая оркестровая музыка, звуки утреннего города"',
      '  }',
      ']',
      '```',
      '',
      'Return ONLY the JSON array. No other text.',
    ].join('\n');

    console.log(`[split-shots] model=${effective.model}`);

    const response = await chatCompletion(
      effective.model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: script },
      ],
      effective.temperature
    );

    // Strip markdown code fences if present
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '');
      jsonStr = jsonStr.replace(/\n?```\s*$/, '');
    }

    // Try to extract JSON array if LLM wrapped it in extra text
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
    } catch (parseErr) {
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

    // Create shot objects with standardized IDs, tolerating various LLM field names
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
        duration: raw.duration || raw.durationSec || 5,
        assetRefs: Array.isArray(raw.assetRefs) ? raw.assetRefs : [],
        status: 'draft',
        generatedImages: [],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      };
    });

    // Create directories for each shot
    const projectDir = getProjectDir(project.id);
    for (const shot of shots) {
      const shotDir = path.join(projectDir, 'shots', shot.id);
      await ensureDir(path.join(shotDir, 'reference'));
      await ensureDir(path.join(shotDir, 'generated'));
      await ensureDir(path.join(shotDir, 'video'));
    }

    project.shots = shots;
    project.stage = 'shots';
    await saveProject(project);

    res.json({ shots });
  } catch (err) {
    console.error('Failed to split shots:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/shots/:shotId/cancel-generation — cancel active generation
router.post('/shots/:shotId/cancel-generation', async (req: Request, res: Response) => {
  try {
    const key = genKey(req.params.id, req.params.shotId);
    const controller = activeGenerations.get(key);
    if (controller) {
      controller.abort();
      activeGenerations.delete(key);
    }
    // Reset shot status to draft
    const project = await getProject(req.params.id);
    if (project) {
      const shot = project.shots.find((s) => s.id === req.params.shotId);
      if (shot && shot.status === 'generating') {
        shot.status = 'draft';
        await saveProject(project);
      }
    }
    res.json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/cancel-all-generation — cancel all active generations for project
router.post('/cancel-all-generation', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    let cancelled = 0;
    for (const [key, controller] of activeGenerations) {
      if (key.startsWith(projectId + '/')) {
        controller.abort();
        activeGenerations.delete(key);
        cancelled++;
      }
    }
    // Reset all generating shots to draft
    const project = await getProject(projectId);
    if (project) {
      for (const shot of project.shots) {
        if (shot.status === 'generating') shot.status = 'draft';
      }
      await saveProject(project);
    }
    res.json({ cancelled });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/shots/:shotId/generate-image — generate image for a shot
router.post('/shots/:shotId/generate-image', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    // Get Higgsfield image model from settings
    const effective = await resolveSettings(project);
    const modelId = req.body.model || effective.higgsfieldImageModel;
    const hfModel = findImageModel(modelId);
    const rawPrompt = req.body.prompt || shot.imagePrompt;

    // Boost prompt with photorealism instructions; preserve building geometry exactly
    const prompt = `Ultra-photorealistic professional photograph, NOT a 3D render or CGI. CRITICAL: preserve the exact building geometry, shape, proportions, facade, and all architectural features from the reference — this is a real estate product being sold. ${rawPrompt}. The scene must feel alive — include real people where appropriate (pedestrians, residents, visitors). All people must be real humans with natural skin, clothing and poses. Shot on Sony A7R V, natural lighting, real materials, film grain.`;

    // Load reference images from shot's assetRefs as base64 data URLs
    const refDataUrls: string[] = [];
    if (shot.assetRefs?.length) {
      const imagesDir = path.join(getProjectDir(project.id), 'brief', 'images');
      for (const filename of shot.assetRefs) {
        try {
          const filePath = path.join(imagesDir, filename);
          const buffer = await fs.readFile(filePath);
          const ext = path.extname(filename).toLowerCase();
          const mimeType = ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp'
            : 'image/jpeg';
          refDataUrls.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
        } catch {
          console.warn(`[generate-image] Could not load reference: ${filename}`);
        }
      }
      console.log(`[generate-image] Loaded ${refDataUrls.length}/${shot.assetRefs.length} reference images`);
    }

    // Set status to generating
    shot.status = 'generating';
    await saveProject(project);

    // Track for cancellation
    const abortController = new AbortController();
    const key = genKey(project.id, shotId);
    activeGenerations.set(key, abortController);

    try {
      let resultUrl: string;

      if (hfModel) {
        // Use Higgsfield for image generation
        resultUrl = await generateImageHiggsfield(
          {
            model: hfModel,
            prompt,
            referenceImages: refDataUrls.length > 0 ? refDataUrls : undefined,
            aspectRatio: effective.imageAspectRatio,
          },
          abortController.signal,
        );
      } else {
        // Fallback: try OpenRouter if model not found in Higgsfield registry
        console.log(`[generate-image] Model ${modelId} not in Higgsfield registry, falling back to OpenRouter`);
        const referenceImages: ReferenceImage[] = [];
        if (refDataUrls.length > 0) {
          for (const dataUrl of refDataUrls) {
            const [header, b64] = dataUrl.split(',');
            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
            referenceImages.push({ base64: b64, mimeType });
          }
        }
        const imageOptions: ImageGenOptions = {
          size: effective.imageSize,
          quality: effective.imageQuality,
        };
        resultUrl = await generateImage(modelId, prompt, referenceImages, abortController.signal, imageOptions);
      }

      // Save result to disk
      const shotDir = path.join(getProjectDir(project.id), 'shots', shotId, 'generated');
      await ensureDir(shotDir);

      const timestamp = Date.now();
      const filename = `gen_${timestamp}.png`;
      const filePath = path.join(shotDir, filename);

      if (resultUrl.startsWith('data:') || resultUrl.match(/^[A-Za-z0-9+/=\s]+$/)) {
        let base64Data = resultUrl;
        if (base64Data.startsWith('data:')) {
          base64Data = base64Data.split(',')[1];
        }
        await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
      } else if (resultUrl.startsWith('http')) {
        const imageResponse = await fetch(resultUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        await fs.writeFile(filePath, buffer);
      } else {
        await fs.writeFile(filePath, Buffer.from(resultUrl, 'base64'));
      }

      // Reload project in case of concurrent changes
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.generatedImages.push(filename);
          refreshedShot.status = 'review';
          await saveProject(refreshed);
        }
      }

      activeGenerations.delete(key);

      res.json({
        filename,
        url: `/api/projects/${req.params.id}/shots/${shotId}/generated/${filename}`,
      });
    } catch (genErr) {
      activeGenerations.delete(key);
      // Revert status on error
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.status = 'draft';
          await saveProject(refreshed);
        }
      }
      throw genErr;
    }
  } catch (err) {
    console.error('Failed to generate image:', err);
    const isCancelled = err instanceof Error && err.message === 'Generation cancelled';
    res.status(isCancelled ? 499 : 500).json({ error: String(err) });
  }
});

// GET /api/projects/:id/shots/:shotId/generated/:filename — serve generated image
router.get('/shots/:shotId/generated/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { shotId, filename } = req.params;
    const filePath = path.resolve(
      getProjectDir(project.id),
      'shots',
      shotId,
      'generated',
      filename
    );

    // Security check
    const projectDir = path.resolve(getProjectDir(project.id));
    if (!filePath.startsWith(projectDir)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve generated image:', err);
    res.status(500).json({ error: 'Failed to serve generated image' });
  }
});

// POST /api/projects/:id/shots/:shotId/enhance-image — enhance a generated image
router.post('/shots/:shotId/enhance-image', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    const { sourceImage, prompt: customPrompt, model: customModel } = req.body as {
      sourceImage: string;
      prompt?: string;
      model?: string;
    };

    if (!sourceImage) {
      res.status(400).json({ error: 'sourceImage is required' });
      return;
    }

    const effective = await resolveSettings(project);
    const enhanceModel = customModel || effective.enhanceModel;
    const enhancePrompt = customPrompt || effective.enhancePrompt;

    // Load the source image
    const sourcePath = path.join(getProjectDir(project.id), 'shots', shotId, 'generated', sourceImage);
    let sourceBuffer: Buffer;
    try {
      sourceBuffer = await fs.readFile(sourcePath);
    } catch {
      res.status(404).json({ error: `Source image not found: ${sourceImage}` });
      return;
    }

    const ext = path.extname(sourceImage).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const referenceImages: ReferenceImage[] = [{ base64: sourceBuffer.toString('base64'), mimeType }];

    const enhanceOptions: ImageGenOptions = {
      size: effective.enhanceSize,
      quality: effective.enhanceQuality,
    };

    console.log(`[enhance-image] model=${enhanceModel}, source=${sourceImage}, size=${enhanceOptions.size}, quality=${enhanceOptions.quality}`);

    const result = await generateImage(enhanceModel, enhancePrompt, referenceImages, undefined, enhanceOptions);

    // Save the enhanced image
    const shotDir = path.join(getProjectDir(project.id), 'shots', shotId, 'generated');
    await ensureDir(shotDir);

    const timestamp = Date.now();
    const filename = `enh_${timestamp}.png`;
    const filePath = path.join(shotDir, filename);

    if (result.startsWith('data:') || result.match(/^[A-Za-z0-9+/=\s]+$/)) {
      let base64Data = result;
      if (base64Data.startsWith('data:')) {
        base64Data = base64Data.split(',')[1];
      }
      await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
    } else if (result.startsWith('http')) {
      const imageResponse = await fetch(result);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      await fs.writeFile(filePath, buffer);
    } else {
      await fs.writeFile(filePath, Buffer.from(result, 'base64'));
    }

    // Update shot metadata
    const refreshed = await getProject(req.params.id);
    if (refreshed) {
      const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
      if (refreshedShot) {
        if (!Array.isArray(refreshedShot.enhancedImages)) refreshedShot.enhancedImages = [];
        refreshedShot.enhancedImages.push(filename);
        await saveProject(refreshed);
      }
    }

    res.json({
      filename,
      url: `/api/projects/${req.params.id}/shots/${shotId}/generated/${filename}`,
    });
  } catch (err) {
    console.error('Failed to enhance image:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/enhance-all — enhance all shots that have generated images but no enhanced ones
router.post('/enhance-all', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const effective = await resolveSettings(project);
    const enhanceModel = effective.enhanceModel;
    const enhancePrompt = effective.enhancePrompt;

    const shotsToEnhance = project.shots.filter(
      (s) => s.generatedImages.length > 0 && (!Array.isArray(s.enhancedImages) || s.enhancedImages.length === 0)
    );

    console.log(`[enhance-all] ${shotsToEnhance.length} shots to enhance`);

    let enhanced = 0;

    for (const shot of shotsToEnhance) {
      const sourceImage = shot.generatedImages[shot.generatedImages.length - 1];
      const sourcePath = path.join(getProjectDir(project.id), 'shots', shot.id, 'generated', sourceImage);

      let sourceBuffer: Buffer;
      try {
        sourceBuffer = await fs.readFile(sourcePath);
      } catch {
        console.warn(`[enhance-all] Skipping ${shot.id}: source not found`);
        continue;
      }

      const ext = path.extname(sourceImage).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const referenceImages: ReferenceImage[] = [{ base64: sourceBuffer.toString('base64'), mimeType }];

      const enhAllOptions: ImageGenOptions = {
        size: effective.enhanceSize,
        quality: effective.enhanceQuality,
      };

      try {
        const result = await generateImage(enhanceModel, enhancePrompt, referenceImages, undefined, enhAllOptions);

        const shotDir = path.join(getProjectDir(project.id), 'shots', shot.id, 'generated');
        await ensureDir(shotDir);

        const timestamp = Date.now();
        const filename = `enh_${timestamp}.png`;
        const filePath = path.join(shotDir, filename);

        if (result.startsWith('data:') || result.match(/^[A-Za-z0-9+/=\s]+$/)) {
          let base64Data = result;
          if (base64Data.startsWith('data:')) {
            base64Data = base64Data.split(',')[1];
          }
          await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
        } else if (result.startsWith('http')) {
          const imageResponse = await fetch(result);
          if (!imageResponse.ok) throw new Error(`Failed to download: ${imageResponse.status}`);
          await fs.writeFile(filePath, Buffer.from(await imageResponse.arrayBuffer()));
        } else {
          await fs.writeFile(filePath, Buffer.from(result, 'base64'));
        }

        // Update the project with fresh data for each shot
        const refreshed = await getProject(project.id);
        if (refreshed) {
          const refreshedShot = refreshed.shots.find((s) => s.id === shot.id);
          if (refreshedShot) {
            if (!Array.isArray(refreshedShot.enhancedImages)) refreshedShot.enhancedImages = [];
            refreshedShot.enhancedImages.push(filename);
            await saveProject(refreshed);
          }
        }

        enhanced++;
      } catch (err) {
        console.error(`[enhance-all] Failed to enhance ${shot.id}:`, err);
      }
    }

    res.json({ enhanced, total: shotsToEnhance.length });
  } catch (err) {
    console.error('Failed to enhance all:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/projects/:id/shots/:shotId/generate-video — generate video from image
router.post('/shots/:shotId/generate-video', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      res.status(404).json({ error: 'Shot not found' });
      return;
    }

    // Pick best source image: last enhanced > last generated
    const enhanced = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
    const sourceFile = enhanced.length > 0
      ? enhanced[enhanced.length - 1]
      : shot.generatedImages.length > 0
        ? shot.generatedImages[shot.generatedImages.length - 1]
        : null;

    if (!sourceFile) {
      res.status(400).json({ error: 'No source image available. Generate an image first.' });
      return;
    }

    const effective = await resolveSettings(project);
    const videoModelId = req.body.model || effective.higgsfieldVideoModel;
    const videoModel = findVideoModel(videoModelId);
    if (!videoModel) {
      res.status(400).json({ error: `Video model not found: ${videoModelId}` });
      return;
    }

    // Read source image as data URL
    const sourcePath = path.join(getProjectDir(project.id), 'shots', shotId, 'generated', sourceFile);
    let sourceBuffer: Buffer;
    try {
      sourceBuffer = await fs.readFile(sourcePath);
    } catch {
      res.status(404).json({ error: `Source image file not found: ${sourceFile}` });
      return;
    }
    const ext = path.extname(sourceFile).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const sourceDataUrl = `data:${mimeType};base64,${sourceBuffer.toString('base64')}`;

    const videoPrompt = req.body.prompt || shot.videoPrompt;

    // Track for cancellation
    const abortController = new AbortController();
    const key = genKey(project.id, shotId);
    activeGenerations.set(key, abortController);

    try {
      const videoUrl = await generateVideo(
        {
          model: videoModel,
          prompt: videoPrompt,
          sourceImageDataUrl: sourceDataUrl,
          duration: shot.duration,
        },
        abortController.signal,
      );

      // Download the video
      const videoDir = path.join(getProjectDir(project.id), 'shots', shotId, 'video');
      await ensureDir(videoDir);

      const timestamp = Date.now();
      const videoFilename = `vid_${timestamp}.mp4`;
      const videoPath = path.join(videoDir, videoFilename);

      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(videoPath, videoBuffer);

      // Update project
      const refreshed = await getProject(req.params.id);
      if (refreshed) {
        const refreshedShot = refreshed.shots.find((s) => s.id === shotId);
        if (refreshedShot) {
          refreshedShot.videoFile = videoFilename;
          refreshedShot.status = 'review';
          await saveProject(refreshed);
        }
      }

      activeGenerations.delete(key);

      res.json({
        filename: videoFilename,
        url: `/api/projects/${req.params.id}/shots/${shotId}/video/${videoFilename}`,
      });
    } catch (genErr) {
      activeGenerations.delete(key);
      throw genErr;
    }
  } catch (err) {
    console.error('Failed to generate video:', err);
    const isCancelled = err instanceof Error && err.message === 'Generation cancelled';
    res.status(isCancelled ? 499 : 500).json({ error: String(err) });
  }
});

// GET /api/projects/:id/shots/:shotId/video/:filename — serve video file
router.get('/shots/:shotId/video/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { shotId, filename } = req.params;
    const filePath = path.resolve(
      getProjectDir(project.id),
      'shots',
      shotId,
      'video',
      filename
    );

    // Security check
    const projectDir = path.resolve(getProjectDir(project.id));
    if (!filePath.startsWith(projectDir)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve video:', err);
    res.status(500).json({ error: 'Failed to serve video' });
  }
});

// POST /api/projects/:id/generate-all-videos — generate videos for all shots with images but no video
router.post('/generate-all-videos', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const effective = await resolveSettings(project);
    const videoModelId = effective.higgsfieldVideoModel;
    const videoModel = findVideoModel(videoModelId);
    if (!videoModel) {
      res.status(400).json({ error: `Video model not found: ${videoModelId}` });
      return;
    }

    const shotsToGenerate = project.shots.filter(
      (s) => (s.generatedImages.length > 0 || (Array.isArray(s.enhancedImages) && s.enhancedImages.length > 0)) && !s.videoFile
    );

    console.log(`[generate-all-videos] ${shotsToGenerate.length} shots to process`);

    let generated = 0;

    for (const shot of shotsToGenerate) {
      const enhanced = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
      const sourceFile = enhanced.length > 0
        ? enhanced[enhanced.length - 1]
        : shot.generatedImages[shot.generatedImages.length - 1];

      const sourcePath = path.join(getProjectDir(project.id), 'shots', shot.id, 'generated', sourceFile);
      let sourceBuffer: Buffer;
      try {
        sourceBuffer = await fs.readFile(sourcePath);
      } catch {
        console.warn(`[generate-all-videos] Skipping ${shot.id}: source not found`);
        continue;
      }

      const ext = path.extname(sourceFile).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const sourceDataUrl = `data:${mimeType};base64,${sourceBuffer.toString('base64')}`;

      try {
        const videoUrl = await generateVideo({
          model: videoModel,
          prompt: shot.videoPrompt,
          sourceImageDataUrl: sourceDataUrl,
          duration: shot.duration,
        });

        const videoDir = path.join(getProjectDir(project.id), 'shots', shot.id, 'video');
        await ensureDir(videoDir);

        const timestamp = Date.now();
        const videoFilename = `vid_${timestamp}.mp4`;
        const videoPath = path.join(videoDir, videoFilename);

        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) throw new Error(`Failed to download: ${videoResponse.status}`);
        await fs.writeFile(videoPath, Buffer.from(await videoResponse.arrayBuffer()));

        const refreshed = await getProject(project.id);
        if (refreshed) {
          const refreshedShot = refreshed.shots.find((s) => s.id === shot.id);
          if (refreshedShot) {
            refreshedShot.videoFile = videoFilename;
            refreshedShot.status = 'review';
            await saveProject(refreshed);
          }
        }

        generated++;
      } catch (err) {
        console.error(`[generate-all-videos] Failed for ${shot.id}:`, err);
      }
    }

    res.json({ generated, total: shotsToGenerate.length });
  } catch (err) {
    console.error('Failed to generate all videos:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
