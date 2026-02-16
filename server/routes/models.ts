import { Router, Request, Response } from 'express';
import { getApiKey } from './settings.js';

const router = Router();

interface OpenRouterModel {
  id: string;
  name: string;
  architecture?: {
    modality?: string;
  };
}

interface CachedModels {
  textModels: { id: string; name: string }[];
  imageModels: { id: string; name: string }[];
  fetchedAt: number;
}

let cache: CachedModels | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const IMAGE_MODEL_PATTERNS = [
  'dall-e', 'gpt-image', 'stable-diffusion', 'sdxl', 'midjourney',
  'flux', 'ideogram', 'recraft', 'imagen',
];

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
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache;
  }

  try {
    const apiKey = await getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', { headers });

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

    cache = { textModels, imageModels, fetchedAt: Date.now() };
    return cache;
  } catch (err) {
    console.error('Failed to fetch models from OpenRouter:', err);
    return { textModels: [], imageModels: [], fetchedAt: 0 };
  }
}

router.get('/', async (_req: Request, res: Response) => {
  const { textModels, imageModels } = await fetchModels();
  res.json({ textModels, imageModels });
});

/** Reset the model cache (used in tests) */
export function resetModelCache(): void {
  cache = null;
}

export default router;
