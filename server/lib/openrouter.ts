import { getApiKey } from '../routes/settings.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function makeRequest(body: Record<string, unknown>): Promise<OpenRouterResponse> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Please set it in Settings.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'CutRoom',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as OpenRouterResponse;
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

/**
 * Generate an image via OpenRouter (for models that support image generation).
 * Returns the content (base64 or URL depending on model).
 */
export async function generateImage(
  model: string,
  prompt: string
): Promise<string> {
  const data = await makeRequest({
    model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No content in OpenRouter image generation response');
  }

  return content;
}
