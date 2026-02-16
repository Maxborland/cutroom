import { getApiKey } from '../routes/settings.js';

type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string | null;
      images?: Array<{
        type: string;
        image_url: { url: string };
      }>;
    };
  }>;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes for long LLM responses

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRequest(body: Record<string, unknown>, externalSignal?: AbortSignal): Promise<OpenRouterResponse> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Please set it in Settings.');
  }

  console.log(`[openrouter] POST ${OPENROUTER_URL} model=${body.model} key=...${apiKey.slice(-4)}`);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Check if externally cancelled before starting attempt
    if (externalSignal?.aborted) {
      throw new Error('Generation cancelled');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Forward external abort to our controller
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'CutRoom',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[openrouter] API error ${response.status}:`, errorText);
        // Don't retry on 4xx client errors (except 429 rate limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
        }
        lastError = new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      } else {
        return (await response.json()) as OpenRouterResponse;
      }
    } catch (fetchErr) {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      // Don't retry if externally cancelled
      if (externalSignal?.aborted) {
        throw new Error('Generation cancelled');
      }
      // Don't retry non-network errors (e.g. 4xx thrown above)
      if (fetchErr instanceof Error && fetchErr.message.startsWith('OpenRouter API error (4')) {
        throw fetchErr;
      }
      lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      console.error(`[openrouter] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
    }

    if (attempt < MAX_RETRIES) {
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s
      console.log(`[openrouter] Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  throw new Error(`Failed to connect to OpenRouter after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Send a chat completion request to OpenRouter.
 * Returns the content string from the first choice.
 */
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  temperature = 0.7
): Promise<string> {
  const data = await makeRequest({
    model,
    messages,
    temperature,
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No content in OpenRouter response');
  }

  return content;
}

export interface ReferenceImage {
  base64: string;   // raw base64 (no data: prefix)
  mimeType: string; // e.g. "image/jpeg"
}

export interface ImageGenOptions {
  size?: string;    // e.g. "1024x1024", "1536x1024", "auto"
  quality?: string; // e.g. "low", "medium", "high"
}

/**
 * Generate an image via OpenRouter (for models that support image generation).
 * Optionally accepts reference images that are sent as multimodal content
 * so the model generates FROM the reference rather than from scratch.
 * Returns a data URL (data:image/png;base64,...) or an https URL.
 */
export async function generateImage(
  model: string,
  prompt: string,
  referenceImages?: ReferenceImage[],
  signal?: AbortSignal,
  options?: ImageGenOptions,
): Promise<string> {
  // Build multimodal content: reference images first, then text prompt
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  if (referenceImages?.length) {
    for (const ref of referenceImages) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${ref.mimeType};base64,${ref.base64}` },
      });
    }
    // Text prompt instructs to use the reference as the base
    contentParts.push({
      type: 'text',
      text: `Use the provided reference image(s) as the visual base. Generate a new image that preserves the composition, architecture, and perspective of the reference but applies the following creative direction:\n\n${prompt}`,
    });
  } else {
    contentParts.push({ type: 'text', text: prompt });
  }

  const body: Record<string, unknown> = {
    model,
    modalities: ['image', 'text'],
    messages: [
      {
        role: 'user',
        content: contentParts,
      },
    ],
  };

  if (options?.size) body.size = options.size;
  if (options?.quality) body.quality = options.quality;

  const data = await makeRequest(body, signal);

  const msg = data.choices?.[0]?.message;

  // Check for images array first (Gemini and other image models)
  if (msg?.images?.length) {
    const imageUrl = msg.images[0].image_url?.url;
    if (imageUrl) {
      console.log(`[openrouter] Got image from images array (${imageUrl.slice(0, 30)}...)`);
      return imageUrl;
    }
  }

  // Fallback: some models return image data directly in content
  const content = msg?.content;
  if (content) {
    console.log(`[openrouter] Got image from content (${content.slice(0, 30)}...)`);
    return content;
  }

  console.error('[openrouter] Full response:', JSON.stringify(data).slice(0, 500));
  throw new Error('No image data in OpenRouter response');
}
