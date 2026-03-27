<div align="center">

# CutRoom

**AI-powered video production pipeline. From brief to 4K render.**

[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Remotion](https://img.shields.io/badge/Remotion-Render-0B84F3)](https://remotion.dev/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

</div>

---

## Overview

CutRoom automates the video production workflow that typically requires a team of scriptwriters, designers, video editors, and sound engineers. One person can produce professional marketing videos end-to-end using AI.

## Pipeline

```
Brief → Script → Shot Planning → Image/Video Generation → Review → Voiceover → Music → Montage → 4K Render
```

## Features

- 🎬 **Script Generation** — AI writes video scripts from a brief
- 🎨 **Shot Planning** — Automatic shot breakdown with scene descriptions
- 🖼 **AI Image/Video Gen** — fal.ai, Replicate, OpenRouter integration
- 👁 **Director Review** — Human-in-the-loop approval for each shot
- 🎙 **Voiceover** — ElevenLabs TTS with script-to-speech pipeline
- 🎵 **Music** — LLM-generated prompts for Suno + manual upload
- 🎞 **Auto-Montage** — Semantic anchor-first timeline assembly with weak-match review
- 📐 **4K Render** — Remotion-powered deterministic video rendering
- 🔄 **LLM Refinement** — Refine montage plan with natural language feedback

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Zustand + Tailwind CSS + Vite |
| Backend | Express 5 + file-based storage |
| AI/ML | OpenRouter, fal.ai, Replicate, ElevenLabs |
| Video | Remotion + ffmpeg (normalize, Ken Burns, encode) |
| Testing | Vitest (unit) + Playwright (E2E) |

## Quick Start

```bash
npm install
npm run dev:all
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

## Self-Hosted Bundle

The repository now includes a single-tenant self-hosted profile:

- [docs/self-hosted.md](docs/self-hosted.md)
- `Dockerfile`
- `docker-compose.self-hosted.yml`
- `.env.self-hosted.example`

Quick start:

```bash
cp .env.self-hosted.example .env.self-hosted
docker compose --env-file .env.self-hosted -f docker-compose.self-hosted.yml up -d --build
```

This profile runs:

- one `app` container serving both the frontend and `/api`
- one `worker` container for background jobs
- one `postgres` container
- the public app URL on `http://<server>:<APP_HOST_PORT>` (defaults to `3001`)

## Database Bootstrap

PostgreSQL support is scaffolded for future backend work without changing the current file-based routes yet.

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/cut_room"
npm run db:migrate
npm run db:check
```

- `server/db/index.ts` creates a shared `pg` pool and exposes a simple healthcheck.
- `server/db/migrations/0001_initial.sql` is the first tracked migration.
- `npm run db:migrate` uses a PostgreSQL advisory lock so concurrent migration processes cannot both execute the same migration body.
- `npm run db:check` now behaves like a real verification command: it fails if `DATABASE_URL` is missing or if tracked migrations are still pending.
- `tests/integration/setup.ts` stays as the shared helper module for app/test bootstrap.
- `tests/integration/setup.test.ts` smoke-tests `createDb(...)` with an explicit connection string and closes the pool without requiring a live PostgreSQL server.

## Architecture

```
server/
├── routes/montage.ts      # Montage pipeline endpoints
├── lib/storage.ts         # Project types & file-based storage
├── lib/montage-plan.ts    # Heuristic plan generation
├── lib/normalize.ts       # ffmpeg clip normalization
├── lib/config.ts          # Global settings
└── lib/openrouter.ts      # LLM integration

src/
├── components/            # React UI components
├── lib/api.ts             # API client
├── stores/                # Zustand state
└── types/                 # TypeScript interfaces
```

## Semantic Montage Flow

The montage pipeline now supports a `video description first` semantic planning pass:

```text
voiceoverScript -> narration anchors -> video descriptions -> anchor matches -> draft montage plan
```

What this adds:

- approved shot videos can be described before planning
- narrator text can be split into ordered visual anchors
- anchors are matched against described videos with `matched / weak_match / unmatched`
- weak matches can be reviewed and overridden in the montage UI before draft generation
- OpenReel handoff now preserves semantic metadata and draft trims for future editor-side tooling

Operator guidance:

- use `Описать видео` before `Извлечь якоря`, so matching has stronger visual evidence
- review `Требует проверки` / `Нет совпадения` anchors in the montage plan step
- save manual shot overrides before generating the draft plan when semantic confidence is low

## License

AGPL-3.0 License — see [LICENSE](LICENSE) for details.
