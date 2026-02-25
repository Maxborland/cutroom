# Full Project Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all P1 audit findings and the highest-impact P2 reliability risks while restoring a green build and stable release flow.

**Architecture:** Implement targeted, test-first fixes in existing frontend and backend modules. Keep behavior changes small and verifiable per task, then do one focused refactor pass for duplicated route logic. Security middleware should be centralized so runtime and integration tests use the same stack.

**Tech Stack:** TypeScript, React 19, Zustand, Express 5, Vitest, Supertest, Playwright, ESLint

---

### Task 1: Restore Build Health and State Consistency

**Files:**
- Modify: `src/stores/projectStore.ts`
- Modify: `src/components/DirectorView.tsx`
- Test: `tests/unit/projectStore.test.ts`

**Step 1: Write the failing test**

```ts
it('resets activeShotId when loadProject switches project', async () => {
  useProjectStore.setState({
    projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })],
    activeProjectId: 'p1',
    activeShotId: 'shot-123',
    loading: false,
    error: null,
  })
  mockedApi.projects.get.mockResolvedValue(makeProject({ id: 'p2' }))

  await useProjectStore.getState().loadProject('p2')
  expect(useProjectStore.getState().activeShotId).toBeNull()
})
```

**Step 2: Run test and build to confirm failures**

Run: `cmd /c npm run test:unit -- tests/unit/projectStore.test.ts`  
Expected: new test FAILS.  

Run: `cmd /c npm run build`  
Expected: FAIL with current TS errors in `projectStore` and `DirectorView`.

**Step 3: Write minimal implementation**

```ts
// src/stores/projectStore.ts (loadProject)
return { projects, activeProjectId: id, activeShotId: null, loading: false }

// src/stores/projectStore.ts (updateBriefText)
const current = get().projects.find((p) => p.id === projectId)
if (current) {
  api.projects.update(projectId, { brief: { ...current.brief, text } }).catch(...)
}

// src/stores/projectStore.ts (updateTargetDuration)
const current = get().projects.find((p) => p.id === projectId)
if (current) {
  api.projects.update(projectId, { brief: { ...current.brief, targetDuration: duration } }).catch(...)
}
```

Remove unused symbols in `src/components/DirectorView.tsx` (`DirectorReviewStage` import and `updateShotStatus` local binding if unused).

**Step 4: Run verification**

Run: `cmd /c npm run test:unit -- tests/unit/projectStore.test.ts`  
Expected: PASS.

Run: `cmd /c npm run build`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/stores/projectStore.ts src/components/DirectorView.tsx tests/unit/projectStore.test.ts
git commit -m "fix: restore build and reset shot selection on project switch"
```

### Task 2: Fix Image Fallback Regression (fal/rep -> OpenRouter)

**Files:**
- Modify: `server/lib/generation-models.ts`
- Modify: `server/routes/generate/image.ts`
- Test: `tests/unit/generation-models.test.ts`

**Step 1: Write failing tests**

```ts
it('maps provider-specific image model to openrouter fallback', () => {
  expect(resolveOpenRouterImageFallbackModel('fal/flux-kontext-max', 'openai/gpt-image-1'))
    .toBe('openai/gpt-image-1')
})

it('keeps openrouter model unchanged', () => {
  expect(resolveOpenRouterImageFallbackModel('openai/gpt-image-1', 'openai/gpt-image-1'))
    .toBe('openai/gpt-image-1')
})
```

**Step 2: Run test to verify it fails**

Run: `cmd /c npm run test:unit -- tests/unit/generation-models.test.ts`  
Expected: FAIL (`resolveOpenRouterImageFallbackModel` missing).

**Step 3: Implement minimal fix**

```ts
// server/lib/generation-models.ts
export function resolveOpenRouterImageFallbackModel(requested: string, fallback: string): string {
  const model = resolveImageModel(requested)
  if (!model) return requested
  return model.provider === 'openrouter' ? requested : fallback
}
```

```ts
// server/routes/generate/image.ts (inside fallback branch)
const openRouterModel = resolveOpenRouterImageFallbackModel(
  modelId,
  effective.imageModel || 'openai/gpt-image-1',
)
resultUrl = await generateImageOpenRouter(openRouterModel, prompt, referenceImages, abortController.signal, imageOptions)
```

**Step 4: Run verification**

Run: `cmd /c npm run test:unit -- tests/unit/generation-models.test.ts`  
Expected: PASS.

Run: `cmd /c npm run test:integration -- tests/integration/models.test.ts`  
Expected: PASS (fallback paths still valid).

**Step 5: Commit**

```bash
git add server/lib/generation-models.ts server/routes/generate/image.ts tests/unit/generation-models.test.ts
git commit -m "fix: use openrouter-compatible model in image fallback flow"
```

### Task 3: Harden API Security Middleware

**Files:**
- Create: `server/app.ts`
- Modify: `server/index.ts`
- Modify: `tests/integration/setup.ts`
- Create: `tests/integration/security.test.ts`

**Step 1: Write failing integration tests**

```ts
it('returns 503 when API key is required but not configured', async () => {
  const app = createApp({ allowMissingApiKey: false, apiAccessKey: '' })
  await request(app).get('/api/projects').expect(503)
})

it('returns 401 without x-api-key when API key is configured', async () => {
  const app = createApp({ allowMissingApiKey: false, apiAccessKey: 'secret' })
  await request(app).get('/api/projects').expect(401)
})
```

**Step 2: Run test to verify it fails**

Run: `cmd /c npm run test:integration -- tests/integration/security.test.ts`  
Expected: FAIL (factory and behavior missing).

**Step 3: Implement middleware centralization + fail-closed behavior**

```ts
// server/app.ts
export function createApp(opts?: { apiAccessKey?: string; allowMissingApiKey?: boolean }) {
  // existing CORS/security headers/rate-limit + routes
  // if key missing and allowMissingApiKey=false => 503 on /api except /health
  // add bounded rate-limit map cleanup for expired entries
  // add final error middleware returning generic JSON
}
```

`server/index.ts` should only boot:

```ts
import { createApp } from './app.js'
const app = createApp({ apiAccessKey: process.env.API_ACCESS_KEY, allowMissingApiKey: false })
app.listen(PORT, ...)
```

`tests/integration/setup.ts` should use `createApp({ allowMissingApiKey: true })`.

**Step 4: Run verification**

Run: `cmd /c npm run test:integration -- tests/integration/security.test.ts`  
Expected: PASS.

Run: `cmd /c npm run test:integration`  
Expected: PASS (existing suite unchanged).

**Step 5: Commit**

```bash
git add server/app.ts server/index.ts tests/integration/setup.ts tests/integration/security.test.ts
git commit -m "fix: centralize api middleware and enforce fail-closed auth behavior"
```

### Task 4: Fix Accessibility P1 Findings

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/ReviewView.tsx`
- Modify: `src/components/ShotDetail.tsx`
- Modify: `src/components/ShotBoard.tsx`
- Test: `tests/components/SettingsView.test.tsx`
- Create: `tests/components/ReviewView.a11y.test.tsx`

**Step 1: Write failing component tests**

```tsx
expect(screen.getByLabelText(/fal\.ai api key/i)).toBeInTheDocument()
expect(screen.getByRole('button', { name: /previous shot/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /open generated image 1/i })).toBeInTheDocument()
```

**Step 2: Run test to verify it fails**

Run: `cmd /c npm run test:components`  
Expected: FAIL (missing labels/roles).

**Step 3: Implement minimal a11y fixes**

```tsx
// SettingsView: pair labels and controls
<label htmlFor="fal-api-key">fal.ai API Key</label>
<input id="fal-api-key" ... />

// ReviewView: name nav controls
<button aria-label="Previous shot" ... />
<button aria-label={`Shot ${i + 1} of ${filteredShots.length}`} ... />

// ShotDetail: clickable image tiles become keyboard-accessible
<button type="button" aria-label={`Open generated image ${i + 1}`} ... onClick={...} />

// ShotBoard: add aria-label to icon-only bulk action buttons
<button aria-label="Generate all images in column" ... />
```

**Step 4: Run verification**

Run: `cmd /c npm run test:components`  
Expected: PASS.

Run: `cmd /c npm run lint`  
Expected: no new a11y or TS lint regressions in touched files.

**Step 5: Commit**

```bash
git add src/components/SettingsView.tsx src/components/ReviewView.tsx src/components/ShotDetail.tsx src/components/ShotBoard.tsx tests/components/SettingsView.test.tsx tests/components/ReviewView.a11y.test.tsx
git commit -m "fix: address priority accessibility gaps in settings, review, and shot ui"
```

### Task 5: Sync Project Stage with Actual Pipeline Navigation

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Test: `tests/components/PipelineHeader.test.tsx`

**Step 1: Write failing test**

```tsx
it('updates project stage when moving to review/export views', async () => {
  // render app/sidebar with active project at stage "shots"
  // click "Ревью"
  // expect store.updateProjectStage(projectId, 'review') called
})
```

**Step 2: Run test to verify it fails**

Run: `cmd /c npm run test:components -- tests/components/PipelineHeader.test.tsx`  
Expected: FAIL (no stage update call).

**Step 3: Implement minimal fix**

```ts
// App.tsx
const updateProjectStage = useProjectStore((s) => s.updateProjectStage)
const project = useProjectStore((s) => s.activeProject())

const handleViewChange = (view: string) => {
  setActiveView(view)
  if (!project) return
  if (view === 'review') updateProjectStage(project.id, 'review')
  if (view === 'export') updateProjectStage(project.id, 'export')
}
```

Pass `handleViewChange` to `Sidebar`.

**Step 4: Run verification**

Run: `cmd /c npm run test:components`  
Expected: PASS.

Run: `cmd /c npm run test:unit -- tests/unit/projectStore.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx tests/components/PipelineHeader.test.tsx
git commit -m "fix: keep pipeline stage in sync with review and export navigation"
```

### Task 6: Close Backend Test Gaps from Audit

**Files:**
- Modify: `tests/integration/projects.test.ts`
- Modify: `tests/integration/shots.test.ts`
- Modify: `tests/integration/setup.ts`

**Step 1: Write failing tests**

```ts
it('updates only brief asset labels without replacing asset metadata', async () => {
  // create project with assets
  // PUT /api/projects/:id with brief.assets label-only payload
  // assert filename/url/uploadedAt unchanged
})

it('rejects batch-status when shotIds is empty', async () => {
  await request(app).put(`/api/projects/${id}/shots/batch-status`).send({ shotIds: [], status: 'draft' }).expect(400)
})
```

**Step 2: Run tests to verify failures**

Run: `cmd /c npm run test:integration -- tests/integration/projects.test.ts tests/integration/shots.test.ts`  
Expected: FAIL on new assertions.

**Step 3: Implement minimal backend fixes (if tests reveal gaps)**

Apply only required corrections in `server/routes/projects.ts` and `server/routes/shots.ts` to satisfy new expected behavior (no broad refactor in this task).

**Step 4: Run verification**

Run: `cmd /c npm run test:integration`  
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/integration/projects.test.ts tests/integration/shots.test.ts server/routes/projects.ts server/routes/shots.ts
git commit -m "test: add integration coverage for asset label merge and shot batch-status validation"
```

### Task 7: Remove Duplicate Route Logic and Write-Amplification Hotspots

**Files:**
- Modify: `server/routes/generate/script.ts`
- Modify: `server/routes/assets.ts`
- Create: `server/lib/pipeline-utils.ts`
- Test: `tests/integration/assets.test.ts`

**Step 1: Write failing regression test for describe-all persistence behavior**

```ts
it('describe-all persists labels and returns complete counters', async () => {
  // seed project with multiple unlabeled assets
  // mock chatCompletion responses
  // expect all labels set and one final consistent saved state
})
```

**Step 2: Run test to verify failure**

Run: `cmd /c npm run test:integration -- tests/integration/assets.test.ts`  
Expected: FAIL with current sequential/save-per-item assumptions.

**Step 3: Implement minimal refactor**

```ts
// server/lib/pipeline-utils.ts
export function buildAssetAngleManifest(assets: BriefAsset[]): string { ... }
```

Use shared `buildAssetAngleManifest` in both script-generation branches, and in `assets.ts /describe-all` update labels in memory then call `saveProject(project)` once after loop.

**Step 4: Run verification**

Run: `cmd /c npm run test:integration -- tests/integration/assets.test.ts tests/integration/projects.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add server/lib/pipeline-utils.ts server/routes/generate/script.ts server/routes/assets.ts tests/integration/assets.test.ts
git commit -m "refactor: deduplicate asset manifest logic and reduce describe-all save amplification"
```

### Task 8: Align Documentation with Implemented Contracts

**Files:**
- Modify: `docs/plans/2026-02-16-cutroom-video-pipeline-design.md`
- Modify: `README.md`

**Step 1: Write doc assertions checklist**

Create checklist in the PR description (or commit notes):
- pipeline stage sequence is accurate
- `ProjectSettings` fields match runtime API contract
- generation provider fallback behavior is documented

**Step 2: Run doc diff review**

Run: `git diff -- docs/plans/2026-02-16-cutroom-video-pipeline-design.md README.md`  
Expected: shows only contract/spec updates.

**Step 3: Implement doc updates**

Update flow line from:

```md
Brief → Script → Shots → Generation → Review → Export
```

to documented actual flow (or update code if product decides to keep Generation stage explicitly). Document current `ProjectSettings` source-of-truth fields from `server/lib/storage.ts` and global settings from `server/lib/config.ts`.

**Step 4: Verify no code regressions**

Run: `cmd /c npm run test`  
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-16-cutroom-video-pipeline-design.md README.md
git commit -m "docs: align pipeline and settings contract with implemented behavior"
```

### Final Verification Gate (after all tasks)

Run in order:

```bash
cmd /c npm run lint
cmd /c npm run build
cmd /c npm run test:all
```

Expected:
- `lint`: 0 errors
- `build`: exit 0
- `test:all`: Vitest pass + Playwright pass (if Playwright environment allows worker spawn)

If Playwright fails due environment restrictions (`EPERM spawn`), document it explicitly and attach Vitest/build evidence.
