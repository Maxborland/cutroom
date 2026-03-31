# Visual-First Grounded Montage Design

**Date:** 2026-03-30
**Author:** Codex
**Status:** Approved

---

## 1. Goal

Improve semantic montage so it is driven by the script, grounded in real video evidence, and no longer depends on literal text overlap to look successful.

The system should:
- treat `script` as the primary source of montage meaning
- use `voiceoverScript` when present, but not require it
- assemble blocks even when there is no narration audio
- prefer the best visual expression of a script block over the closest lexical phrase match
- use atmospheric nearest-fit b-roll when a block has no direct visual equivalent
- report montage fitness honestly instead of showing only `strong matches`

## 2. Problem

The current one-click semantic flow improved UX, but it still inherits an old matching assumption:

`text phrase -> lexical anchor match -> shot`

That works for literal phrases like `терраса с видом`, but it breaks down for script language such as:
- `вы впервые чувствуете: я дома`
- `вечером, стоя над водой в золотом свете`
- other emotional or atmospheric lines

As a result:
- the montage can still look usable
- but the coverage summary looks much worse than before
- `weak_match` is overloaded and hides the difference between “bad” and “usable atmospheric fallback”
- the system undervalues shots that visually express the idea without repeating the same words

## 3. Product Decisions

Validated decisions for this design:
- montage is visual-first
- script is primary; voiceover is secondary
- if there is no voiceover, the system should still produce semantic montage from the script
- if a script block has no direct visual proof, the default behavior is atmospheric nearest-fit b-roll
- success should be measured by montage usability, not only by literal direct matches

## 4. New Pipeline

Replace the old mental model:

`script/voiceover -> narration anchors -> lexical match -> semantic blocks`

with:

`script -> script blocks -> visual grounding -> semantic blocks -> timeline`

### Source priority

1. `voiceoverScript`, when present and approved
2. `script`
3. only then fallback to descriptions-only assembly

The montage planner should never require narration audio in order to produce meaning-aware blocks.

## 5. Script Blocks

The first planning layer becomes `scriptBlocks[]`.

Each block represents one narrative unit extracted from the script:
- `sourceText`
- `intent`
- `order`
- optional pacing hints
- optional relationship to neighboring blocks

Example intents:
- `welcome`
- `scale`
- `comfort`
- `lifestyle`
- `prestige`
- `arrival`
- `atmosphere`

These blocks replace the idea that a raw phrase should be matched literally against one shot.

## 6. Visual Grounding Packet

For each script block, build a `grounding packet`.

### Proposed shape

```ts
interface GroundedScriptBlock {
  id: string
  order: number
  sourceText: string
  intent: string
  literalQuery: string
  visualQueries: string[]
  moodQueries: string[]
  mustShow: string[]
  avoid: string[]
  fallbackMode: 'direct_only' | 'visual_ok' | 'atmospheric_broll'
}
```

### Example

For:

`вечером, стоя над водой в золотом свете, вы впервые чувствуете: я дома`

The system might derive:
- `intent`: `comfort + arrival + atmosphere`
- `visualQueries`: `терраса у воды`, `закатный свет`, `панорамный вид`, `уютный жилой интерьер premium`
- `moodQueries`: `спокойствие`, `уют`, `вечерний комфорт`
- `mustShow`: `мягкий свет` or `жилое пространство`
- `avoid`: `паркинг`, `технические фасады`, `пустая инфраструктура`
- `fallbackMode`: `atmospheric_broll`

## 7. Matching Model

Replace one flat confidence value with grounded matching evidence.

### Scoring channels

For each candidate shot or moment, compute:
- `directScore`
- `visualScore`
- `moodScore`
- `coverageScore`
- `penaltyScore`

Then derive:

`groundedScore = direct + visual + mood + coverage - penalties`

### Match classes

Instead of treating almost everything below `strong` as weak, classify block candidates as:
- `direct`
- `visual`
- `atmospheric`
- `fallback`
- `unresolved`

Interpretation:
- `direct`: explicit visual proof of the script block
- `visual`: not literal, but visually accurate enough for confident assembly
- `atmospheric`: acceptable nearest-fit b-roll
- `fallback`: only use when coverage would otherwise collapse
- `unresolved`: no safe montage expression found

## 8. Semantic Block Planning

The existing `semanticBlocks[]` remain the planner output, but their source changes.

New flow:
1. derive `scriptBlocks`
2. ground each block into visual queries
3. match those grounded queries against:
   - `videoDescription.matchHints`
   - `videoDescription.tags`
   - `videoDescription.summary`
   - `videoDescription.moments.tags`
   - `videoDescription.moments.summary`
   - shot-level fallback fields such as `scene`
4. assemble `semanticBlocks`
5. allocate 1-3 clips per block

### Selection rules

- first segment should best satisfy `mustShow`
- second segment may strengthen atmosphere or add a distinct angle
- third segment is allowed only if it adds new visual value
- repeated near-duplicate segments in one block should be penalized
- atmospheric fallback is valid when direct proof is unavailable

## 9. Summary And UI Semantics

The current summary language should no longer be dominated by `strong matches`.

### New top-level summary

Show montage fitness such as:
- `7 смысловых блоков`
- `3 подтверждены напрямую`
- `2 собраны визуально точно`
- `1 собран атмосферно`
- `1 требует внимания`

Primary success message:

`Черновик собран: 7 смысловых блоков, 19 клипов. 6 блоков собраны автоматически, 1 блок требует проверки.`

### Diagnostics

Keep `anchorCoverageSummary` only as a secondary diagnostic metric.

### Decision panel

Per block, show:
- script text
- block intent
- chosen strategy
- match class (`direct`, `visual`, `atmospheric`)
- why these segments were chosen
- why alternatives were rejected

Do not show `weak 0.44` as the main explanation.

## 10. No-Voiceover Behavior

If there is no `voiceoverScript` and no narration audio:
- use `script` as the source for script blocks
- estimate pacing from script length and available footage
- build semantic montage normally

This makes semantic montage independent from TTS readiness.

## 11. Implementation Strategy

### Phase A: Recover perceived quality fast

- replace top summary based on `strong matches`
- introduce new match classes in UI and server summaries
- lower dependency on literal overlap
- allow `visual` blocks to count as successful auto-assembly

### Phase B: Add grounding layer

- introduce `scriptBlocks`
- add grounded query generation
- match grounded queries to descriptions and moments

### Phase C: Improve planner quality

- factor match class into `solo/pair/split/cascade`
- improve role diversity between segments
- handle unresolved blocks through controlled atmospheric fallback

## 12. Testing Focus

Required verification areas:
- script-only assembly without voiceover
- emotional script lines resolved through visual or atmospheric grounding
- honest summary counts for direct/visual/atmospheric/unresolved
- no regression for literal high-confidence matches
- planner still avoids duplicate moments and over-segmentation

## 13. Non-Goals For V1

- full automatic rewrite of the script to fit available footage
- beat-sync against music
- external semantic search outside project data
- learned ranking from past projects
- full editorial AI beyond current heuristic planner scope
