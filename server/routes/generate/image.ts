import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
} from '../../lib/storage.js';
import { chatCompletion, generateImage as generateImageOpenRouter, type ReferenceImage, type ImageGenOptions } from '../../lib/openrouter.js';
import { generateImage as generateImageMulti } from '../../lib/generation.js';
import { resolveImageModel, resolveOpenRouterImageFallbackModel } from '../../lib/generation-models.js';
import { saveImageResult, fetchRemoteMediaBuffer, getBestImageFile, getMimeType } from '../../lib/media-utils.js';
import { prepareBriefReferences } from '../../lib/reference-media.js';
import { cacheExternalImageReference, isExternalMediaRef } from '../../lib/external-image-cache.js';
import { getErrorMessage, sendApiError } from '../../lib/api-error.js';
import { resolveSettings, activeGenerations, genKey } from './shared.js';

const router = Router({ mergeParams: true });

type OpenRouterImageQuality = 'low' | 'medium' | 'high';

function normalizeOpenRouterImageQuality(rawQuality: string): OpenRouterImageQuality {
  const value = String(rawQuality || '').trim().toLowerCase();
  if (value === 'low' || value === 'medium' || value === 'high') return value;

  if (value.includes('4k') || value.includes('2160')) return 'high';
  if (value.includes('2k') || value.includes('1440') || value.includes('1080')) return 'medium';
  if (value.includes('1k') || value.includes('768') || value.includes('720') || value.includes('512') || value.includes('480')) {
    return 'low';
  }

  return 'high';
}

function resolveProviderImageResolution(rawQuality: string): string | undefined {
  const requested = String(rawQuality || '').trim();
  if (!requested) return undefined;

  const lowered = requested.toLowerCase();
  if (lowered === 'auto') return undefined;
  if (lowered === 'low' || lowered === 'medium' || lowered === 'high') {
    // Do not force generic tiers for provider models without explicit capability data.
    return undefined;
  }

  return requested;
}

function isTransientDownloadError(err: unknown): boolean {
  const e: any = err;
  const code = String(e?.cause?.code ?? e?.code ?? '').toUpperCase();
  if ([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_REQUEST_TIMEOUT',
  ].includes(code)) {
    return true;
  }

  const msg = `${e?.message || ''} ${e?.cause?.message || ''}`.toLowerCase();
  return msg.includes('terminated') || msg.includes('fetch failed') || msg.includes('timeout');
}

function isLikelyRemoteImageInputError(err: unknown): boolean {
  const message = String((err as any)?.message || '').toLowerCase();
  if (message.includes('openrouter api error (400') || message.includes('openrouter api error (422')) {
    return true;
  }
  return message.includes('image') &&
    (message.includes('url') || message.includes('download') || message.includes('fetch') || message.includes('invalid'));
}

function isMissingRequiredImageInputError(err: unknown): boolean {
  const e: any = err;
  const detail = JSON.stringify(e?.body?.detail ?? '').toLowerCase();
  const message = String(e?.message ?? '').toLowerCase();

  const mentionsImageInput =
    detail.includes('image_url')
    || detail.includes('image_urls')
    || message.includes('image_url')
    || message.includes('image_urls');

  const missingRequired =
    detail.includes('field required')
    || detail.includes('value_error.missing')
    || detail.includes('missing');

  return mentionsImageInput && missingRequired;
}

function toOpenRouterReferenceImages(refDataUrls: string[]): ReferenceImage[] {
  const referenceImages: ReferenceImage[] = [];
  for (const dataUrl of refDataUrls) {
    const [header, b64] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
    referenceImages.push({ base64: b64, mimeType });
  }
  return referenceImages;
}

async function toReferenceImage(projectId: string, shotId: string, sourceImage: string): Promise<ReferenceImage> {
  if (isExternalMediaRef(sourceImage)) {
    return { kind: 'url', url: sourceImage };
  }

  const sourcePath = resolveProjectPath(projectId, 'shots', shotId, 'generated', sourceImage);
  const sourceBuffer = await fs.readFile(sourcePath);
  const mimeType = getMimeType(sourceImage);
  return { base64: sourceBuffer.toString('base64'), mimeType };
}

async function toLocalReferenceImage(projectId: string, shotId: string, sourceImage: string): Promise<ReferenceImage | null> {
  if (!isExternalMediaRef(sourceImage)) {
    return toReferenceImage(projectId, shotId, sourceImage);
  }

  const cachedFilename = await cacheExternalImageReference(projectId, shotId, sourceImage);
  if (cachedFilename) {
    return toReferenceImage(projectId, shotId, cachedFilename);
  }

  try {
    const buffer = await fetchRemoteMediaBuffer(sourceImage);
    const mimeType = getMimeType(sourceImage);
    return { base64: buffer.toString('base64'), mimeType };
  } catch (err) {
    console.warn('[external-cache] Failed to fetch external image for local fallback:', (err as any)?.message || err);
    return null;
  }
}

async function toReviewImageUrl(projectId: string, shotId: string, sourceImage: string): Promise<string> {
  if (isExternalMediaRef(sourceImage)) {
    return sourceImage;
  }

  const sourcePath = resolveProjectPath(projectId, 'shots', shotId, 'generated', sourceImage);
  const sourceBuffer = await fs.readFile(sourcePath);
  const mimeType = getMimeType(sourceImage);
  return `data:${mimeType};base64,${sourceBuffer.toString('base64')}`;
}

export interface GenerateShotImageOptions {
  projectId: string;
  shotId: string;
  modelId?: string;
  prompt?: string;
  promptInjection?: string;
  signal?: AbortSignal;
}

export async function generateShotImageForProject(options: GenerateShotImageOptions): Promise<{
  shotId: string;
  filename: string;
  url: string;
}> {
  const project = await getProject(options.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const shot = project.shots.find((s) => s.id === options.shotId);
  if (!shot) {
    throw new Error('Shot not found');
  }

  const effective = await resolveSettings(project);
  const modelId = options.modelId || effective.imageGenModel;
  const genModel = resolveImageModel(modelId);
  const baseShotPrompt = options.prompt || shot.imagePrompt;
  const shotPrompt = options.promptInjection
    ? `${baseShotPrompt}\n\nIMPORTANT DIRECTOR FIXES (MANDATORY):\n${options.promptInjection}`
    : baseShotPrompt;

  const template = effective.imageGenPrompt;
  const prompt = template.includes('{SHOT_PROMPT}')
    ? template.replace('{SHOT_PROMPT}', shotPrompt)
    : `${template}\n\n${shotPrompt}`;

  const preparedRefs = await prepareBriefReferences(project.id, shot.assetRefs || [], {
    maxReferenceBytes: 1_500_000,
    includeSvgDataUrl: false,
    includeSvgText: true,
    maxSvgTextChars: 2_000,
  });

  const refDataUrls = preparedRefs.items
    .map((item) => item.imageDataUrl)
    .filter((value): value is string => Boolean(value));

  const svgTextHints = preparedRefs.items
    .filter((item) => Boolean(item.svgText))
    .map((item) => `- ${item.filename}: ${item.svgText}`);

  const promptWithReferenceHints = svgTextHints.length > 0
    ? `${prompt}\n\nSVG reference hints from brief assets:\n${svgTextHints.join('\n')}`
    : prompt;

  if (preparedRefs.summary.requested > 0) {
    console.log(
      `[generate-image] Prepared refs: ready=${preparedRefs.summary.prepared}/${preparedRefs.summary.requested}, `
      + `skipped=${preparedRefs.summary.skipped}, oversized=${preparedRefs.summary.oversized}, `
      + `svgHints=${preparedRefs.summary.svgText}, cacheHit=${preparedRefs.summary.cached}`,
    );
  }

  shot.status = 'img_gen';
  await saveProject(project);

  try {
    let resultUrl: string;
    const referenceImages = toOpenRouterReferenceImages(refDataUrls);
    const imageOptions: ImageGenOptions = {
      size: effective.imageSize,
      quality: normalizeOpenRouterImageQuality(effective.imageQuality),
    };
    const fallbackModelId = resolveOpenRouterImageFallbackModel(
      modelId,
      effective.imageModel || 'openai/gpt-image-1',
    );
    const generateViaOpenRouter = async (targetModelId: string): Promise<string> => generateImageOpenRouter(
      targetModelId,
      promptWithReferenceHints,
      referenceImages,
      options.signal,
      imageOptions,
    );

    if (genModel) {
      if (genModel.requiresImageInput && refDataUrls.length === 0) {
        const noRefModelId = String(effective.imageNoRefGenModel || '').trim();

        if (!noRefModelId) {
          console.warn(
            `[generate-image] Model ${modelId} requires reference image, but shot has no references. Falling back to OpenRouter.`,
          );
          resultUrl = await generateViaOpenRouter(fallbackModelId);
        } else {
          const noRefModel = resolveImageModel(noRefModelId);

          if (noRefModel) {
            if (noRefModel.requiresImageInput) {
              console.warn(
                `[generate-image] Configured no-reference model ${noRefModelId} also requires image input. Falling back to OpenRouter.`,
              );
              resultUrl = await generateViaOpenRouter(fallbackModelId);
            } else {
              try {
                const resolution = resolveProviderImageResolution(effective.imageQuality);
                resultUrl = await generateImageMulti(
                  {
                    model: noRefModel,
                    prompt: promptWithReferenceHints,
                    aspectRatio: effective.imageAspectRatio,
                    resolution,
                  },
                  options.signal,
                );
              } catch (noRefErr: any) {
                console.warn(
                  `[generate-image] Configured no-reference model ${noRefModelId} failed (${noRefErr?.message || 'unknown error'}). Falling back to OpenRouter.`,
                );
                resultUrl = await generateViaOpenRouter(fallbackModelId);
              }
            }
          } else {
            try {
              resultUrl = await generateViaOpenRouter(noRefModelId);
            } catch (noRefErr: any) {
              console.warn(
                `[generate-image] Configured no-reference OpenRouter model ${noRefModelId} failed (${noRefErr?.message || 'unknown error'}). Falling back to OpenRouter default.`,
              );
              resultUrl = await generateViaOpenRouter(fallbackModelId);
            }
          }
        }
      } else {
        try {
          const resolution = resolveProviderImageResolution(effective.imageQuality);

          resultUrl = await generateImageMulti(
            {
              model: genModel,
              prompt: promptWithReferenceHints,
              referenceImageUrl: refDataUrls.length > 0 ? refDataUrls[0] : undefined,
              aspectRatio: effective.imageAspectRatio,
              resolution,
            },
            options.signal,
          );
        } catch (genErr: any) {
          if (genErr.message?.includes('not configured') || isMissingRequiredImageInputError(genErr)) {
            console.log(
              `[generate-image] Falling back to OpenRouter (${genErr.message?.includes('not configured') ? 'missing credentials' : 'missing image input'})`,
            );
            resultUrl = await generateViaOpenRouter(fallbackModelId);
          } else {
            throw genErr;
          }
        }
      }
    } else {
      console.log(`[generate-image] Model ${modelId} not in registry, using OpenRouter`);
      resultUrl = await generateViaOpenRouter(fallbackModelId);
    }

    let storedImageRef: string;
    let responseUrl: string;
    let needsBackgroundCache = false;

    const shotDir = resolveProjectPath(project.id, 'shots', shot.id, 'generated');
    await ensureDir(shotDir);

    const timestamp = Date.now();
    const filename = `gen_${timestamp}.png`;
    const filePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', filename);

    try {
      await saveImageResult(resultUrl, filePath);
      storedImageRef = filename;
      responseUrl = `/api/projects/${project.id}/shots/${shot.id}/generated/${filename}`;
    } catch (saveErr) {
      if (resultUrl.startsWith('http') && isTransientDownloadError(saveErr)) {
        console.warn('[generate-image] Could not cache image locally, storing external URL reference');
        storedImageRef = resultUrl;
        responseUrl = resultUrl;
        needsBackgroundCache = true;
      } else {
        throw saveErr;
      }
    }

    const refreshed = await getProject(project.id);
    if (!refreshed) {
      throw new Error('Project not found');
    }

    const refreshedShot = refreshed.shots.find((s) => s.id === shot.id);
    if (!refreshedShot) {
      throw new Error('Shot not found');
    }

    refreshedShot.generatedImages.push(storedImageRef);
    refreshedShot.status = 'img_review';
    await saveProject(refreshed);

    if (needsBackgroundCache) {
      void cacheExternalImageReference(project.id, shot.id, storedImageRef);
    }

    return {
      shotId: shot.id,
      filename: storedImageRef,
      url: responseUrl,
    };
  } catch (err) {
    const refreshed = await getProject(project.id);
    if (refreshed) {
      const refreshedShot = refreshed.shots.find((s) => s.id === shot.id);
      if (refreshedShot) {
        refreshedShot.status = 'draft';
        await saveProject(refreshed);
      }
    }
    throw err;
  }
}

// POST /api/projects/:id/shots/:shotId/cancel-generation
router.post('/shots/:shotId/cancel-generation', async (req: Request, res: Response) => {
  try {
    const key = genKey(req.params.id, req.params.shotId);
    const controller = activeGenerations.get(key);
    if (controller) {
      controller.abort();
      activeGenerations.delete(key);
    }
    const project = await getProject(req.params.id);
    if (project) {
      const shot = project.shots.find((s) => s.id === req.params.shotId);
      if (shot && (shot.status === 'img_gen' || shot.status === 'vid_gen')) {
        shot.status = shot.status === 'img_gen' ? 'draft' : 'img_review';
        await saveProject(project);
      }
    }
    res.json({ cancelled: true });
  } catch (err) {
    sendApiError(res, 500, getErrorMessage(err, 'Failed to cancel generation'), 'IMAGE_GENERATION_CANCEL_FAILED');
  }
});

// POST /api/projects/:id/cancel-all-generation
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
    const project = await getProject(projectId);
    if (project) {
      for (const shot of project.shots) {
        if (shot.status === 'img_gen') shot.status = 'draft';
        if (shot.status === 'vid_gen') shot.status = 'img_review';
      }
      await saveProject(project);
    }
    res.json({ cancelled });
  } catch (err) {
    sendApiError(res, 500, getErrorMessage(err, 'Failed to cancel active generations'), 'IMAGE_GENERATION_CANCEL_ALL_FAILED');
  }
});

// POST /api/projects/:id/shots/:shotId/generate-image
router.post('/shots/:shotId/generate-image', async (req: Request, res: Response) => {
  try {
    const abortController = new AbortController();
    const key = genKey(req.params.id, req.params.shotId);
    activeGenerations.set(key, abortController);

    try {
      const result = await generateShotImageForProject({
        projectId: req.params.id,
        shotId: req.params.shotId,
        modelId: req.body.model,
        prompt: req.body.prompt,
        signal: abortController.signal,
      });
      res.json({ filename: result.filename, url: result.url });
    } catch (genErr) {
      activeGenerations.delete(key);
      throw genErr;
    } finally {
      activeGenerations.delete(key);
    }
  } catch (err) {
    console.error('Failed to generate image:', err);
    const isCancelled = err instanceof Error && err.message === 'Generation cancelled';
    if (isCancelled) {
      sendApiError(res, 499, 'Generation cancelled', 'GENERATION_CANCELLED');
      return;
    }
    sendApiError(res, 500, getErrorMessage(err, 'Failed to generate image'), 'IMAGE_GENERATION_FAILED');
  }
});

// GET /api/projects/:id/shots/:shotId/generated/:filename
router.get('/shots/:shotId/generated/:filename', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const { shotId, filename } = req.params;
    let filePath: string;
    try {
      filePath = resolveProjectPath(project.id, 'shots', shotId, 'generated', filename);
    } catch {
      sendApiError(res, 403, 'Forbidden');
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      sendApiError(res, 404, 'File not found');
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve generated image:', err);
    sendApiError(res, 500, 'Failed to serve generated image');
  }
});

// POST /api/projects/:id/shots/:shotId/enhance-image
router.post('/shots/:shotId/enhance-image', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
      return;
    }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) {
      sendApiError(res, 404, 'Shot not found');
      return;
    }

    const { sourceImage, prompt: customPrompt, model: customModel } = req.body as {
      sourceImage: string;
      prompt?: string;
      model?: string;
    };

    if (!sourceImage) {
      sendApiError(res, 400, 'sourceImage is required');
      return;
    }
    if (isExternalMediaRef(sourceImage)) {
      void cacheExternalImageReference(project.id, shotId, sourceImage);
    }

    const effective = await resolveSettings(project);
    const enhanceModel = customModel || effective.enhanceModel;
    const enhancePrompt = customPrompt || effective.enhancePrompt;

    let referenceImage: ReferenceImage;
    try {
      referenceImage = await toReferenceImage(project.id, shotId, sourceImage);
    } catch {
      sendApiError(res, 404, `Source image not found: ${sourceImage}`);
      return;
    }

    const referenceImages: ReferenceImage[] = [referenceImage];

    const enhanceOptions: ImageGenOptions = {
      size: effective.enhanceSize,
      quality: effective.enhanceQuality,
    };

    console.log(`[enhance-image] model=${enhanceModel}, source=${sourceImage}, size=${enhanceOptions.size}, quality=${enhanceOptions.quality}`);

    let result: string;
    try {
      result = await generateImageOpenRouter(enhanceModel, enhancePrompt, referenceImages, undefined, enhanceOptions);
    } catch (err) {
      if (isExternalMediaRef(sourceImage) && isLikelyRemoteImageInputError(err)) {
        const localRef = await toLocalReferenceImage(project.id, shotId, sourceImage);
        if (localRef) {
          result = await generateImageOpenRouter(enhanceModel, enhancePrompt, [localRef], undefined, enhanceOptions);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const shotDir = resolveProjectPath(project.id, 'shots', shotId, 'generated');
    await ensureDir(shotDir);

    const timestamp = Date.now();
    const filename = `enh_${timestamp}.png`;
    const filePath = resolveProjectPath(project.id, 'shots', shotId, 'generated', filename);

    await saveImageResult(result, filePath);

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
    sendApiError(res, 500, getErrorMessage(err, 'Failed to enhance image'), 'IMAGE_ENHANCE_FAILED');
  }
});

// POST /api/projects/:id/enhance-all
router.post('/enhance-all', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      sendApiError(res, 404, 'Project not found');
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
      if (isExternalMediaRef(sourceImage)) {
        void cacheExternalImageReference(project.id, shot.id, sourceImage);
      }
      let referenceImage: ReferenceImage;
      try {
        referenceImage = await toReferenceImage(project.id, shot.id, sourceImage);
      } catch {
        console.warn(`[enhance-all] Skipping ${shot.id}: source not found`);
        continue;
      }

      const referenceImages: ReferenceImage[] = [referenceImage];

      const enhAllOptions: ImageGenOptions = {
        size: effective.enhanceSize,
        quality: effective.enhanceQuality,
      };

      try {
        let result: string;
        try {
          result = await generateImageOpenRouter(enhanceModel, enhancePrompt, referenceImages, undefined, enhAllOptions);
        } catch (err) {
          if (isExternalMediaRef(sourceImage) && isLikelyRemoteImageInputError(err)) {
            const localRef = await toLocalReferenceImage(project.id, shot.id, sourceImage);
            if (localRef) {
              result = await generateImageOpenRouter(enhanceModel, enhancePrompt, [localRef], undefined, enhAllOptions);
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }

        const shotDir = resolveProjectPath(project.id, 'shots', shot.id, 'generated');
        await ensureDir(shotDir);

        const timestamp = Date.now();
        const filename = `enh_${timestamp}.png`;
        const filePath = resolveProjectPath(project.id, 'shots', shot.id, 'generated', filename);

        await saveImageResult(result, filePath);

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
    sendApiError(res, 500, getErrorMessage(err, 'Failed to enhance images'), 'BATCH_IMAGE_ENHANCE_FAILED');
  }
});

// POST /api/projects/:id/shots/:shotId/ai-review
router.post('/shots/:shotId/ai-review', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }

    const shotId = req.params.shotId;
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) { sendApiError(res, 404, 'Shot not found'); return; }

    const sourceFile = getBestImageFile(shot);

    if (!sourceFile) {
      sendApiError(res, 400, 'No generated image to review');
      return;
    }
    if (isExternalMediaRef(sourceFile)) {
      void cacheExternalImageReference(project.id, shotId, sourceFile);
    }

    const effective = await resolveSettings(project);

    let imageUrlForReview: string;
    try {
      imageUrlForReview = await toReviewImageUrl(project.id, shotId, sourceFile);
    } catch {
      sendApiError(res, 404, `Image file not found: ${sourceFile}`);
      return;
    }

    console.log(`[ai-review] model=${effective.reviewModel}, shot=${shotId}`);

    const reviewMessages = [
      {
        role: 'system',
        content: `Ты — арт-директор рекламного агентства. Оцени сгенерированное изображение для рекламного видеоролика о недвижимости.
Дай короткую и конкретную оценку (3-5 предложений) на русском языке:
1. Соответствие образу: соответствует ли изображение описанию шота?
2. Качество: реализм, освещение, детали, люди.
3. Что исправить: конкретные недостатки, если есть.
4. Вердикт: УТВЕРДИТЬ / ПЕРЕГЕНЕРИРОВАТЬ / УЛУЧШИТЬ.
Не используй markdown-разметку, только чистый текст.`,
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrlForReview } },
          {
            type: 'text',
            text: `Описание шота: ${shot.scene}\nПромпт изображения: ${shot.imagePrompt}`,
          },
        ],
      },
    ];

    let reviewText: string;
    try {
      reviewText = await chatCompletion(effective.reviewModel, reviewMessages as any, 0.4);
    } catch (err) {
      if (isExternalMediaRef(sourceFile) && isLikelyRemoteImageInputError(err)) {
        const localRef = await toLocalReferenceImage(project.id, shotId, sourceFile);
        if (!localRef || localRef.kind === 'url') throw err;

        const fallbackReviewUrl = `data:${localRef.mimeType};base64,${localRef.base64}`;
        (reviewMessages[1] as any).content[0].image_url.url = fallbackReviewUrl;
        reviewText = await chatCompletion(effective.reviewModel, reviewMessages as any, 0.4);
      } else {
        throw err;
      }
    }

    res.json({ review: reviewText.trim() });
  } catch (err) {
    console.error('Failed to AI-review shot:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to review image'), 'IMAGE_REVIEW_FAILED');
  }
});

export default router;
