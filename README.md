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
- 🎞 **Auto-Montage** — Heuristic-based timeline assembly with transitions
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

## License

AGPL-3.0 License — see [LICENSE](LICENSE) for details.
