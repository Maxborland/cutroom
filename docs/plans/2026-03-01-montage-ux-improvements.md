# Montage UX Improvements Plan

**Date:** 2026-03-01
**Author:** Eva (Opus 4.6)
**Status:** Ready for implementation
**Executor:** Codex 5.3 (xhigh thinking)

---

## Overview

Six improvement areas for the CutRoom montage stage, addressing missing CRUD operations, UX feedback, audio control, timeline editing, and render transparency.

## Current State

- **Voiceover**: generate script → approve → generate TTS → audio player. No delete. No upload. No error feedback beyond generic "Обработка...".
- **Music**: upload or generate prompt → audio player + replace button. No delete. No progress. No error detail.
- **Plan**: timeline bar (visual only, not interactive). No drag-reorder. No transition editing. No shot duration editing.
- **Audio levels**: hardcoded in `montage-plan.ts` (music: -18dB, ducking: -10dB). No UI control.
- **Render**: polls every 3s, shows progress %. No SSE/WebSocket. No render log. No phase breakdown.

---

## Patchset 1: Voiceover Text Normalization for TTS

### Problem
ElevenLabs and other TTS engines "чеканят" (speak robotically) when text contains:
- Abbreviations (кв.м., ул., д.)
- Numbers without word form
- Punctuation that confuses prosody
- Long sentences without natural pauses

### Solution
Add a `normalizeVoiceoverText(text: string): string` function in `server/lib/tts-utils.ts` that:

1. **Expand abbreviations**: кв.м. → квадратных метров, ул. → улица, д. → дом, пр. → проспект, пос. → поселок
2. **Number-to-words**: Use ElevenLabs best practices — wrap numbers in SSML-like hints or spell them out for Russian
3. **Sentence splitting**: Break long sentences (>200 chars) at natural pause points (commas, dashes) with paragraph breaks `\n\n`
4. **Remove stage directions**: Strip anything in `[brackets]` or `(parentheses)` that leaked from the script
5. **Normalize dashes**: Replace em-dashes with comma-pauses for natural speech
6. **Trailing ellipsis**: Convert `...` to `.` with a preceding comma-pause

Call `normalizeVoiceoverText()` in `POST /montage/generate-voiceover` BEFORE passing text to TTS, and also expose it as a standalone endpoint for preview.

### Files to change
- **NEW** `server/lib/tts-utils.ts` — normalization logic
- `server/routes/montage.ts` — call normalize before `generateSpeech()`
- **NEW** `POST /api/projects/:id/montage/normalize-vo-text` — preview endpoint
- `src/components/MontageView.tsx` — optional "Нормализовать" button in VoiceoverStep

### Tests
- Unit tests for each normalization rule
- Integration test: POST generate-voiceover uses normalized text

---

## Patchset 2: Voiceover CRUD with Feedback

### Problem
No way to delete voiceover. No way to upload custom voiceover audio. No error feedback during generation (just spinner). No status for TTS in-progress.

### Solution

#### Backend
- **DELETE** `/api/projects/:id/montage/voiceover` — removes voiceover file + clears `voiceoverFile` from project
- **POST** `/api/projects/:id/montage/upload-voiceover` — multer upload (same pattern as music upload), validates audio MIME, writes to `montage/voiceover.{ext}`, updates project
- Return structured error messages from `generateSpeech()` failures (provider-specific: rate limit, quota, invalid voice, etc.)

#### Frontend (VoiceoverStep)
- **Delete button** (trash icon) next to audio player — confirmation dialog, calls DELETE endpoint
- **Upload button** (upload icon) — file picker for custom voiceover, calls upload endpoint
- **Error display**: catch errors from generateAudio, show in red alert box with retry button
- **Loading state improvement**: show "Генерация озвучки через {provider}..." instead of generic "Обработка..."

### Files to change
- `server/routes/montage.ts` — add DELETE /voiceover, POST /upload-voiceover
- `src/lib/api.ts` — add `deleteVoiceover()`, `uploadVoiceover()` methods
- `src/components/MontageView.tsx` — VoiceoverStep: add delete/upload buttons, error state

### Tests
- Integration: DELETE /voiceover removes file + clears project field
- Integration: POST /upload-voiceover with valid audio → saves + updates project
- Integration: POST /upload-voiceover with invalid MIME → 400

---

## Patchset 3: Music CRUD with Feedback

### Problem
Music has upload + replace, but no explicit delete. No progress indicator during upload. No error details. No visual feedback for large file uploads.

### Solution

#### Backend
- **DELETE** `/api/projects/:id/montage/music` — removes music file + clears `musicFile`/`musicProvider`/`musicPrompt` from project

#### Frontend (MusicStep)
- **Delete button** next to audio player — confirmation, calls DELETE
- **Upload progress**: use `XMLHttpRequest` with `onprogress` event (or `fetch` with ReadableStream) to show upload percentage for large files
- **Error display**: show specific error (file too large, invalid format, server error) in red alert
- **Loading state**: "Загрузка... {percent}%" during upload

### Files to change
- `server/routes/montage.ts` — add DELETE /music
- `src/lib/api.ts` — add `deleteMusic()`, modify `uploadMusic()` to support progress callback
- `src/components/MontageView.tsx` — MusicStep: delete button, progress bar, error display

### Tests
- Integration: DELETE /music removes file + clears fields
- Integration: DELETE /music when no music → 404

---

## Patchset 4: Interactive Timeline (Shot Reorder + Transitions)

### Problem
The plan step shows a static bar visualization. No way to:
- Reorder shots (drag-and-drop)
- Change transition types between shots
- Adjust individual shot duration
- Mute/solo individual shots

### Solution

#### Backend
- **PUT** `/api/projects/:id/montage/plan/timeline` — accepts reordered timeline array, validates shot IDs match, rebuilds transitions
- **PUT** `/api/projects/:id/montage/plan/timeline/:shotId` — update individual entry: `durationSec`, `trimEndSec`, `motionEffect`
- **PUT** `/api/projects/:id/montage/plan/transitions/:index` — update transition: `type` (fade/crossfade/cut/wipe), `durationSec`

#### Frontend (PlanStep)
- **Replace static bar with interactive timeline component** (`TimelineEditor.tsx`):
  - Each clip = draggable card showing shot thumbnail, duration, shot ID
  - Drag to reorder (use `@dnd-kit/sortable` or simple HTML drag-and-drop)
  - Click shot → expand: duration slider (0.5-30s), trim end, motion effect dropdown
  - Between shots: transition pill showing type → click to cycle (cut → fade → crossfade → wipe)
  - Intro/outro duration editable
- **Keyboard shortcuts**: Delete to remove shot from timeline, Ctrl+Z undo (keep last 5 states in local state)

### Files to change
- `server/routes/montage.ts` — 3 new PUT endpoints
- **NEW** `src/components/TimelineEditor.tsx` — interactive timeline
- `src/components/MontageView.tsx` — PlanStep uses TimelineEditor
- `src/lib/api.ts` — add timeline mutation methods

### Tests
- Unit: reorder timeline → correct order preserved
- Unit: update transition type → validates allowed values
- Integration: PUT timeline with missing shotId → 400

---

## Patchset 5: Audio Levels Control

### Problem
Audio levels are hardcoded: music at -18dB, ducking at -10dB, voiceover at 0dB. No way to adjust. No way to mute video track audio.

### Solution

#### Data Model
Add to `MontagePlan.audio`:
```typescript
audio: {
  voiceover: { file: string; gainDb: number; };
  music: {
    file: string;
    gainDb: number;
    duckingDb: number;
    duckFadeMs: number;
  };
  videoTrack: {
    gainDb: number;  // default: -Infinity (muted)
    muted: boolean;  // UI convenience flag
  };
  master: {
    gainDb: number;  // default: 0
  };
};
```

#### Backend
- **PUT** `/api/projects/:id/montage/plan/audio` — update audio levels in plan
- `montage-plan.ts` → `generateMontagePlan()` uses audio levels from project settings or defaults

#### Frontend
- **AudioMixer panel** in PlanStep (or as a sub-tab):
  - Vertical faders for: Voiceover, Music, Video (original audio), Master
  - dB labels (-∞ to +6)
  - Mute toggle per track (speaker icon with slash)
  - Ducking controls for music: ducking amount (dB), fade time (ms)
  - Visual: colored bars (green for VO, blue for music, gray for video)
- Values saved to plan on fader release (debounced PUT)

#### Remotion
- `AudioMixer.tsx` — already reads gainDb values; no changes needed if plan is correct
- May need to add `<OffthreadVideo>` audio track support (currently `<OffthreadVideo>` might strip audio — verify)

### Files to change
- `server/lib/storage.ts` — extend `MontagePlan.audio` type with `videoTrack`, `master`
- `server/lib/montage-plan.ts` — use configurable defaults
- `server/routes/montage.ts` — PUT /plan/audio
- **NEW** `src/components/AudioMixerPanel.tsx` — fader UI
- `src/components/MontageView.tsx` — embed AudioMixerPanel in PlanStep
- `src/lib/api.ts` — add `updateAudioLevels()`
- `server/remotion/src/compositions/MontageComposition.tsx` — pass video audio gain

### Tests
- Unit: generateMontagePlan with custom audio levels
- Integration: PUT /plan/audio → persisted in plan
- Integration: invalid gainDb range → 400

---

## Patchset 6: Render Progress & Transparency

### Problem
Render polls every 3s. Shows only percentage. No phase breakdown. No log. No estimated time. Error messages are truncated. No notification on completion.

### Solution

#### Backend
- **Extend `RenderJob`** with:
  ```typescript
  phase?: 'bundling' | 'compositing' | 'encoding' | 'finalizing';
  startedAt?: string;
  completedAt?: string;
  frameCurrent?: number;
  frameTotal?: number;
  fps?: number;  // render speed, not video fps
  ```
- **`render-worker.ts`**: Update `doRender()` to set phase transitions and frame counts:
  - `bundling` → during `bundle()`
  - `compositing` → during `selectComposition()`
  - `encoding` → during `renderMedia()` with frame-level progress
  - `finalizing` → after render, before marking done
- **Compute ETA**: `(frameTotal - frameCurrent) / fps` seconds remaining
- **SSE endpoint** (optional, stretch goal): `GET /api/projects/:id/montage/render/:jobId/stream` — Server-Sent Events for real-time progress without polling

#### Frontend (RenderStep)
- **Phase indicator**: show current phase with icon (bundle → composition → encoding → done)
- **Detailed progress**: "Кадр 450/1800 (25%) — ~2:15 осталось"
- **Render speed**: "12.5 fps"
- **Error detail**: full error message in expandable block
- **Browser notification**: `new Notification()` on completion (with permission request)
- **Auto-scroll to render step** when render completes

### Files to change
- `server/lib/storage.ts` — extend `RenderJob` type
- `server/lib/render-worker.ts` — set phases, frame counts, timestamps
- `server/routes/montage.ts` — (optional) SSE endpoint
- `src/components/MontageView.tsx` — RenderStep: detailed progress UI
- `src/lib/api.ts` — (optional) SSE client

### Tests
- Unit: RenderJob phase transitions in correct order
- Integration: GET /render/:jobId returns extended fields

---

## Implementation Order

1. **Patchset 1** (VO normalization) — standalone, no UI deps
2. **Patchset 2** (VO CRUD) — builds on patchset 1
3. **Patchset 3** (Music CRUD) — parallel with 2, same patterns
4. **Patchset 6** (Render transparency) — standalone backend, simple UI
5. **Patchset 5** (Audio levels) — needs plan schema change
6. **Patchset 4** (Interactive timeline) — most complex, do last

Patchsets 1-3 can be done in one sitting. Patchsets 4-6 are each a separate PR.

---

## Constraints

- UI language: Russian
- TDD: write tests first
- Each patchset = separate PR with `@codex` + `@greptile` review
- No new npm dependencies for drag-and-drop (use HTML5 DnD API); if needed, discuss first
- Keep file-based storage (no database)
- `--body-file` for `gh pr create` (not `--body`)
- 1 pre-existing failing integration test in assets.test.ts — ignore
