# CutRoom Video Pipeline Design

## Overview

CutRoom is a local/team tool for AI-assisted video production:

- generate script from brief
- split script into structured shots
- generate and enhance images
- generate and review videos
- export production package

No authentication is required in the current scope.

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind, Zustand
- Backend: Express 5
- Storage: local filesystem (`data/projects`, `project.json`, media folders)
- AI providers: OpenRouter, fal.ai, Replicate
- Test stack: Vitest + Supertest + Playwright

## Pipeline Flow

`Brief -> Script -> Shots -> Review -> Export`

Shot status flow:

`draft -> img_gen -> img_review -> vid_gen -> vid_review -> approved`

## Data Contracts

### Project (`project.json`)

- `id`, `name`, `created`, `updated`, `stage`
- `brief`: `text`, `assets[]`, `targetDuration`
- `script`: generated script text
- `shots[]`: shot metadata and generated media references
- `settings`: project-level generation config

### Brief Asset

- `id`, `filename`, `label`, `url`, `uploadedAt`

### Shot

- `id`, `order`, `status`
- `scene`, `audioDescription`, `imagePrompt`, `videoPrompt`
- `duration`, `assetRefs[]`
- `generatedImages[]`, `enhancedImages[]`
- `selectedImage`, `videoFile`

### Project Settings (per project)

Defined in `server/lib/storage.ts`:

- `scriptwriterPrompt`
- `shotSplitterPrompt`
- `model`
- `temperature`

### Global Settings (app-wide)

Defined in `server/lib/config.ts`, persisted in `data/settings.json`:

- API keys: `openRouterApiKey`, `falApiKey`, `replicateApiToken`
- Model defaults: `default*Model` (text/describe/script/split/review/image/enhance/imageGen/videoGen/audioGen/director)
- Generation params: `imageSize`, `imageQuality`, `enhanceSize`, `enhanceQuality`, `imageAspectRatio`
- Prompt templates: `masterPrompt*`

## API Surface

### Projects

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

### Assets

- `POST /api/projects/:id/assets`
- `GET /api/projects/:id/assets/file/:filename`
- `DELETE /api/projects/:id/assets/:assetId`
- `PUT /api/projects/:id/assets/:assetId/label`
- `POST /api/projects/:id/assets/:assetId/describe`
- `POST /api/projects/:id/assets/describe-all`

### Generation

- `POST /api/projects/:id/generate-script`
- `POST /api/projects/:id/split-shots`
- `POST /api/projects/:id/shots/:shotId/generate-image`
- `POST /api/projects/:id/shots/:shotId/enhance-image`
- `POST /api/projects/:id/enhance-all`
- `POST /api/projects/:id/shots/:shotId/generate-video`
- `POST /api/projects/:id/generate-all-videos`
- `POST /api/projects/:id/shots/:shotId/cancel-generation`
- `POST /api/projects/:id/cancel-all-generation`

### Shots

- `PUT /api/projects/:id/shots/:shotId`
- `PUT /api/projects/:id/shots/:shotId/status`
- `PUT /api/projects/:id/shots/batch-status`
- `POST /api/projects/:id/shots/:shotId/video`
- `GET /api/projects/:id/shots/:shotId/generated/:filename`
- `GET /api/projects/:id/shots/:shotId/video/:filename`

### Export

- `GET /api/projects/:id/export`
- `GET /api/projects/:id/export/prompts`

## Behavioral Notes

- `PUT /api/projects/:id` deep-merges `settings`.
- `PUT /api/projects/:id` updates `brief.assets` labels without replacing immutable file metadata.
- `PUT /api/projects/:id/shots/batch-status` rejects empty `shotIds`.
- `/assets/describe-all` updates labels in memory and persists once after processing.

## Fallback Rules

For image fallback into OpenRouter, provider-specific ids (`fal/*`, `rep/*`) are remapped to an OpenRouter-compatible default:

- `openai/gpt-image-1`
