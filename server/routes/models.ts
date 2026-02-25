import { Router, Request, Response } from 'express';
import { getApiKey, getFalApiKey, getGlobalSettings, type GlobalSettings } from '../lib/config.js';
import {
  DYNAMIC_FAL_MODEL_PREFIX,
  getVideoModelQualityOptions,
  IMAGE_MODELS,
  resolveImageModel,
  resolveVideoModel,
  VIDEO_MODELS,
} from '../lib/generation-models.js';

const router = Router();

interface OpenRouterModel {
  id: string;
  name: string;
  architecture?: {
    modality?: string;
  };
}

interface ModelOption {
  id: string;
  name: string;
  imageResolutionOptions?: string[];
  imageResolutionSupport?: 'explicit' | 'none';
  imageAspectRatioOptions?: string[];
  imageAspectRatioSupport?: 'explicit' | 'none';
  requiresImageInput?: boolean;
  videoQualityOptions?: string[];
  videoQualitySupport?: 'explicit' | 'none';
}

interface CachedModels {
  textModels: ModelOption[];
  imageModels: ModelOption[];
  fetchedAt: number;
}

interface FalCachedModels {
  apiKey: string;
  models: {
    imageGenModels: ModelOption[];
    videoGenModels: ModelOption[];
    audioGenModels: ModelOption[];
  };
  fetchedAt: number;
}

interface FalApiModel {
  endpoint_id?: string;
  endpointId?: string;
  id?: string;
  name?: string;
  display_name?: string;
  input_schema?: unknown;
  inputSchema?: unknown;
  schema?: unknown;
  parameters?: unknown;
  metadata?: {
    display_name?: string;
    displayName?: string;
    input_schema?: unknown;
    inputSchema?: unknown;
    schema?: unknown;
    parameters?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface FalApiResponse {
  models?: FalApiModel[];
  data?: FalApiModel[];
}

let openRouterCache: CachedModels | null = null;
let falCache: FalCachedModels | null = null;
const OPENROUTER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const FAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MODEL_DISCOVERY_TIMEOUT_MS = Number.parseInt(
  process.env.MODEL_DISCOVERY_TIMEOUT_MS ?? '5000',
  10,
) || 5000;

const IMAGE_MODEL_PATTERNS = [
  'dall-e', 'gpt-image', 'stable-diffusion', 'sdxl', 'midjourney',
  'flux', 'ideogram', 'recraft', 'imagen',
];

// fal.ai accepts base64 data URLs directly — no need to upload via fal.storage
const FAL_IMAGE_CATEGORIES = ['text-to-image', 'image-to-image'] as const;
const FAL_VIDEO_CATEGORIES = ['image-to-video', 'text-to-video'] as const;
const FAL_AUDIO_CATEGORIES = ['text-to-audio', 'text-to-speech'] as const;

const FALLBACK_FAL_IMAGE_MODELS: ModelOption[] = IMAGE_MODELS
  .filter((m) => m.provider === 'fal')
  .map((m) =>
    toImageModelOption(
      { id: m.id, name: m.name },
      [],
      [],
      Boolean(m.requiresImageInput),
    ));

const FALLBACK_FAL_VIDEO_MODELS: ModelOption[] = VIDEO_MODELS
  .filter((m) => m.provider === 'fal')
  .map((m) => toVideoModelOption({ id: m.id, name: m.name }));

const REPLICATE_IMAGE_MODELS: ModelOption[] = IMAGE_MODELS
  .filter((m) => m.provider === 'replicate')
  .map((m) => ({ id: m.id, name: m.name }));

const REPLICATE_VIDEO_MODELS: ModelOption[] = VIDEO_MODELS
  .filter((m) => m.provider === 'replicate')
  .map((m) => toVideoModelOption({ id: m.id, name: m.name }));

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_DISCOVERY_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError';
    if (isAbort) {
      throw new Error(`Request timed out after ${MODEL_DISCOVERY_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function isImageModel(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality || '';
  if (modality.includes('image')) return true;
  const idLower = model.id.toLowerCase();
  return IMAGE_MODEL_PATTERNS.some((p) => idLower.includes(p));
}

function isTextModel(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality || '';
  if (modality.includes('text') && !modality.includes('image')) return true;
  if (!modality) return !isImageModel(model);
  return modality.includes('text');
}

async function fetchModels(): Promise<CachedModels> {
  if (openRouterCache && Date.now() - openRouterCache.fetchedAt < OPENROUTER_CACHE_TTL) {
    return openRouterCache;
  }

  try {
    const apiKey = await getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/models', { headers });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: OpenRouterModel[] };
    const models = data.data || [];

    const textModels = models
      .filter(isTextModel)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const imageModels = models
      .filter(isImageModel)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    openRouterCache = { textModels, imageModels, fetchedAt: Date.now() };
    return openRouterCache;
  } catch (err) {
    console.error('Failed to fetch models from OpenRouter:', err);
    return { textModels: [], imageModels: [], fetchedAt: 0 };
  }
}

function dedupeById(models: ModelOption[]): ModelOption[] {
  const unique = new Map<string, ModelOption>();
  for (const model of models) {
    if (!unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildFallbackFalModelGroups(): {
  imageGenModels: ModelOption[];
  videoGenModels: ModelOption[];
  audioGenModels: ModelOption[];
} {
  return {
    imageGenModels: dedupeById([...FALLBACK_FAL_IMAGE_MODELS, ...REPLICATE_IMAGE_MODELS]),
    videoGenModels: dedupeById([...FALLBACK_FAL_VIDEO_MODELS, ...REPLICATE_VIDEO_MODELS]),
    audioGenModels: [],
  };
}

function normalizeVideoQualityOptions(values: string[]): string[] {
  return normalizeModelOptions(values);
}

function normalizeImageResolutionOptions(values: string[]): string[] {
  return normalizeModelOptions(values);
}

function normalizeImageAspectRatioOptions(values: string[]): string[] {
  return normalizeModelOptions(values);
}

function normalizeModelOptions(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

function toImageModelOption(
  base: ModelOption,
  explicitResolutionOptions: string[] = [],
  explicitAspectRatioOptions: string[] = [],
  requiresImageInput = false,
): ModelOption {
  const normalizedResolutions = normalizeImageResolutionOptions(explicitResolutionOptions);
  const normalizedAspectRatios = normalizeImageAspectRatioOptions(explicitAspectRatioOptions);

  const option: ModelOption = {
    ...base,
    imageResolutionSupport: normalizedResolutions.length > 0 ? 'explicit' : 'none',
    imageAspectRatioSupport: normalizedAspectRatios.length > 0 ? 'explicit' : 'none',
  };

  if (normalizedResolutions.length > 0) {
    option.imageResolutionOptions = normalizedResolutions;
  }

  if (normalizedAspectRatios.length > 0) {
    option.imageAspectRatioOptions = normalizedAspectRatios;
  }

  if (requiresImageInput) {
    option.requiresImageInput = true;
  }

  return option;
}

function toVideoModelOption(base: ModelOption, explicitVideoQualityOptions: string[] = []): ModelOption {
  const normalizedExplicit = normalizeVideoQualityOptions(explicitVideoQualityOptions);
  if (normalizedExplicit.length > 0) {
    return {
      ...base,
      videoQualityOptions: normalizedExplicit,
      videoQualitySupport: 'explicit',
    };
  }

  return {
    ...base,
    videoQualitySupport: 'none',
  };
}

function getInferredDynamicVideoQualityOptions(modelId: string): string[] {
  if (!modelId.startsWith(DYNAMIC_FAL_MODEL_PREFIX)) return [];

  const resolved = resolveVideoModel(modelId);
  if (!resolved || resolved.provider !== 'fal') return [];

  return normalizeVideoQualityOptions(getVideoModelQualityOptions(resolved));
}

function findStaticFalImageModelByEndpoint(endpoint: string): { id: string; name: string } | null {
  const staticModel = IMAGE_MODELS.find(
    (model) => model.provider === 'fal' && model.endpoint === endpoint,
  );

  if (!staticModel) return null;
  return { id: staticModel.id, name: staticModel.name };
}

function findStaticFalVideoModelByEndpoint(endpoint: string): { id: string; name: string } | null {
  const staticModel = VIDEO_MODELS.find(
    (model) => model.provider === 'fal' && model.endpoint === endpoint,
  );

  if (!staticModel) return null;
  return { id: staticModel.id, name: staticModel.name };
}

function extractStringOptions(node: unknown): string[] {
  if (!node) return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => extractStringOptions(item));
  }

  if (typeof node === 'string') {
    const value = node.trim();
    return value ? [value] : [];
  }

  if (typeof node !== 'object') {
    return [];
  }

  const obj = node as Record<string, unknown>;
  const collected: string[] = [];

  for (const key of ['value', 'const', 'name', 'id', 'title', 'label']) {
    if (typeof obj[key] === 'string') {
      const value = String(obj[key]).trim();
      if (value) collected.push(value);
    }
  }

  for (const key of ['enum', 'values', 'options', 'allowed_values', 'allowedValues', 'anyOf', 'oneOf']) {
    const value = obj[key];
    if (value !== undefined) {
      collected.push(...extractStringOptions(value));
    }
  }

  return collected;
}

function normalizeFieldKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function collectFieldOptionsFromNode(
  node: unknown,
  out: string[],
  fieldAliases: Set<string>,
  seen: WeakSet<object>,
  depth = 0,
): void {
  if (!node || depth > 8) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectFieldOptionsFromNode(item, out, fieldAliases, seen, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  const obj = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    if (fieldAliases.has(normalizeFieldKey(key))) {
      out.push(...extractStringOptions(value));
    }
  }

  const fieldKey = normalizeFieldKey(
    obj.name ?? obj.key ?? obj.id ?? obj.field ?? obj.parameter ?? '',
  );
  if (fieldAliases.has(fieldKey)) {
    out.push(...extractStringOptions(obj));
  }

  for (const value of Object.values(obj)) {
    collectFieldOptionsFromNode(value, out, fieldAliases, seen, depth + 1);
  }
}

function collectFalSchemaFieldOptions(model: FalApiModel, fieldAliases: string[]): string[] {
  const candidates = [
    model.input_schema,
    model.inputSchema,
    model.schema,
    model.parameters,
    model.metadata?.input_schema,
    model.metadata?.inputSchema,
    model.metadata?.schema,
    model.metadata?.parameters,
    model.metadata,
    model,
  ];

  const collected: string[] = [];
  const seen = new WeakSet<object>();
  const aliasSet = new Set(fieldAliases.map((alias) => normalizeFieldKey(alias)));
  for (const candidate of candidates) {
    collectFieldOptionsFromNode(candidate, collected, aliasSet, seen, 0);
  }

  return collected;
}

function extractVideoQualityOptionsFromFalModel(model: FalApiModel): string[] {
  return normalizeVideoQualityOptions(
    collectFalSchemaFieldOptions(model, ['resolution']),
  );
}

function extractImageResolutionOptionsFromFalModel(model: FalApiModel): string[] {
  return normalizeImageResolutionOptions(
    collectFalSchemaFieldOptions(model, ['resolution']),
  );
}

function extractImageAspectRatioOptionsFromFalModel(model: FalApiModel): string[] {
  return normalizeImageAspectRatioOptions(
    collectFalSchemaFieldOptions(model, ['aspect_ratio', 'aspectRatio']),
  );
}

function toDynamicFalModel(
  model: FalApiModel,
  kind: 'image' | 'video' | 'audio',
): ModelOption | null {
  const endpoint = (model.endpoint_id || model.endpointId || model.id || '').trim();
  if (!endpoint || !endpoint.includes('/')) return null;

  if (kind === 'video') {
    const explicitVideoQualityOptions = extractVideoQualityOptionsFromFalModel(model);
    const staticMatch = findStaticFalVideoModelByEndpoint(endpoint);
    if (staticMatch) {
      return toVideoModelOption(staticMatch, explicitVideoQualityOptions);
    }

    const modelId = `${DYNAMIC_FAL_MODEL_PREFIX}${endpoint}`;
    const inferredVideoQualityOptions =
      explicitVideoQualityOptions.length > 0
        ? []
        : getInferredDynamicVideoQualityOptions(modelId);
    return toVideoModelOption(
      {
        id: modelId,
        name: (
          model.metadata?.display_name ||
          model.metadata?.displayName ||
          model.display_name ||
          model.name ||
          endpoint
        ).trim() || endpoint,
      },
      explicitVideoQualityOptions.length > 0
        ? explicitVideoQualityOptions
        : inferredVideoQualityOptions,
    );
  }

  if (kind === 'image') {
    const explicitResolutionOptions = extractImageResolutionOptionsFromFalModel(model);
    const explicitAspectRatioOptions = extractImageAspectRatioOptionsFromFalModel(model);
    const staticMatch = findStaticFalImageModelByEndpoint(endpoint);
    const modelId = staticMatch?.id || `${DYNAMIC_FAL_MODEL_PREFIX}${endpoint}`;
    const resolvedImage = resolveImageModel(modelId);
    const requiresImageInput = Boolean(resolvedImage?.requiresImageInput);

    return toImageModelOption(
      {
        id: modelId,
        name: staticMatch?.name || (
          model.metadata?.display_name ||
          model.metadata?.displayName ||
          model.display_name ||
          model.name ||
          endpoint
        ).trim() || endpoint,
      },
      explicitResolutionOptions,
      explicitAspectRatioOptions,
      requiresImageInput,
    );
  }

  const modelId = `${DYNAMIC_FAL_MODEL_PREFIX}${endpoint}`;

  const displayName = (
    model.metadata?.display_name ||
    model.metadata?.displayName ||
    model.display_name ||
    model.name ||
    endpoint
  ).trim();

  const option: ModelOption = {
    id: modelId,
    name: displayName || endpoint,
  };

  return option;
}

async function fetchFalCategory(apiKey: string, category: string): Promise<FalApiModel[]> {
  const response = await fetchWithTimeout(
    `https://api.fal.ai/v1/models?category=${encodeURIComponent(category)}`,
    {
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`fal.ai models API error: ${response.status} (category=${category})`);
  }

  const data = (await response.json()) as FalApiResponse;
  const models = data.models || data.data || [];
  return Array.isArray(models) ? models : [];
}

async function fetchFalByQuery(apiKey: string, query: string): Promise<FalApiModel[]> {
  const response = await fetchWithTimeout(
    `https://api.fal.ai/v1/models?q=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`fal.ai models API error: ${response.status} (q=${query})`);
  }

  const data = (await response.json()) as FalApiResponse;
  const models = data.models || data.data || [];
  return Array.isArray(models) ? models : [];
}

function isLikelyVideoEndpoint(endpoint: string): boolean {
  const value = endpoint.toLowerCase();
  return value.includes('image-to-video')
    || value.includes('text-to-video')
    || value.includes('/video/');
}

async function fetchFalModelsForCategories(
  apiKey: string,
  categories: readonly string[],
  kind: 'image' | 'video' | 'audio',
): Promise<ModelOption[]> {
  const results = await Promise.allSettled(
    categories.map((category) => fetchFalCategory(apiKey, category)),
  );

  const merged: ModelOption[] = [];
  let successCount = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      successCount += 1;
      for (const model of result.value) {
        const mapped = toDynamicFalModel(model, kind);
        if (mapped) merged.push(mapped);
      }
    }
  }

  if (successCount === 0) {
    if (kind === 'video') {
      const queryResults = await Promise.allSettled([
        fetchFalByQuery(apiKey, 'image-to-video'),
        fetchFalByQuery(apiKey, 'video'),
      ]);

      const fallbackMerged: ModelOption[] = [];
      for (const result of queryResults) {
        if (result.status !== 'fulfilled') continue;

        for (const model of result.value) {
          const endpoint = String(model.endpoint_id || model.endpointId || model.id || '');
          if (!isLikelyVideoEndpoint(endpoint)) continue;
          const mapped = toDynamicFalModel(model, 'video');
          if (mapped) fallbackMerged.push(mapped);
        }
      }

      const dedupedFallback = dedupeById(fallbackMerged);
      if (dedupedFallback.length > 0) {
        return dedupedFallback;
      }
    }

    throw new Error(`Failed all fal.ai category requests: ${categories.join(', ')}`);
  }

  return dedupeById(merged);
}

async function fetchFalModelGroups(): Promise<{
  imageGenModels: ModelOption[];
  videoGenModels: ModelOption[];
  audioGenModels: ModelOption[];
}> {
  const apiKey = (await getFalApiKey()).trim();

  if (!apiKey) {
    falCache = null;
    return buildFallbackFalModelGroups();
  }

  if (falCache && falCache.apiKey !== apiKey) {
    falCache = null;
  }

  if (falCache && Date.now() - falCache.fetchedAt < FAL_CACHE_TTL) {
    return falCache.models;
  }

  const [imageResult, videoResult, audioResult] = await Promise.allSettled([
    fetchFalModelsForCategories(apiKey, FAL_IMAGE_CATEGORIES, 'image'),
    fetchFalModelsForCategories(apiKey, FAL_VIDEO_CATEGORIES, 'video'),
    fetchFalModelsForCategories(apiKey, FAL_AUDIO_CATEGORIES, 'audio'),
  ]);

  if (
    imageResult.status === 'rejected' &&
    videoResult.status === 'rejected' &&
    audioResult.status === 'rejected'
  ) {
    console.error('Failed to fetch fal.ai models for all categories:', {
      imageError: imageResult.reason,
      videoError: videoResult.reason,
      audioError: audioResult.reason,
    });

    return buildFallbackFalModelGroups();
  }

  if (imageResult.status === 'rejected') {
    console.error('Failed to fetch fal.ai image models:', imageResult.reason);
  }
  if (videoResult.status === 'rejected') {
    console.error('Failed to fetch fal.ai video models:', videoResult.reason);
  }
  if (audioResult.status === 'rejected') {
    console.error('Failed to fetch fal.ai audio models:', audioResult.reason);
  }

  const dynamicImageModels = imageResult.status === 'fulfilled' ? imageResult.value : [];
  const dynamicVideoModels = videoResult.status === 'fulfilled' ? videoResult.value : [];
  const dynamicAudioModels = audioResult.status === 'fulfilled' ? audioResult.value : [];

  const models = {
    imageGenModels: dedupeById([
      ...dynamicImageModels,
      ...FALLBACK_FAL_IMAGE_MODELS,
      ...REPLICATE_IMAGE_MODELS,
    ]),
    videoGenModels: dedupeById([
      ...dynamicVideoModels,
      ...FALLBACK_FAL_VIDEO_MODELS,
      ...REPLICATE_VIDEO_MODELS,
    ]),
    audioGenModels: dynamicAudioModels,
  };

  falCache = {
    apiKey,
    models,
    fetchedAt: Date.now(),
  };

  return models;
}

function ensureModelOption(
  list: ModelOption[],
  modelId: string | undefined,
  category: 'image' | 'video',
): ModelOption[] {
  const id = String(modelId || '').trim();
  if (!id) return list;
  if (list.some((item) => item.id === id)) return list;

  if (category === 'video') {
    const resolved = resolveVideoModel(id);
    const name = resolved?.name || id;
    return dedupeById([...list, toVideoModelOption({ id, name })]);
  }

  const resolved = resolveImageModel(id);
  const name = resolved?.name || id;
  return dedupeById([
    ...list,
    toImageModelOption({ id, name }, [], [], Boolean(resolved?.requiresImageInput)),
  ]);
}

router.get('/', async (_req: Request, res: Response) => {
  const [openRouterResult, falResult, globalSettings] = await Promise.all([
    fetchModels(),
    fetchFalModelGroups(),
    getGlobalSettings().catch(() => ({} as GlobalSettings)),
  ]);

  const imageGenModels = ensureModelOption(
    falResult.imageGenModels,
    globalSettings.defaultImageGenModel,
    'image',
  );

  const videoGenModels = ensureModelOption(
    falResult.videoGenModels,
    globalSettings.defaultVideoGenModel,
    'video',
  );

  res.json({
    textModels: openRouterResult.textModels,
    imageModels: openRouterResult.imageModels,
    imageGenModels,
    videoGenModels,
    audioGenModels: falResult.audioGenModels,
  });
});

/** Reset the model cache (used in tests) */
export function resetModelCache(): void {
  openRouterCache = null;
  falCache = null;
}

export default router;
