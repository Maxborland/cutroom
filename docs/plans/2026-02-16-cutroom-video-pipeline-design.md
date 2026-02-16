# CutRoom — Video Pipeline Design

## Overview

Web application for AI-assisted video production: script generation, shot decomposition, image/video generation, review, and export.

## Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS v4
- **Backend**: Express/Fastify (lightweight API proxy + file manager)
- **Storage**: File system (JSON metadata + media files in project folders)
- **State**: Zustand
- **AI**: OpenRouter API (configurable models for text + image generation)
- **Video gen**: Higgsfield (hybrid: manual export first, API integration later)

## Users

1-5 people, no auth required. Local/team tool.

## Pipeline Flow

```
Brief → Script → Shots → Generation → Review → Export
```

### Brief

- Text description of the video
- Image/folder upload (renders, references)
- Each asset has: `filename`, `label` (optional user description)
- Assets list is passed to LLM as context with filenames
- Master prompt for scriptwriter (configurable in Settings)

### Script Generation

- LLM receives: master prompt + brief text + asset manifest
- LLM generates cinematic script referencing files by name: `Используем: Exterior_sunset_001.jpg`
- Script displayed with highlighted filename badges
- Below: list of referenced files from brief

### Shot Splitting

- LLM receives: master prompt for splitter + script text
- Each shot parsed into structured data:
  - `scene` — scene description
  - `audioDescription` — voiceover/sound
  - `imagePrompt` — prompt for image generation
  - `videoPrompt` — prompt for Higgsfield
  - `duration` — seconds
  - `assetRefs` — filenames from brief (resolved by parser from LLM output)

### Shot Board (Kanban)

4 columns: Draft → Generating → Review → Approved

Each shot card shows: order number, status badge, duration, scene excerpt, linked asset filenames, media indicators.

Clicking a card opens detail panel (45% width) with:
- Editable scene description
- Editable audio description
- Linked assets from brief (read-only, shows filename + label)
- Image prompt (editable, "Generate" button, "Auto" button, "Copy" button)
- Video prompt for Higgsfield (editable, "Copy for Higgsfield" button)
- Generated images grid
- Video upload slot
- Status actions (approve, return to draft, etc.)

### Review

Same as Shot Board view, filtered to review status.

### Export

- Stats: total shots, approved, with video
- Shot list with readiness indicators
- Export ZIP: numbered clips, images, prompts (TXT), metadata.json
- Export prompts only option

## Data Structure

```
projects/
  <project-id>/
    project.json          # metadata, settings
    brief/
      brief.json          # text + assets manifest
      images/             # uploaded files
    script.json           # generated script text
    shots/
      shot-001/
        shot.json         # structured shot data
        reference/        # images from brief (copied)
        generated/        # AI-generated images
        video/            # video files from Higgsfield
    export/               # final export output
```

### Key Data Types

- `Project`: id, name, created, updated, stage, briefType, brief, script, shots[], settings
- `Brief`: text, assets[]
- `BriefAsset`: id, filename, label, url
- `Shot`: id, order, status, scene, audioDescription, imagePrompt, videoPrompt, duration, assetRefs[], generatedImages[], videoFile
- `ShotStatus`: draft | generating | review | approved
- `ProjectSettings`: textModel, imageModel, masterPromptScriptwriter, masterPromptShotSplitter

## API Design (Backend)

### Projects
- `GET /api/projects` — list projects
- `POST /api/projects` — create project
- `GET /api/projects/:id` — get project
- `PUT /api/projects/:id` — update project
- `DELETE /api/projects/:id` — delete project

### Brief Assets
- `POST /api/projects/:id/assets` — upload images (multipart)
- `POST /api/projects/:id/assets/folder` — upload folder
- `DELETE /api/projects/:id/assets/:assetId` — remove asset

### AI Generation
- `POST /api/projects/:id/generate-script` — generate script from brief via OpenRouter
- `POST /api/projects/:id/split-shots` — split script into shots via OpenRouter
- `POST /api/projects/:id/shots/:shotId/generate-image` — generate image for shot
- `POST /api/projects/:id/shots/:shotId/generate-image-prompt` — auto-generate image prompt

### Shots
- `PUT /api/projects/:id/shots/:shotId` — update shot
- `POST /api/projects/:id/shots/:shotId/video` — upload video file
- `PUT /api/projects/:id/shots/:shotId/status` — change status

### Export
- `GET /api/projects/:id/export` — download ZIP
- `GET /api/projects/:id/export/prompts` — download prompts only

## OpenRouter Integration

All LLM calls go through backend to protect API key.

Request format (OpenRouter compatible with OpenAI chat completions):
```json
{
  "model": "openai/gpt-4o",
  "messages": [
    {"role": "system", "content": "<master prompt>"},
    {"role": "user", "content": "<brief text + asset manifest>"}
  ]
}
```

Image generation via models that support image output (e.g., `openai/gpt-image-1`).

## Settings

Stored in `settings.json` at app root:
- `openRouterApiKey` — API key
- `defaultTextModel` — default text model
- `defaultImageModel` — default image model

Per-project settings override defaults.

## UI Theme

"Director's Desk" — dark cinematic aesthetic:
- Fonts: Syne (display), DM Sans (body), JetBrains Mono (code/labels)
- Colors: near-black bg (#08080a), warm amber accent (#e8a135), status colors (emerald/sky/violet/rose)
- Film grain texture overlay
- Amber glow effects on active elements
