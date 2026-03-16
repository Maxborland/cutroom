# AI Montage Anchors + Video Description First -- Design Document

**Date:** 2026-03-13
**Author:** Codex
**Status:** Approved

---

## 1. Goal

Improve automatic montage generation so the draft timeline follows the meaning of the narrator text, not just the list of approved shots.

The system should:
- extract anchor phrases from `voiceoverScript`
- describe what actually happens in each generated shot video
- match narrator anchors to video descriptions
- build a draft `montagePlan` from those matches

This is a `video description first` design, because generated videos are the strongest source of truth for what can actually be shown at a given narration moment.

## 2. Current State

Today the montage pipeline already supports:
- `voiceoverScript`, approval, normalization and TTS generation
- approved shots and normalized local media
- `montagePlan` generation in `server/lib/montage-plan.ts`
- montage editing and rendering in `server/routes/montage.ts` and `src/components/MontageView.tsx`

The planner was originally shot-order and duration driven. It did not know:
- which phrase in the narrator text should map to which shot
- what is visually present inside a generated video
- which internal moment of a video is the best match for a phrase

## 3. Architecture Decision

Use a two-layer semantic planner:

1. `Narration understanding`
   Extract ordered narrator anchors from the approved `voiceoverScript`.

2. `Visual understanding`
   Generate structured `videoDescription` data for approved shots with video output.

Then match those two layers before generating the timeline.

This keeps the system explainable:
- we can show which anchor was matched to which shot
- we can expose low-confidence matches in UI
- we can later evolve from whole-shot matching to intra-shot trimming without replacing the whole planner

## 4. Data Model Additions

### Project-level

Optional fields:
- `narrationAnchors?: NarrationAnchor[]`
- `anchorMatches?: AnchorMatch[]`
- `anchorCoverageSummary?: AnchorCoverageSummary`

### Shot-level

Optional field:
- `videoDescription?: ShotVideoDescription`

### Shared types

```ts
interface NarrationAnchor {
  id: string
  sourceText: string
  label: string
  order: number
  startSec?: number
  endSec?: number
  intent: 'hook' | 'feature' | 'detail' | 'lifestyle' | 'cta'
}

interface ShotVideoDescription {
  version: number
  summary: string
  tags: string[]
  matchHints: string[]
  moments: Array<{
    id: string
    label: string
    startSec?: number
    endSec?: number
    tags: string[]
    summary: string
  }>
}

interface AnchorMatch {
  anchorId: string
  selectedShotId?: string
  selectedMomentId?: string
  confidence: number
  candidates: Array<{
    shotId: string
    momentId?: string
    confidence: number
    reason: string
  }>
  status: 'matched' | 'weak_match' | 'unmatched'
}
```

## 5. Backend Flow

### A. Extract anchors

Endpoint:
- `POST /api/projects/:id/montage/extract-anchors`

Input:
- approved `voiceoverScript`

Output:
- ordered `narrationAnchors`

### B. Describe videos

Endpoint:
- `POST /api/projects/:id/montage/describe-videos`

Input:
- approved shots with local video files

Output:
- per-shot `videoDescription`

### C. Match anchors to videos

Endpoint:
- `POST /api/projects/:id/montage/match-anchors`

Input:
- `narrationAnchors`
- `videoDescription`
- fallback metadata: `scene`, `imagePrompt`, `videoPrompt`

Output:
- `anchorMatches`
- coverage summary

### D. Generate plan

Endpoint:
- `POST /api/projects/:id/montage/generate-plan`

Behavior:
- if anchors + matches exist, generate anchor-first plan
- if matches are missing, auto-match before plan generation
- if some matches are weak, still build a draft plan but surface them in UI

## 6. Planning Logic

`generateMontagePlan()` evolves from “approved shots distributed over voiceover duration” to:

1. take matched anchors in narrator order
2. choose selected shot for each anchor
3. if a matched moment exists, use it to draft `trimStartSec` / `trimEndSec`
4. fill unmatched gaps with fallback approved shots
5. keep transitions, intro/outro and audio defaults as a safe baseline

## 7. UX Changes

The `План монтажа` step in `src/components/MontageView.tsx` now includes:

- `Семантическая сборка`
- `Описать видео`
- `Извлечь якоря`
- `Сопоставить`
- anchor status badges: `Сильное совпадение`, `Требует проверки`, `Нет совпадения`
- manual shot override select for weak or unmatched anchors
- `Сохранить выбор` before draft generation

Operator guidance:

- run `Описать видео` first
- then `Извлечь якоря`
- then `Сопоставить`
- review weak matches before generating the draft montage

## 8. OpenReel Handoff

Semantic montage decisions are preserved in OpenReel export as hidden metadata:

- bundle-level `semanticSummary`
- clip-level `metadata.cutroomSemantic`

This metadata includes:
- anchor identity and label
- selected moment id
- match status and confidence
- trim suggestions
- optional matching reason

The first iteration intentionally avoids visible markers or UI overlays in OpenReel.

## 9. Non-Goals For First Iteration

Do not include yet:
- frame-perfect subtitle alignment
- word-level narration timing
- beat-synced music editing
- automatic B-roll insertion beyond anchor fallback
- visual marker UI inside OpenReel
