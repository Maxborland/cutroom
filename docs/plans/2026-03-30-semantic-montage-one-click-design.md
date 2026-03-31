# Semantic Montage One-Click Design

**Date:** 2026-03-30
**Author:** Codex
**Status:** Approved

---

## 1. Goal

Turn semantic montage assembly into an almost one-click workflow.

The system should:
- build a semantic draft montage from approved shots and voiceover with one primary action
- explain why specific clips were chosen
- allow one narration phrase to become 1-3 clips when that produces a more natural result
- open the draft directly in OpenReel instead of forcing the user through a manual preflight screen

This design keeps manual controls available, but moves them out of the critical path.

## 2. Current State

Today the montage screen exposes semantic planning as separate technical steps:
- `Описать видео`
- `Извлечь якоря`
- `Сопоставить`
- manual override save
- `Сгенерировать план`

The backend already supports:
- video descriptions per approved shot
- narration anchors extracted from voiceover
- candidate matching with `matched`, `weak_match`, `unmatched`
- repeated use of the same shot across multiple anchors
- optional moment-level selection inside one shot

The main problems are product and UX problems:
- the user must understand the internal pipeline before getting a draft
- coverage numbers are not very informative
- one anchor is modeled as one selected shot, which is too rigid
- the UI explains weak matches poorly and too late
- the user must review matches before getting to the editor

## 3. Product Decisions

Validated decisions for this iteration:
- the default flow should be one primary action that builds the draft and opens the editor
- the system may use 2 or 3 relevant clips for one phrase when that creates a better montage block
- phrase timing should stay soft rather than being locked to the exact phrase start or end
- suspicious decisions should be surfaced after the draft is assembled, not as a blocking pre-check

## 4. Architecture Decision

Keep the existing semantic pipeline, but wrap it in a higher-level planning layer.

The pipeline remains:
1. describe approved videos
2. extract narration anchors
3. match anchors to candidate shots and moments
4. generate montage plan

On top of that, add a new planning concept:

`anchor -> semantic block -> 1-3 timeline segments`

This preserves the current matcher as the source of candidate evidence while allowing the planner to produce more natural editorial decisions.

## 5. UX Flow

### Primary mode

Replace the current step-first semantic workflow with one primary button:

`Собрать черновик`

That action should:
1. describe videos if needed
2. extract anchors if needed
3. compute matches if needed
4. assemble semantic montage blocks
5. generate montage plan
6. open OpenReel

### Secondary mode

Keep the current manual actions, but move them into a secondary `Ручной режим` or `Диагностика` section.

The main path becomes:

`Собрать черновик -> Открыть в редакторе -> Исправить только спорные блоки`

### User-visible progress

While assembling, show stage-specific progress instead of a generic spinner:
- `1/4 Описываем видео`
- `2/4 Извлекаем смысловые блоки`
- `3/4 Подбираем визуальные кандидаты`
- `4/4 Собираем черновой монтаж`

### Post-assembly summary

After success, show:
- `Черновик собран`
- total semantic blocks
- total clips
- how many blocks are confident
- how many require attention

Example:

`Черновик собран: 12 смысловых блоков, 18 клипов, 3 места требуют внимания`

### Explanation panel

Add a compact CTA:

`Показать, почему так собрано`

That panel should show semantic blocks, not raw matcher internals.

For each block:
- phrase text
- selected strategy
- selected clips
- reasons for chosen clips
- rejected alternatives
- confidence

### Local corrections

Allow corrections per block instead of a global manual review gate:
- replace main clip
- add second clip
- remove second clip
- split time evenly
- collapse back to one clip

## 6. Semantic Block Model

The current model is too narrow:

`anchor -> selectedShotId -> selectedMomentId`

Add a new planner-level structure:

`semanticBlocks[]`

Each block represents one editorial decision for one anchor.

### Proposed shape

```ts
interface SemanticBlock {
  id: string
  anchorId: string
  anchorText: string
  anchorLabel: string
  strategy: 'solo' | 'pair' | 'split' | 'cascade'
  confidence: number
  explanation: string[]
  alternatives: Array<{
    shotId: string
    momentId?: string
    confidence: number
    reason: string
    rejectedBecause: string
  }>
  segments: SemanticBlockSegment[]
}

interface SemanticBlockSegment {
  shotId: string
  momentId?: string
  startSec?: number
  endSec?: number
  allocatedDurationSec: number
  weight: number
  reason: string
}
```

The existing `anchorMatches` remain as raw candidate evidence.
`semanticBlocks` become the planner output that explains what actually went into the timeline.

## 7. Matching And Planning Logic

### Candidate handling

The current matcher can keep returning top candidates per anchor.
The planner then decides whether the block should use one, two, or three segments.

### Allowed strategies

- `solo`: one clip
- `pair`: two clips shown sequentially
- `split`: two clips with near-even duration split
- `cascade`: three short clips when they contribute distinct visual value

### Selection rules

Use the top candidate as the primary clip.

Add a second candidate only if:
- it is semantically close enough to the anchor
- it is not just a duplicate of the first candidate
- it adds a distinct visual angle, moment, or scene emphasis

Add a third candidate only if:
- the first two still leave the block visually under-expressed
- the third candidate adds a distinct contribution
- the resulting block remains readable rather than busy

### Soft timing

Do not bind block duration rigidly to the exact phrase boundaries.

Instead, compute a recommended block length from:
- anchor importance in narration
- neighboring anchors
- total voiceover duration
- available strong candidates
- current montage pacing

This allows:
- a short phrase to receive two strong clips if both are meaningful
- a long phrase to remain concise if only one precise moment really works

### Guardrails

- maximum 3 segments per semantic block
- do not place two nearly identical segments in one block
- avoid reusing the exact same moment in adjacent blocks
- if the quality gap between first and second candidate is large, keep `solo`

## 8. MontageView Changes

### Replace the current primary semantic controls

Top-level actions in `План монтажа` should become:
- `Собрать черновик`
- `Пересобрать`
- `Ручной режим`

### Success state

Show:
- `Открыть в редакторе`
- `Разобрать решения`

### Manual diagnostics area

The old actions remain available but no longer dominate the workflow:
- `Описать видео`
- `Извлечь якоря`
- `Сопоставить`
- raw candidate review

### Summary language

Replace pure match coverage language with editorial outcomes:
- semantic blocks count
- clips count
- number of confident blocks
- number of blocks requiring attention

Coverage metrics can still exist, but should be secondary.

## 9. OpenReel Handoff

OpenReel should receive the semantic planning result as metadata, not just a flat timeline.

Each exported clip should preserve:
- anchor identity
- semantic block identity
- strategy type
- selected moment
- reasoning summary
- confidence

This allows future editor features such as:
- highlighting clips that belong to one semantic block
- showing `strategy: pair` or `strategy: split` in inspector metadata
- rebuilding one block without regenerating the whole montage

## 10. Errors And Recovery

The one-click action must explain failures clearly.

### Preconditions

If the project is missing required inputs, show direct instructions:
- no approved shots: `Сначала утвердите хотя бы один шот`
- no voiceover text or audio basis: `Добавьте или сгенерируйте текст озвучки`

### Internal step failures

If one internal phase fails:
- name the failed phase
- report partial success where possible
- keep the user on the montage screen with recovery options

Example:

`Не удалось описать 2 из 9 видео. Черновик собран частично, проверьте проблемные блоки вручную.`

The user should never be forced to guess which sub-step failed.

## 11. Non-Goals For V1

This iteration intentionally does not include:
- word-level narration alignment
- music-beat synchronization
- full semantic block authoring inside OpenReel
- advanced pacing optimization beyond soft block timing
- more than 3 segments per narration anchor

## 12. Testing Strategy

### Unit tests

- strategy selection for `solo`, `pair`, `split`, `cascade`
- second and third segment admission rules
- duplicate suppression
- soft block duration allocation

### Integration tests

- one-click assemble triggers missing prerequisite phases automatically
- strong two-candidate anchor becomes a two-clip block
- weak second candidate falls back to one clip
- partial description failure still reports a partial draft result

### Component tests

- MontageView exposes one primary assemble CTA
- success summary reports semantic blocks and clips
- explanation panel shows reasons and alternatives
- manual diagnostics remain available but secondary

### Export tests

- semantic block metadata is preserved in OpenReel bundle
- clips belonging to the same block can be associated in exported metadata

## 13. Expected Outcome

After this redesign, semantic montage assembly should feel like:
- one primary action
- a draft that already looks editorially intentional
- clear explanation of why clips were chosen
- lightweight local correction instead of pre-assembly paperwork

The result is not a perfect automatic editor.
It is a much more legible and usable semantic drafting system that gets the user into the editor faster with a stronger first cut.
