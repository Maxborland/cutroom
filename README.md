# CutRoom Video Pipeline

AI-assisted pipeline for producing short marketing videos from a brief: script generation, shot planning, image/video generation, review, and export.

## Stack

- Frontend: React 19, TypeScript, Vite, Zustand, Tailwind
- Backend: Express 5, file-based storage (`data/projects`)
- Tests: Vitest (unit/integration/components), Playwright (e2e)

## Pipeline

`Brief -> Script -> Shots -> Review -> Export`

Shot statuses: `draft -> img_gen -> img_review -> vid_gen -> vid_review -> approved`.

## Local Development

```bash
npm install
npm run dev:all
```

- Frontend: `http://localhost:5173`
- API server: `http://localhost:3001`

### API Access Key Mode

- By default, local development allows requests without `API_ACCESS_KEY`.
- If `REQUIRE_API_ACCESS_KEY=true`, missing `API_ACCESS_KEY` returns `503` for `/api/*` (except `/api/health`).
- Set `REQUIRE_API_ACCESS_KEY=false` (or leave unset) for local/dev work.
- Model discovery timeout is controlled by `MODEL_DISCOVERY_TIMEOUT_MS` (default: `5000`).

## Quality Gates

```bash
npm run lint
npm run build
npm run test
npm run test:integration
npm run test:components
```

## Settings Contracts

Global settings source of truth: `server/lib/config.ts` (`data/settings.json`), including:

- API keys: `openRouterApiKey`, `falApiKey`, `replicateApiToken`
- Defaults: `default*Model` values for text/describe/script/split/review/image/enhance/imageGen/videoGen/audioGen/director
- Generation params: `imageSize`, `imageQuality`, `enhanceSize`, `enhanceQuality`, `imageAspectRatio`
- Master prompts: `masterPrompt*`

Project-level settings source of truth: `server/lib/storage.ts` (`project.json`):

- `scriptwriterPrompt`, `shotSplitterPrompt`, `model`, `temperature`

## Fallback Behavior

Image fallback to OpenRouter uses an OpenRouter-compatible model id. If a provider-specific model (`fal/*`, `rep/*`) reaches OpenRouter fallback, it is remapped to a safe OpenRouter default (`openai/gpt-image-1`).
