# Semantic Montage One-Click Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert semantic montage planning into an almost one-click workflow with multi-clip semantic blocks, clearer reasoning, and direct OpenReel handoff.

**Architecture:** Keep the current semantic pipeline for descriptions, anchors, and raw matches, then add a planner layer that turns each narration anchor into a semantic block with 1-3 selected segments. Update the montage UI so the primary path assembles the draft automatically, while manual diagnostics become secondary. Preserve planner decisions as metadata in the generated montage plan and OpenReel bundle.

**Tech Stack:** React, TypeScript, Zustand, Express, Vitest, OpenReel export bridge

---

### Task 1: Add planner-facing semantic block types

**Files:**
- Modify: `src/types/index.ts`
- Modify: `server/lib/storage.ts`
- Test: `tests/unit/openreel-exporter.test.ts`

**Step 1: Write the failing test**

Add or extend a unit test in `tests/unit/openreel-exporter.test.ts` that expects semantic block metadata to exist on exported clips and bundle summaries.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: FAIL because semantic block fields do not exist in shared types or exporter output.

**Step 3: Write minimal implementation**

Add shared interfaces for:
- `SemanticBlock`
- `SemanticBlockSegment`
- optional `semanticBlocks?: SemanticBlock[]` on `Project`
- optional semantic block metadata fields needed by `TimelineEntry` or export metadata

Keep the shape small and planner-focused. Do not redesign unrelated montage types.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/index.ts server/lib/storage.ts tests/unit/openreel-exporter.test.ts
git commit -m "feat: add semantic montage block types"
```

### Task 2: Add planner tests for multi-segment block selection

**Files:**
- Modify: `tests/unit/montage-plan.test.ts`
- Modify: `tests/unit/montage-plan.test.ts`

**Step 1: Write the failing test**

Add focused tests that prove:
- one strong candidate remains `solo`
- two strong distinct candidates become `pair` or `split`
- a weak second candidate is rejected
- the planner never emits more than 3 segments for one block

Use existing anchor, match, and shot fixtures where possible.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: FAIL because the current planner only supports one selected shot per anchor.

**Step 3: Write minimal implementation**

Do not change production code yet. Only add the failing planner tests and helper fixtures needed for the new semantic block behavior.

**Step 4: Run test to verify it fails cleanly**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: FAIL with assertion mismatches, not syntax or fixture errors.

**Step 5: Commit**

```bash
git add tests/unit/montage-plan.test.ts
git commit -m "test: define semantic block planner behavior"
```

### Task 3: Implement semantic block builder on the server

**Files:**
- Create: `server/lib/semantic-block-planner.ts`
- Modify: `server/lib/montage-plan.ts`
- Modify: `server/lib/storage.ts`
- Test: `tests/unit/montage-plan.test.ts`

**Step 1: Write the failing test**

Add one more test that asserts the planner emits block-level explanations and selected segment reasons along with the timeline decisions.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: FAIL because the server has no semantic block planner yet.

**Step 3: Write minimal implementation**

Create `server/lib/semantic-block-planner.ts` with functions to:
- convert raw `anchorMatches` into semantic blocks
- choose `solo`, `pair`, `split`, or `cascade`
- suppress duplicate or near-duplicate segments
- cap each block at 3 segments
- produce explanation strings and alternative rejection reasons

Update `server/lib/montage-plan.ts` to:
- call the new semantic block planner
- build `TimelineEntry[]` from `semanticBlocks`
- preserve block metadata for later export

Keep the first pass deterministic and heuristic-driven. Do not add LLM calls here.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/semantic-block-planner.ts server/lib/montage-plan.ts server/lib/storage.ts tests/unit/montage-plan.test.ts
git commit -m "feat: build semantic montage blocks from anchor matches"
```

### Task 4: Support soft block duration allocation

**Files:**
- Modify: `server/lib/semantic-block-planner.ts`
- Modify: `server/lib/montage-plan.ts`
- Test: `tests/unit/montage-plan.test.ts`

**Step 1: Write the failing test**

Add tests that prove block duration is not rigidly locked to exact phrase start and end:
- a short phrase may receive two strong segments
- a long phrase may still use one concise precise segment

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: FAIL because duration still follows the current simple proportional shot allocation.

**Step 3: Write minimal implementation**

Update the planner and plan generator to:
- compute a recommended duration per semantic block
- divide that duration across 1-3 segments
- retain current safety floors for minimum clip duration
- avoid abrupt timing regressions for unmatched fallback clips

Do not introduce beat-sync or word-level timing.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/semantic-block-planner.ts server/lib/montage-plan.ts tests/unit/montage-plan.test.ts
git commit -m "feat: add soft timing for semantic montage blocks"
```

### Task 5: Add one-click semantic assembly endpoint behavior

**Files:**
- Modify: `server/routes/montage.ts`
- Test: `tests/integration/montage-semantic-one-click.test.ts`

**Step 1: Write the failing test**

Create `tests/integration/montage-semantic-one-click.test.ts` covering:
- one request triggers missing semantic prerequisite steps automatically
- partial step failure reports a partial result
- response includes semantic block summary and next action data for the editor handoff

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/integration/montage-semantic-one-click.test.ts`
Expected: FAIL because there is no one-click semantic assembly flow yet.

**Step 3: Write minimal implementation**

In `server/routes/montage.ts`, add or extend a route for one-click assembly that:
- checks approved shots and voiceover availability
- runs video description if required
- runs anchor extraction if required
- runs matching if required
- generates the montage plan
- returns summary data describing blocks, clips, and issues

Reuse existing helper functions where possible instead of duplicating route logic.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/integration/montage-semantic-one-click.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/routes/montage.ts tests/integration/montage-semantic-one-click.test.ts
git commit -m "feat: add one-click semantic montage assembly flow"
```

### Task 6: Preserve semantic block metadata in OpenReel export

**Files:**
- Modify: `server/lib/openreel-exporter.ts`
- Test: `tests/unit/openreel-exporter.test.ts`

**Step 1: Write the failing test**

Add assertions that exported clips carry:
- `semanticBlockId`
- `semanticStrategy`
- explanation or reason summary
- block-level confidence

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: FAIL because the exporter only knows anchor-level semantics today.

**Step 3: Write minimal implementation**

Update the exporter so each clip and bundle include semantic block metadata derived from the generated plan and project semantic blocks.

Keep existing anchor metadata intact for backward compatibility.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/openreel-exporter.ts tests/unit/openreel-exporter.test.ts
git commit -m "feat: export semantic block metadata to openreel"
```

### Task 7: Redesign MontageView around one primary CTA

**Files:**
- Modify: `src/components/MontageView.tsx`
- Modify: `src/lib/api.ts`
- Test: `tests/components/MontageView.test.tsx`

**Step 1: Write the failing test**

Add component tests that expect:
- a primary `Собрать черновик` button
- a secondary `Ручной режим`
- step-by-step progress text during assembly
- success summary with block count and clip count

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: FAIL because the current UI still exposes step-first semantic controls as the default path.

**Step 3: Write minimal implementation**

Update `src/lib/api.ts` with a client method for the new one-click assembly route.

Refactor `src/components/MontageView.tsx` to:
- surface one main assemble CTA
- show progress phases
- keep manual diagnostic actions behind a secondary affordance
- show editor-first success state after assembly

Preserve Russian product text.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MontageView.tsx src/lib/api.ts tests/components/MontageView.test.tsx
git commit -m "feat: make semantic montage assembly one-click in montage view"
```

### Task 8: Add decision explanation panel UI

**Files:**
- Modify: `src/components/MontageView.tsx`
- Modify: `src/types/index.ts`
- Test: `tests/components/MontageView.test.tsx`

**Step 1: Write the failing test**

Add component tests for `Разобрать решения` that expect:
- semantic block cards
- selected strategy labels
- chosen clips and rejected alternatives
- issue badges for weak or partial blocks

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: FAIL because there is no block-level explanation UI yet.

**Step 3: Write minimal implementation**

Extend `MontageView` to render block explanations using the server summary response and project semantic block data.

Keep the layout compact and scannable. Do not add nested heavy controls on the first pass.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MontageView.tsx src/types/index.ts tests/components/MontageView.test.tsx
git commit -m "feat: explain semantic montage decisions in montage view"
```

### Task 9: Add local block correction controls

**Files:**
- Modify: `src/components/MontageView.tsx`
- Modify: `src/lib/api.ts`
- Modify: `server/routes/montage.ts`
- Test: `tests/components/MontageView.test.tsx`
- Test: `tests/integration/montage-semantic-one-click.test.ts`

**Step 1: Write the failing test**

Add tests for local actions such as:
- replace main clip
- add second clip
- remove second clip
- collapse a block to one clip

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts`
Expected: FAIL because block-level local editing actions do not exist.

**Step 3: Write minimal implementation**

Add a narrow route and API method for semantic block adjustments.

Update the montage screen to send block-local edits rather than requiring full raw anchor remapping for every weak decision.

Do not attempt a full timeline editor here. Keep the edits constrained to semantic block composition.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MontageView.tsx src/lib/api.ts server/routes/montage.ts tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts
git commit -m "feat: add local semantic block corrections"
```

### Task 10: Update OpenReel editor route expectations

**Files:**
- Modify: `src/routes/OpenReelEditorPage.tsx`
- Modify: `src/lib/openreel-bridge.ts`
- Test: `tests/components/OpenReelEditorPage.test.tsx`

**Step 1: Write the failing test**

Add a test that expects the OpenReel editor page to receive semantic block summary information for the freshly assembled draft without showing blocking preflight banners.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/OpenReelEditorPage.test.tsx`
Expected: FAIL because the current expectations are still anchored to plan-only metadata.

**Step 3: Write minimal implementation**

Update the editor page and bridge summary types so semantic block summary information can travel cleanly to the editor handoff.

Preserve the current immersive editor layout without reintroducing old summary banners inside the editor canvas area.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/OpenReelEditorPage.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/OpenReelEditorPage.tsx src/lib/openreel-bridge.ts tests/components/OpenReelEditorPage.test.tsx
git commit -m "feat: hand off semantic block summary to openreel editor"
```

### Task 11: Add regression coverage for failures and fallback messaging

**Files:**
- Modify: `tests/components/MontageView.test.tsx`
- Modify: `tests/integration/montage-semantic-one-click.test.ts`
- Modify: `server/routes/montage.ts`

**Step 1: Write the failing test**

Add tests for:
- missing approved shots
- missing voiceover text
- partial video description failures
- partial assembly result messaging

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts`
Expected: FAIL because the new one-click messaging and partial-result states are not fully covered yet.

**Step 3: Write minimal implementation**

Tighten route responses and UI messaging so every failure mode names the failed phase and suggests the next action.

Keep error text concise and in Russian.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/routes/montage.ts tests/components/MontageView.test.tsx tests/integration/montage-semantic-one-click.test.ts
git commit -m "test: cover one-click semantic assembly failures"
```

### Task 12: Run final focused verification

**Files:**
- Modify: none
- Test: `tests/unit/montage-plan.test.ts`
- Test: `tests/unit/openreel-exporter.test.ts`
- Test: `tests/components/MontageView.test.tsx`
- Test: `tests/components/OpenReelEditorPage.test.tsx`
- Test: `tests/integration/montage-semantic-one-click.test.ts`

**Step 1: Run the focused verification suite**

Run: `npm run test -- tests/unit/montage-plan.test.ts tests/unit/openreel-exporter.test.ts tests/components/MontageView.test.tsx tests/components/OpenReelEditorPage.test.tsx tests/integration/montage-semantic-one-click.test.ts`
Expected: PASS

**Step 2: Run the broader montage-related suite**

Run: `npm run test -- tests/unit/montage-vo.test.ts`
Expected: PASS

**Step 3: Review for accidental regressions**

Inspect changed files for:
- English UI copy leaking into product strings
- stale manual-control text
- broken typings between `src/types` and `server/lib/storage`
- duplicate metadata fields in exporter output

**Step 4: Commit**

```bash
git add server/lib/semantic-block-planner.ts server/lib/montage-plan.ts server/lib/openreel-exporter.ts server/routes/montage.ts src/components/MontageView.tsx src/lib/api.ts src/lib/openreel-bridge.ts src/routes/OpenReelEditorPage.tsx src/types/index.ts tests/unit/montage-plan.test.ts tests/unit/openreel-exporter.test.ts tests/components/MontageView.test.tsx tests/components/OpenReelEditorPage.test.tsx tests/integration/montage-semantic-one-click.test.ts
git commit -m "feat: add one-click semantic montage assembly"
```

### Notes For Execution

- Keep user-facing montage text in Russian.
- Do not remove the existing manual semantic actions until the one-click flow is covered by tests.
- Reuse current matcher output; do not replace it with a new LLM dependency.
- Prefer extending current route helpers over duplicating semantic flow logic.
- Preserve backward-compatible anchor metadata in OpenReel export while adding block-level metadata.
