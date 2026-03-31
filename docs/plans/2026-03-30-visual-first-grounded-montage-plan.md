# Visual-First Grounded Montage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework semantic montage so script blocks are matched through visual grounding, work without voiceover, and report montage fitness through direct, visual, atmospheric, and unresolved outcomes.

**Architecture:** Add a new script-block and grounding layer in front of the current semantic planner. Keep existing video descriptions and moment descriptions as the evidence corpus, but replace literal anchor-first matching with grounded block matching that can choose direct, visual, or atmospheric candidates before generating `semanticBlocks` and timeline clips.

**Tech Stack:** React, TypeScript, Express, Vitest, Zustand, OpenReel export bridge

---

### Task 1: Add shared types for script grounding and match classes

**Files:**
- Modify: `src/types/index.ts`
- Modify: `server/lib/storage.ts`
- Test: `tests/unit/api-montage.test.ts`

**Step 1: Write the failing test**

Extend `tests/unit/api-montage.test.ts` with assertions that the montage API response types can carry:
- grounded script block summaries
- match classes
- richer assembly summary buckets

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/api-montage.test.ts`
Expected: FAIL because the shared types do not contain grounding metadata.

**Step 3: Write minimal implementation**

Add shared interfaces and enums for:
- `ScriptBlock`
- `GroundedScriptBlock`
- `GroundedMatchClass`
- richer assembly summary fields such as `directBlocks`, `visualBlocks`, `atmosphericBlocks`, `unresolvedBlocks`

Keep the first pass small and planner-facing.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/api-montage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/index.ts server/lib/storage.ts tests/unit/api-montage.test.ts
git commit -m "feat: add grounded montage planning types"
```

### Task 2: Define script-block extraction behavior

**Files:**
- Create: `tests/unit/script-blocks.test.ts`
- Create: `server/lib/script-blocks.ts`

**Step 1: Write the failing test**

Create unit tests proving that script blocks:
- come from `voiceoverScript` when available
- fall back to `script` when there is no voiceover text
- preserve order
- assign a stable intent label per block

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/script-blocks.test.ts`
Expected: FAIL because there is no script block extractor yet.

**Step 3: Write minimal implementation**

Create `server/lib/script-blocks.ts` with pure helpers to:
- choose the source text
- split it into ordered blocks
- assign coarse intent labels

Do not call any model here in the first pass.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/script-blocks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/script-blocks.ts tests/unit/script-blocks.test.ts
git commit -m "feat: extract grounded script blocks"
```

### Task 3: Define visual grounding behavior

**Files:**
- Create: `tests/unit/grounded-script-blocks.test.ts`
- Create: `server/lib/grounded-script-blocks.ts`
- Modify: `server/lib/script-blocks.ts`

**Step 1: Write the failing test**

Add tests that prove a block like `я дома` can produce:
- a literal query
- multiple `visualQueries`
- mood queries
- fallback mode `atmospheric_broll`

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/grounded-script-blocks.test.ts`
Expected: FAIL because grounding packets do not exist yet.

**Step 3: Write minimal implementation**

Create `server/lib/grounded-script-blocks.ts` to derive grounding packets from script blocks.

Start with deterministic heuristics:
- query expansion from script terms
- mood aliases
- fallback mode inference from intent

Do not add LLM dependency in v1.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/grounded-script-blocks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/grounded-script-blocks.ts server/lib/script-blocks.ts tests/unit/grounded-script-blocks.test.ts
git commit -m "feat: generate visual grounding packets for script blocks"
```

### Task 4: Replace literal anchor scoring with grounded scoring

**Files:**
- Modify: `server/lib/montage-anchor-matching.ts`
- Modify: `tests/unit/montage-plan.test.ts`
- Modify: `tests/integration/montage.test.ts`

**Step 1: Write the failing test**

Add tests proving that:
- literal matches still score highest when available
- visual matches can beat weak literal matches
- emotional lines can resolve to `atmospheric`
- bad generic shots stay below `visual`

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/montage-plan.test.ts tests/integration/montage.test.ts`
Expected: FAIL because the matcher only uses lexical overlap and `matched/weak/unmatched`.

**Step 3: Write minimal implementation**

Refactor `server/lib/montage-anchor-matching.ts` so matching uses:
- `directScore`
- `visualScore`
- `moodScore`
- `coverageScore`
- `penaltyScore`

Add derived match classes:
- `direct`
- `visual`
- `atmospheric`
- `fallback`
- `unresolved`

Retain backward-compatible fields only if existing callers still need them during migration.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/montage-plan.test.ts tests/integration/montage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/montage-anchor-matching.ts tests/unit/montage-plan.test.ts tests/integration/montage.test.ts
git commit -m "feat: score montage matches with visual grounding"
```

### Task 5: Feed grounded blocks into semantic block planning

**Files:**
- Modify: `server/lib/semantic-block-planner.ts`
- Modify: `server/lib/montage-plan.ts`
- Test: `tests/unit/montage-plan.test.ts`

**Step 1: Write the failing test**

Add planner tests proving that:
- `visual` blocks count as successful assembly
- `atmospheric` blocks can still produce `solo` or `pair`
- unresolved blocks are isolated instead of poisoning the whole plan

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: FAIL because the planner still assumes anchor-level literal confidence.

**Step 3: Write minimal implementation**

Update the planner so it:
- consumes grounded candidates
- stores match class on block explanations
- prefers `mustShow` coverage for the first segment
- uses diversity penalties for follow-up segments
- still caps blocks at 3 segments

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/montage-plan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/semantic-block-planner.ts server/lib/montage-plan.ts tests/unit/montage-plan.test.ts
git commit -m "feat: plan semantic blocks from grounded visual matches"
```

### Task 6: Support script-only one-click assembly

**Files:**
- Modify: `server/routes/montage.ts`
- Modify: `tests/integration/montage.test.ts`

**Step 1: Write the failing test**

Add integration coverage for:
- no `voiceoverScript`, but `script` present
- `assemble-draft` still creates semantic blocks
- summary reflects direct/visual/atmospheric/unresolved buckets

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/integration/montage.test.ts`
Expected: FAIL because assembly still assumes narration-centric semantics.

**Step 3: Write minimal implementation**

Update `server/routes/montage.ts` so `assemble-draft`:
- chooses script text when voiceover text is absent
- runs grounding before matching
- returns richer summary buckets
- stops describing coverage only as `strong matches`

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/integration/montage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/routes/montage.ts tests/integration/montage.test.ts
git commit -m "feat: assemble grounded semantic montage from script"
```

### Task 7: Replace top-level MontageView summary language

**Files:**
- Modify: `src/components/MontageView.tsx`
- Modify: `src/lib/api.ts`
- Test: `tests/components/MontageView.test.tsx`

**Step 1: Write the failing test**

Add UI tests expecting summary text like:
- `подтверждены напрямую`
- `собраны визуально`
- `собраны атмосферно`
- `требуют внимания`

Also assert that the main summary no longer says only `1/7 сильных совпадений`.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: FAIL because the UI still centers `strong matches`.

**Step 3: Write minimal implementation**

Update the montage API client and `MontageView` so the top-level summary:
- reports montage usability buckets
- keeps raw coverage only inside manual diagnostics
- explains why a block was accepted as `visual` or `atmospheric`

Keep all user-facing strings in Russian.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/MontageView.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MontageView.tsx src/lib/api.ts tests/components/MontageView.test.tsx
git commit -m "feat: report grounded montage fitness in the UI"
```

### Task 8: Preserve grounded reasoning in OpenReel export metadata

**Files:**
- Modify: `server/lib/openreel-exporter.ts`
- Modify: `tests/unit/openreel-exporter.test.ts`

**Step 1: Write the failing test**

Add assertions that exported clip metadata includes:
- grounded match class
- block intent
- explanation summary

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: FAIL because exporter metadata does not yet include grounded reasoning.

**Step 3: Write minimal implementation**

Extend exporter metadata generation to preserve:
- block intent
- grounded match class
- summary explanation for why each block was accepted

Do not remove existing semantic block metadata.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/openreel-exporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/openreel-exporter.ts tests/unit/openreel-exporter.test.ts
git commit -m "feat: export grounded montage reasoning"
```

### Task 9: Full focused verification

**Files:**
- Modify: none
- Test: `tests/unit/api-montage.test.ts`
- Test: `tests/unit/script-blocks.test.ts`
- Test: `tests/unit/grounded-script-blocks.test.ts`
- Test: `tests/unit/montage-plan.test.ts`
- Test: `tests/unit/openreel-exporter.test.ts`
- Test: `tests/integration/montage.test.ts`
- Test: `tests/components/MontageView.test.tsx`

**Step 1: Run the full focused test set**

Run:

```bash
npm run test -- tests/unit/api-montage.test.ts tests/unit/script-blocks.test.ts tests/unit/grounded-script-blocks.test.ts tests/unit/montage-plan.test.ts tests/unit/openreel-exporter.test.ts tests/integration/montage.test.ts tests/components/MontageView.test.tsx
```

Expected: PASS

**Step 2: Run production build**

Run: `npm run build`
Expected: successful build; existing chunk-size warning is acceptable unless it regresses materially.

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add visual-first grounded semantic montage"
```
