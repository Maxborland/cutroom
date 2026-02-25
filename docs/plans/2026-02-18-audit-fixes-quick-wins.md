# Audit Fixes - Quick Wins & Medium Effort

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the highest-priority issues from the 2026-02-18 full project audit - P0 bugs, broken tests, DRY violations, and missing validations.

**Architecture:** Minimal targeted fixes to existing files. No new services or architectural refactors in this plan - those are deferred to a separate plan. Each task is self-contained and independently committable.

**Tech Stack:** TypeScript, React, Express.js, Vitest

---

## Task 1: Fix ReviewView Rules of Hooks (P0 Bug)

**Files:**
- Modify: `src/components/ReviewView.tsx:37-60`

The component has `if (!project) return null` at line 51, BEFORE `useCallback` (lines 75-127) and `useEffect` (lines 130-145). This crashes React when `project` changes from null to non-null.

**Step 1: Move early return after all hooks**

Move `if (!project) return null` to AFTER all `useCallback` and `useEffect` definitions (after line 145). The derived values (`allShots`, `filteredShots`, etc.) must safely handle `project === null`. The hooks that reference `project` already guard with `if (!currentShot || !project) return`.

```tsx
export function ReviewView() {
  const project = useProjectStore((s) => s.activeProject())
  const updateShotStatus = useProjectStore((s) => s.updateShotStatus)
  const enhanceImage = useProjectStore((s) => s.enhanceImage)
  const enhancingShotIds = useProjectStore((s) => s.enhancingShotIds)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [direction, setDirection] = useState(0)
  const [approveAnim, setApproveAnim] = useState(false)
  const [aiReview, setAiReview] = useState<string | null>(null)
  const [aiReviewing, setAiReviewing] = useState(false)

  // Derived values - safe when project is null
  const allShots = project
    ? [...project.shots].sort((a, b) => a.order - b.order)
    : []
  const filteredShots = showAll
    ? allShots
    : allShots.filter(
        (s) =>
          (s.status === 'img_review' || s.status === 'vid_review' || s.status === 'approved') &&
          (s.generatedImages.length > 0 || s.enhancedImages.length > 0)
      )

  const currentShot = filteredShots[currentIndex] ?? null
  const enhancing = currentShot ? enhancingShotIds.has(currentShot.id) : false
  const bestImage = currentShot ? getBestImage(currentShot) : null
  const canToggle = currentShot ? hasAlternateImage(currentShot) : false

  const displayImage =
    currentShot && canToggle && showOriginal
      ? {
          filename: currentShot.generatedImages[currentShot.generatedImages.length - 1],
          type: 'generated' as const,
        }
      : bestImage

  // --- All hooks below (no early return before them) ---
  const goNext = useCallback(() => { /* unchanged */ }, [currentIndex, filteredShots.length])
  const goPrev = useCallback(() => { /* unchanged */ }, [currentIndex])
  const handleApprove = useCallback(() => { /* unchanged */ }, [currentShot, project, updateShotStatus])
  const handleReject = useCallback(() => { /* unchanged */ }, [currentShot, project, updateShotStatus])
  const handleEnhance = useCallback(() => { /* unchanged */ }, [currentShot, project, enhanceImage])
  const handleAiReview = useCallback(async () => { /* unchanged */ }, [currentShot, project])

  useEffect(() => { /* keyboard navigation - unchanged */ }, [goNext, goPrev, handleApprove, currentShot?.status])
  useEffect(() => { /* clamp index - unchanged */ }, [filteredShots.length, currentIndex])

  // Early return AFTER all hooks
  if (!project) return null

  // Empty state
  if (filteredShots.length === 0) {
    // ... unchanged
  }

  // ... rest of JSX unchanged
}
```

**Step 2: Run tests**

Run: `npx vitest run tests/ --reporter=verbose 2>&1 | tail -30`
Expected: All existing tests still pass.

**Step 3: Commit**

```bash
git add src/components/ReviewView.tsx
git commit -m "fix: move early return after hooks in ReviewView (Rules of Hooks violation)"
```

---

## Task 2: Add React ErrorBoundary (P0 UX)

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/App.tsx:136`

**Step 1: Create ErrorBoundary component**

```tsx
// src/components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <div className="w-16 h-16 rounded-2xl bg-rose-dim border border-rose/20 flex items-center justify-center">
            <AlertTriangle size={28} className="text-rose" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="font-display font-bold text-lg mb-2">Произошла ошибка</h2>
            <p className="text-sm text-text-muted mb-4">
              {this.state.error?.message || 'Неизвестная ошибка'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

**Step 2: Wrap renderView() in App.tsx**

In `src/App.tsx`, import `ErrorBoundary` and wrap the view rendering:

```tsx
// Add import at top:
import { ErrorBoundary } from './components/ErrorBoundary'

// In the return JSX, wrap {renderView()}:
<ErrorBoundary>
  {renderView()}
</ErrorBoundary>
```

Specifically, change line 136 from `{renderView()}` to `<ErrorBoundary>{renderView()}</ErrorBoundary>`.

**Step 3: Run tests**

Run: `npx vitest run tests/ --reporter=verbose 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/App.tsx
git commit -m "feat: add ErrorBoundary to catch render errors gracefully"
```

---

## Task 3: Validate shot status (P1 Bug)

**Files:**
- Modify: `server/routes/shots.ts:100-106`
- Modify: `server/lib/storage.ts` (add exported VALID_STATUSES)

**Step 1: Add VALID_STATUSES to storage.ts**

At the top of `server/lib/storage.ts`, after the type definitions, add:

```ts
export const VALID_SHOT_STATUSES = ['draft', 'img_gen', 'img_review', 'vid_gen', 'vid_review', 'approved'] as const;
export type ShotStatus = typeof VALID_SHOT_STATUSES[number];
```

**Step 2: Validate in shots.ts**

In `server/routes/shots.ts`, import `VALID_SHOT_STATUSES` from storage and add validation after line 104:

```ts
import {
  getProject,
  saveProject,
  ensureDir,
  resolveProjectPath,
  validateProjectId,
  VALID_SHOT_STATUSES,
} from '../lib/storage.js';

// In the PUT /:shotId/status handler, after the existing check:
    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    if (!VALID_SHOT_STATUSES.includes(status as any)) {
      res.status(400).json({ error: `Invalid status. Allowed: ${VALID_SHOT_STATUSES.join(', ')}` });
      return;
    }
```

**Step 3: Run tests**

Run: `npx vitest run tests/integration/shots.test.ts --reporter=verbose`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add server/lib/storage.ts server/routes/shots.ts
git commit -m "fix: validate shot status against allowed values"
```

---

## Task 4: Fix broken SettingsView tests (P1 Quality)

**Files:**
- Modify: `tests/components/SettingsView.test.tsx`

Two failures:
1. Line 109: replace the broken assertion text with the correct UI label text.
2. Lines 84-87: mock missing `defaultDescribeModel` etc., plus `audioGenModels`

**Step 1: Fix mock data and garbled string**

Replace the entire mock in the `vi.mock` call:

```ts
vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      get: vi.fn().mockResolvedValue({
        openRouterApiKey: '••••1234',
        falApiKey: '',
        replicateApiToken: '',
        defaultDescribeModel: 'openai/gpt-4o',
        defaultScriptModel: 'openai/gpt-4o',
        defaultShotSplitModel: 'openai/gpt-4o',
        defaultReviewModel: 'openai/gpt-4o',
        defaultImageModel: 'openai/gpt-image-1',
        defaultImageGenModel: 'fal/flux-kontext-max',
        defaultVideoGenModel: 'fal/kling-2.1-pro',
        defaultAudioGenModel: '',
        masterPromptScriptwriter: 'System prompt',
        masterPromptShotSplitter: 'Splitter prompt',
        imageAspectRatio: '16:9',
        imageSize: 'auto',
        imageQuality: 'high',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    models: {
      list: vi.fn().mockResolvedValue({
        textModels: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        ],
        imageModels: [
          { id: 'openai/gpt-image-1', name: 'GPT Image 1' },
        ],
        imageGenModels: [
          { id: 'fal/flux-kontext-max', name: 'Flux Kontext Max' },
        ],
        videoGenModels: [
          { id: 'fal/kling-2.1-pro', name: 'Kling 2.1 Pro' },
        ],
        audioGenModels: [],
      }),
    },
  },
}))
```

**Step 2: Fix the `displays model dropdowns` test**

The test at line 74-88 checks for `GPT-4o` and `GPT Image 1`. With 4 model roles using GPT-4o, there will be multiple instances. Just check one exists:

```ts
  it('displays model dropdowns when models are loaded', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('OpenRouter API')).toBeInTheDocument()
    })

    // The ModelSelect components render the selected model name
    await waitFor(() => {
      // GPT-4o appears in multiple dropdowns (describe, script, shotSplit, review)
      expect(screen.getAllByText('GPT-4o').length).toBeGreaterThanOrEqual(1)
    })
  })
```

**Step 3: Fix the garbled string in the save test**

Replace line 109:

```ts
    fireEvent.click(screen.getByText('Сохранить настройки'))
```

**Step 4: Run tests**

Run: `npx vitest run tests/components/SettingsView.test.tsx --reporter=verbose`
Expected: All 6 tests pass.

**Step 5: Commit**

```bash
git add tests/components/SettingsView.test.tsx
git commit -m "fix: update SettingsView test mocks and fix garbled UTF-8 string"
```

---

## Task 5: Remove stale "Higgsfield" label (P1 UX)

**Files:**
- Modify: `src/components/ShotDetail.tsx:256`

**Step 1: Fix label**

Change line 256 from:
```tsx
label="Промпт для видео (Higgsfield)"
```
to:
```tsx
label="Промпт для видео"
```

**Step 2: Commit**

```bash
git add src/components/ShotDetail.tsx
git commit -m "fix: remove stale Higgsfield reference from video prompt label"
```

---

## Task 6: Add confirmation on "Удалить все" assets (P1 UX)

**Files:**
- Modify: `src/components/BriefEditor.tsx:132-137`

**Step 1: Add window.confirm**

Change `handleRemoveAll`:

```ts
  const handleRemoveAll = useCallback(async () => {
    if (!project) return
    if (!window.confirm(`Удалить все ассеты (${project.brief.assets.length})? Это действие необратимо.`)) return
    for (const asset of [...project.brief.assets]) {
      removeBriefAsset(project.id, asset.id)
    }
  }, [project, removeBriefAsset])
```

**Step 2: Commit**

```bash
git add src/components/BriefEditor.tsx
git commit -m "fix: add confirmation dialog before removing all brief assets"
```

---

## Task 7: Extract `saveResultToFile` helper (P0 DRY)

**Files:**
- Create: `server/lib/media-utils.ts`
- Modify: `server/routes/generate.ts` (lines 537-552, 685-700, 775-787)

The identical image-save block is copy-pasted 3 times. Extract to a shared helper.

**Step 1: Create media-utils.ts**

```ts
// server/lib/media-utils.ts
import fs from 'node:fs/promises';

/**
 * Save an image result (data URL, base64, or HTTP URL) to a local file.
 */
export async function saveImageResult(resultUrl: string, filePath: string): Promise<void> {
  if (resultUrl.startsWith('data:')) {
    const base64Data = resultUrl.split(',')[1];
    await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
  } else if (resultUrl.startsWith('http')) {
    const response = await fetch(resultUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);
  } else {
    // Assume raw base64
    await fs.writeFile(filePath, Buffer.from(resultUrl, 'base64'));
  }
}

/**
 * Pick the best source image from a shot: last enhanced > last generated.
 */
export function getBestImageFile(shot: {
  enhancedImages?: string[];
  generatedImages: string[];
}): string | null {
  const enhanced = Array.isArray(shot.enhancedImages) ? shot.enhancedImages : [];
  if (enhanced.length > 0) return enhanced[enhanced.length - 1];
  if (shot.generatedImages.length > 0) return shot.generatedImages[shot.generatedImages.length - 1];
  return null;
}
```

**Step 2: Replace triplicated code in generate.ts**

Import at top of `server/routes/generate.ts`:
```ts
import { saveImageResult, getBestImageFile } from '../lib/media-utils.js';
```

Replace the save block at lines 537-552 with:
```ts
      await saveImageResult(resultUrl, filePath);
```

Replace the save block at lines 685-700 with:
```ts
      await saveImageResult(result, filePath);
```

Replace the save block at lines 775-787 with:
```ts
        await saveImageResult(result, filePath);
```

Also replace the "best image" selection pattern at lines 829-835, 948-953, 1065-1068 with:
```ts
    const sourceFile = getBestImageFile(shot);
```

**Step 3: Run tests**

Run: `npx vitest run tests/ --reporter=verbose 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add server/lib/media-utils.ts server/routes/generate.ts
git commit -m "refactor: extract saveImageResult and getBestImageFile helpers (DRY)"
```

---

## Task 8: Extract settings reader to lib/config.ts (P0 Architecture)

**Files:**
- Create: `server/lib/config.ts`
- Modify: `server/routes/settings.ts` - move `getApiKey`, `getFalApiKey`, `getReplicateToken`, `getGlobalSettings` + reading functions
- Modify: `server/lib/openrouter.ts` - change import from `../routes/settings.js` to `./config.js`
- Modify: `server/lib/generation.ts` - change import from `../routes/settings.js` to `./config.js`
- Modify: `server/routes/models.ts` - change import from `./settings.js` to `../lib/config.js`
- Modify: `server/routes/generate.ts` - change import from `./settings.js` to `../lib/config.js`
- Modify: `server/routes/assets.ts` - change import from `./settings.js` to `../lib/config.js`

This fixes the `lib -> routes` dependency inversion (lib/openrouter.ts and lib/generation.ts importing from routes/settings.ts).

**Step 1: Create server/lib/config.ts**

Move from `server/routes/settings.ts` into `server/lib/config.ts`:
- `SETTINGS_PATH` constant
- `Settings` interface
- `DEFAULT_SETTINGS`
- `ensureSettingsFile()`
- `readSettings()`
- `writeSettings()`
- `maskApiKey()`
- `getApiKey()`
- `getFalApiKey()`
- `getReplicateToken()`
- `getGlobalSettings()`

Export all of them from `config.ts`.

**Step 2: Update settings.ts to import from config.ts**

`server/routes/settings.ts` should import the functions and re-export nothing. The route handlers use `readSettings`, `writeSettings`, `maskApiKey` directly from `../lib/config.js`.

**Step 3: Update all imports**

Replace `from '../routes/settings.js'` -> `from './config.js'` in:
- `server/lib/openrouter.ts`
- `server/lib/generation.ts`

Replace `from './settings.js'` -> `from '../lib/config.js'` in:
- `server/routes/models.ts`
- `server/routes/generate.ts`
- `server/routes/assets.ts`

**Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Run all tests**

Run: `npx vitest run tests/ --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass (import paths updated in test mocks if needed).

**Step 6: Commit**

```bash
git add server/lib/config.ts server/routes/settings.ts server/lib/openrouter.ts server/lib/generation.ts server/routes/models.ts server/routes/generate.ts server/routes/assets.ts
git commit -m "refactor: extract settings reader to lib/config.ts (fix lib->routes dependency inversion)"
```

---

## Task 9: Fix ShotCard zero-based order display (P2 UX)

**Files:**
- Modify: `src/components/ShotCard.tsx:70`

**Step 1: Fix display**

Change from:
```tsx
#{String(shot.order).padStart(2, '0')}
```
to:
```tsx
#{String(shot.order + 1).padStart(2, '0')}
```

This matches `export.ts:42` which already uses `shot.order + 1`.

**Step 2: Commit**

```bash
git add src/components/ShotCard.tsx
git commit -m "fix: display 1-based shot order in ShotCard (was 0-based)"
```

---

## Summary

| Task | Severity | Effort | Description |
|------|----------|--------|-------------|
| 1 | P0 Bug | 10 min | Fix Rules of Hooks in ReviewView |
| 2 | P0 UX | 10 min | Add ErrorBoundary |
| 3 | P1 Bug | 10 min | Validate shot status |
| 4 | P1 Quality | 15 min | Fix broken SettingsView tests |
| 5 | P1 UX | 2 min | Remove Higgsfield label |
| 6 | P1 UX | 5 min | Confirm before delete all assets |
| 7 | P0 DRY | 20 min | Extract saveImageResult + getBestImageFile |
| 8 | P0 Arch | 30 min | Extract lib/config.ts |
| 9 | P2 UX | 2 min | Fix 0-based shot order |
