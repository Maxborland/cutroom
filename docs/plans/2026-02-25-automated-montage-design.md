# Automated Montage -- Design Document

**Date:** 2026-02-25
**Author:** Eva (AI partner)
**Status:** Draft -- awaiting approval

---

## 1. Goal

Add an automated montage stage to the CutRoom pipeline that takes approved shots and produces a finished, broadcast-ready 4K video with motion graphics, voiceover, and music -- requiring minimal manual intervention.

## 2. Current State (as-is)

### Pipeline stages
```
brief -> script -> shots -> [img/vid generation per shot] -> review -> export (ZIP)
```

### Project model (`Project`)
- `stage`: `'brief' | 'script' | 'shots' | 'review' | 'export'`
- `shots[]`: each shot has `status` flow: `draft -> img_gen -> img_review -> vid_gen -> vid_review -> approved`
- Export: ZIP archive of raw files + metadata

### What's missing
- No concatenation of approved shot videos into a single timeline
- No voiceover, music, or motion graphics
- No deterministic render pipeline

## 3. Architecture Decision

**Remotion as render engine + LLM edits a declarative JSON plan (not code).**

Remotion provides a stable, versioned library of React components (transitions, titles, audio mixer). The LLM generates and iterates on a `montagePlan` (JSON), which Remotion interprets at render time. This keeps the render pipeline deterministic and testable.

### Why not LLM editing Remotion code directly?
- Brittle: JSX/React diffs from LLM can break builds
- Slow: requires tsc + lint + test after each change
- Reserved as "expert mode" for later (v2)

### Why not pure FFmpeg?
- Insufficient for motion graphics, branded intros/outros, lower thirds
- FFmpeg still used under the hood for clip normalization (fps/codec/resolution)

## 4. Extended Pipeline

```
brief -> script -> shots -> review -> montage -> render
```

New project stages:
```typescript
type PipelineStage = 'brief' | 'script' | 'shots' | 'review' | 'export'
                   | 'montage_draft' | 'montage_review' | 'rendered'
```

### Montage sub-flow (user perspective)
1. All shots reach `approved` status
2. User clicks "Generate voiceover script" -> LLM extracts narrator text from `project.script`
3. User reviews/edits `voiceoverScript`, clicks "Approve"
4. System generates voiceover audio (ElevenLabs / OpenAI TTS)
5. System generates music track (Suno API, instrumental)
6. System auto-generates `montagePlan` (LLM + heuristics)
7. System renders low-res preview (720p, fast)
8. User reviews preview; if changes needed, describes them in text
9. LLM updates `montagePlan` based on feedback (loop back to step 7)
10. User approves -> system renders final 4K (3840x2160, 30fps, H.264+AAC)

## 5. Data Model Extensions

### New fields on `Project` (server + frontend types)

```typescript
// -- Voiceover --
voiceoverScript?: string          // narrator text (editable, versioned)
voiceoverScriptApproved?: boolean // locked after approval
voiceoverFile?: string            // path to generated audio (e.g. "montage/voiceover.mp3")
voiceoverProvider?: string        // 'elevenlabs' | 'openai'
voiceoverVoiceId?: string         // provider-specific voice identifier

// -- Music --
musicFile?: string                // path to generated music (e.g. "montage/music.mp3")
musicPrompt?: string              // Suno generation prompt
musicProvider?: string            // 'suno'

// -- Montage plan --
montagePlan?: MontagePlan         // full declarative plan (see below)

// -- Renders --
renders?: RenderJob[]             // history of render attempts
```

### MontagePlan schema

```typescript
interface MontagePlan {
  version: number                  // schema version, currently 1
  format: {
    width: number                  // 3840
    height: number                 // 2160
    fps: number                    // 30
  }
  timeline: TimelineEntry[]
  transitions: TransitionEntry[]
  motionGraphics: {
    intro?: IntroCard
    lowerThirds: LowerThird[]
    outro?: OutroCard
  }
  audio: {
    voiceover: { file: string; gainDb: number }
    music: {
      file: string
      gainDb: number               // e.g. -18
      duckingDb: number            // e.g. -10 (additional drop under VO)
      duckFadeMs: number           // e.g. 500
    }
  }
  style: MontageStyle
}

interface TimelineEntry {
  shotId: string
  clipFile: string                 // resolved path to normalized clip
  startSec: number                 // absolute position in timeline
  durationSec: number              // how long this clip plays
  trimStartSec?: number            // optional: trim from beginning of source
  trimEndSec?: number              // optional: trim from end of source
  motionEffect?: 'ken_burns' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'  // for image-only shots
}

interface TransitionEntry {
  fromShotId: string
  toShotId: string
  type: 'cut' | 'fade' | 'crossfade' | 'slide_left' | 'slide_right' | 'zoom_blur' | 'wipe'
  durationSec: number              // overlap duration
  easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
}

interface IntroCard {
  title: string                    // e.g. project name / complex name
  subtitle?: string                // e.g. slogan
  durationSec: number              // 2-3s
  animation: 'fade_in' | 'slide_up' | 'typewriter'
}

interface LowerThird {
  shotId: string                   // which shot to overlay on
  text: string                     // e.g. "Вид с 18 этажа"
  position: 'bottom_left' | 'bottom_center' | 'bottom_right'
  appearAtSec: number              // relative to clip start
  durationSec: number
}

interface OutroCard {
  title: string                    // e.g. CTA text
  phone?: string
  website?: string
  logoFile?: string                // path to logo image
  durationSec: number              // 3-4s
  animation: 'fade_in' | 'slide_up'
}

interface MontageStyle {
  preset: 'premium' | 'calm' | 'dynamic' | 'custom'
  fontFamily: string               // e.g. "Montserrat"
  primaryColor: string             // hex
  secondaryColor: string           // hex
  textColor: string                // hex
}

interface RenderJob {
  id: string
  createdAt: string
  quality: 'preview' | 'final'
  resolution: string               // "1280x720" | "3840x2160"
  status: 'queued' | 'rendering' | 'done' | 'failed'
  progress?: number                // 0-100
  outputFile?: string              // path to rendered mp4
  durationSec?: number             // actual duration of rendered video
  errorMessage?: string
  logFile?: string                 // path to ffmpeg/remotion log
}
```

### GlobalSettings extensions

```typescript
// New fields in GlobalSettings / AppSettings
defaultVoiceoverProvider?: string     // 'elevenlabs' | 'openai'
defaultVoiceoverVoiceId?: string      // e.g. 'pNInz6obpgDQGcFmaJgB'
elevenLabsApiKey?: string
openaiTtsApiKey?: string              // may reuse openRouterApiKey if compatible
sunoApiKey?: string
defaultMusicStyle?: string            // e.g. 'cinematic instrumental'
defaultMontagePreset?: string         // 'premium' | 'calm' | 'dynamic'
remotionConcurrency?: number          // render threads, default 2
```

## 6. New API Endpoints

All under `/api/projects/:id/montage/`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/montage/generate-vo-script` | LLM extracts narrator text from `project.script` |
| `PUT`  | `/montage/vo-script` | User saves/edits voiceover script |
| `POST` | `/montage/approve-vo-script` | Lock voiceover script |
| `POST` | `/montage/generate-voiceover` | Call TTS provider, save audio |
| `POST` | `/montage/generate-music` | Call Suno, save audio |
| `POST` | `/montage/generate-plan` | LLM + heuristics -> montagePlan |
| `PUT`  | `/montage/plan` | User directly edits plan (advanced) |
| `POST` | `/montage/refine-plan` | User sends text feedback, LLM updates plan |
| `POST` | `/montage/render` | Start render job (body: `{ quality: 'preview' \| 'final' }`) |
| `GET`  | `/montage/render/:jobId` | Poll render job status |
| `GET`  | `/montage/render/:jobId/download` | Stream rendered mp4 |

## 7. Frontend: New MontageView Component

New component: `src/components/MontageView.tsx`

### Sections
1. **Voiceover Script** -- text editor, "Generate" button, "Approve" button, status badge
2. **Audio Tracks** -- "Generate voiceover" + "Generate music" buttons, playback controls, waveform preview
3. **Montage Plan** -- visual timeline (horizontal bar per shot), transition indicators, motion graphics markers
4. **Preview** -- embedded video player for 720p preview
5. **Feedback** -- text input for natural-language edit requests + "Refine plan" button
6. **Render** -- "Render final 4K" button, progress bar, download link

### Navigation
- New sidebar item "Montage" (after "Export")
- Enabled only when >= 1 shot has status `approved`
- `PipelineStage` updated to include montage stages

## 8. Remotion Setup

### Structure (new directory)
```
server/remotion/
  src/
    Root.tsx                   # Remotion entry, reads montagePlan
    compositions/
      MontageComposition.tsx   # Main composition
    components/
      VideoClip.tsx            # Single shot clip with optional trim/motion
      Transition.tsx           # Transition between clips (fade/crossfade/etc)
      Intro.tsx                # Branded intro card
      LowerThird.tsx           # Lower-third text overlay
      Outro.tsx                # CTA end card
      AudioMixer.tsx           # VO + music + ducking logic
    lib/
      plan-reader.ts           # Parse montagePlan JSON -> Remotion sequences
      normalize.ts             # FFmpeg clip normalization (fps/codec/res)
  remotion.config.ts
  package.json                 # Separate package for Remotion deps
```

### Key dependencies
- `remotion`, `@remotion/cli`, `@remotion/renderer`
- `@remotion/media-utils` (audio duration probing)
- Chromium (bundled via `@remotion/renderer` or system)

### Render worker
- Runs as a child process spawned from Express backend
- Uses `renderMedia()` from `@remotion/renderer`
- Preview: 1280x720, crf 28, fast preset
- Final: 3840x2160, crf 18, slow preset
- Progress reported via callback -> stored in `RenderJob.progress`

## 9. Clip Normalization (FFmpeg pre-step)

Before Remotion render, normalize all approved shot clips:

```bash
ffmpeg -i input.mp4 \
  -vf "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset medium -crf 18 \
  -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart \
  normalized/{shotId}.mp4
```

For shots without video (image-only fallback):
```bash
ffmpeg -loop 1 -i best_image.jpg -t {duration} \
  -vf "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.001,1.05)':d={fps*duration}:s=3840x2160" \
  -c:v libx264 -preset medium -crf 18 \
  -movflags +faststart \
  normalized/{shotId}.mp4
```

Output directory: `data/projects/{projectId}/montage/normalized/`

## 10. Voiceover Script Generation

### LLM prompt (system)
```
You are a professional narrator script writer for premium real estate video ads.

Given the full production script (which contains camera directions, shot descriptions,
and technical prompts), extract ONLY the narrator's spoken text.

Rules:
- Write in Russian
- Remove all camera/technical directions
- Keep the emotional arc: hook -> reveal -> payoff
- One flowing text, not per-shot fragments
- Target duration: approximately {targetDuration} seconds of speech
- Elegant, premium tone -- selling a lifestyle, not square meters
- No stage directions in brackets
```

### Approval flow
- Generated text saved to `project.voiceoverScript`
- `voiceoverScriptApproved = false` initially
- User edits freely, clicks "Approve" -> `voiceoverScriptApproved = true`
- Once approved, voiceover audio can be generated
- Re-editing resets approval

## 11. Music Generation (Suno)

### Default prompt template
```
Cinematic instrumental background music for a premium real estate advertisement.
Duration: {totalDuration} seconds.
Style: {style} (e.g. "elegant piano with subtle strings", "modern ambient with soft beats")
Mood: sophisticated, aspirational, warm.
No vocals. Suitable for voiceover overlay.
```

### Integration
- Suno API call -> returns audio URL -> download to `montage/music.mp3`
- If Suno unavailable, allow manual upload as fallback
- Store `musicPrompt` for regeneration

## 12. MontagePlan Auto-Generation

### Heuristic rules (deterministic, no LLM needed)
1. Sort shots by `order`
2. Total timeline duration = voiceover audio duration + outro duration
3. Distribute shot durations proportionally to their `shot.duration` values, scaled to fit total
4. Transition selection by scene type heuristic:
   - First shot: no transition (hard cut from intro)
   - Aerial/wide (`scene` contains "дрон", "аэриал", "панорам", "фасад"): `fade` 0.5s
   - Detail/close-up (`scene` contains "деталь", "крупный", "текстур"): `cut` (0s)
   - Interior <-> Exterior switch: `crossfade` 0.8s
   - Default: `crossfade` 0.5s
5. Intro: 3s, title = `project.name`, animation = `fade_in`
6. Outro: 4s, placeholder CTA
7. Lower thirds: on first shot of each "new area" (exterior, interior, lobby, etc.)
8. Audio: voiceover gainDb = 0, music gainDb = -18, duckingDb = -10, duckFadeMs = 500

### LLM refinement (optional, after initial generation)
- LLM receives the generated plan + project context
- Can adjust transition types, lower third text, timing nuances
- Output: updated `montagePlan` JSON

### User feedback loop
- User watches preview, writes: "переходы слишком медленные" or "уберите нижние трети"
- LLM receives current plan + feedback text -> outputs patched plan
- Re-render preview

## 13. Synchronization Strategy

**"Video follows voiceover" (Strategy A)**

1. Generate voiceover audio -> measure exact duration with `ffprobe`
2. Total video duration = VO duration + intro (3s) + outro (4s) + padding (0.5s)
3. Distribute clip durations:
   - Each clip gets proportional share based on `shot.duration / sum(all durations)`
   - Minimum clip duration: 2s (hard floor)
   - If source clip shorter than allocation: slow down slightly (max 0.9x) or hold last frame
   - If source clip longer: trim end
4. Transitions overlap is subtracted from adjacent clip durations

## 14. Implementation Plan (ordered)

### Phase 1: Data model + API skeleton
- [ ] Extend `Project` type (server `storage.ts` + frontend `types/index.ts`)
- [ ] Extend `PipelineStage` type
- [ ] Add `MontagePlan` and related types
- [ ] Create `server/routes/montage.ts` with endpoint stubs
- [ ] Register montage routes in `server/app.ts`
- [ ] Add montage-related fields to project save/load

### Phase 2: Voiceover pipeline
- [ ] Implement `generate-vo-script` endpoint (LLM call)
- [ ] Implement `vo-script` PUT + `approve-vo-script` POST
- [ ] Implement `generate-voiceover` endpoint (ElevenLabs/OpenAI TTS integration)
- [ ] Store audio in `data/projects/{id}/montage/voiceover.mp3`

### Phase 3: Music pipeline
- [ ] Implement `generate-music` endpoint (Suno API integration)
- [ ] Fallback: manual upload endpoint
- [ ] Store audio in `data/projects/{id}/montage/music.mp3`

### Phase 4: Montage plan generation
- [ ] Implement clip normalization with FFmpeg (`server/lib/normalize.ts`)
- [ ] Implement plan auto-generation heuristics (`server/lib/montage-plan.ts`)
- [ ] Implement `generate-plan` endpoint
- [ ] Implement `refine-plan` endpoint (LLM feedback loop)
- [ ] Implement `plan` PUT endpoint (direct edit)

### Phase 5: Remotion render engine
- [ ] Initialize Remotion project in `server/remotion/`
- [ ] Build component library (VideoClip, Transition, Intro, LowerThird, Outro, AudioMixer)
- [ ] Implement `plan-reader.ts` (JSON -> Remotion composition)
- [ ] Implement render worker (child process, progress tracking)
- [ ] Implement `render`, `render/:jobId`, `render/:jobId/download` endpoints

### Phase 6: Frontend MontageView
- [ ] Create `MontageView.tsx` component
- [ ] Add montage store actions to `projectStore.ts`
- [ ] Add montage API methods to `api.ts`
- [ ] Add sidebar navigation item
- [ ] Wire up all sub-flows (VO script, audio gen, plan view, preview, render)

### Phase 7: Polish + testing
- [ ] Error handling for all external API calls (TTS, Suno, render failures)
- [ ] Render job cleanup (delete old preview renders)
- [ ] Integration tests for montage endpoints
- [ ] E2E test: brief -> ... -> approved shots -> montage -> rendered video

## 15. External Dependencies

| Service | Purpose | Key needed | Fallback |
|---------|---------|------------|----------|
| ElevenLabs | Voiceover TTS | `elevenLabsApiKey` | OpenAI TTS |
| OpenAI TTS | Voiceover TTS (alt) | via OpenRouter or direct | Edge TTS (lower quality) |
| Suno | Music generation | `sunoApiKey` | Manual upload |
| Remotion | Video rendering | None (self-hosted) | -- |
| FFmpeg | Clip normalization | None (already installed) | -- |

## 16. Deployment Notes

- Remotion render requires Chromium. In Docker: add `chromium` to container or use `@remotion/renderer` bundled Chromium.
- Render is CPU/memory intensive. For 4K: expect 2-5 min per 30s video on a modern CPU.
- Consider running render in a separate Docker service/container if the main server is resource-constrained.
- `data/projects/{id}/montage/` directory holds all montage artifacts (normalized clips, audio, renders).

## 17. Open Questions (to resolve during implementation)

1. **Suno API access** -- is there an API key available, or should we start with manual music upload only?
2. **ElevenLabs vs OpenAI TTS** -- which provider to prioritize? (affects voice selection UI)
3. **Remotion license** -- free tier is sufficient for self-hosted render; commercial use requires checking their license terms.
4. **Branding assets** -- logo file, default fonts, color palette -- should these be per-project or global settings?

---

**Approval requested.** Once approved, implementation starts with Phase 1 (data model + API skeleton).
