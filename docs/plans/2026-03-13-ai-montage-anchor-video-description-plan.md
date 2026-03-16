# AI Montage Anchors + Video Description First Implementation Plan

**Goal:** Build a semantic montage flow:

`voiceoverScript -> narration anchors -> video descriptions -> anchor matches -> draft montage plan`

This plan keeps the feature explainable, operator-reviewable, and safe to evolve toward intra-shot trimming later.

---

## Task 1: Shared semantic montage types

Status: Completed

- added `NarrationAnchor`, `ShotVideoDescription`, `AnchorMatch`, `AnchorCoverageSummary`
- extended shared `Project` and `Shot` types

## Task 2: Video description endpoint

Status: Completed

- added `POST /montage/describe-videos`
- persisted `shot.videoDescription`
- added API client coverage

## Task 3: Narration anchor extraction

Status: Completed

- added `POST /montage/extract-anchors`
- persisted ordered `project.narrationAnchors`

## Task 4: Anchor matching engine

Status: Completed

- added deterministic matcher across `matchHints`, `tags`, `summary`, fallback prompt fields
- added `POST /montage/match-anchors`
- persisted `anchorMatches` and `anchorCoverageSummary`

## Task 5: Anchor-first planner

Status: Completed

- planner now prefers matched anchors in narrator order
- selected moments draft `trimStartSec` / `trimEndSec`
- weak or unmatched anchors fall back to remaining approved shots

## Task 6: Semantic montage review UI

Status: Completed

- added semantic planning panel inside `MontageView`
- added actions:
  - `Описать видео`
  - `Извлечь якоря`
  - `Сопоставить`
- added weak-match review and manual shot overrides
- added `PUT /montage/anchor-matches`

## Task 7: Explainable OpenReel handoff

Status: Completed

- added bundle-level `semanticSummary`
- added clip-level `metadata.cutroomSemantic`
- preserved selected anchor, selected moment, confidence, reason and trim hints in exported OpenReel data

## Task 8: Verification and documentation

Status: Completed with documented baseline caveats

### Focused verification

Green on this branch:

- `npx vitest run tests/unit/montage-plan.test.ts tests/integration/montage.test.ts tests/components/MontageView.test.tsx tests/integration/openreel-route.test.ts tests/unit/openreel-exporter.test.ts`
  Note: the semantic montage and OpenReel assertions pass, but the broader `tests/integration/montage.test.ts` file still contains unrelated render-worker failures in this repo baseline.
- `npm run build`
- `npm run lint`
  Result: no errors, warnings only

### Broader baseline

Current broader baseline is not fully green for reasons outside this feature slice:

- `npm run test` fails on pre-existing render-worker / Remotion import resolution issues
- `npm run test` also reports a missing `yauzl` dependency in `tests/integration/export.test.ts`

These issues should be treated as repository baseline debt, not regressions introduced by semantic montage planning.

## Review Checklist

- semantic planning fields are backward-compatible
- weak matches are reviewable before draft generation
- OpenReel handoff keeps semantic context without changing editor UX
- build remains green
- focused semantic flow tests remain green
