### [🔴 CRITICAL] Type Safety: `RenderJob` contract mismatch breaks production build
**File:** `src/components/MontageView.tsx:616`
**Issue:** `startRender` uses `result.jobId`, but `RenderJob` type only defines `id` (`src/types/index.ts:162`). `npm run build` fails with `TS2339: Property 'jobId' does not exist on type 'RenderJob'`.
**Fix:** Align frontend and API contract: either change backend/typing to return `{ jobId: string }` explicitly, or update UI to use `result.id`. Remove `as RenderJob` cast and type the response precisely.

### [🟠 HIGH] API/Error Handling: Montage actions swallow failures and show no user feedback
**File:** `src/components/MontageView.tsx:166`
**Issue:** Multiple async actions (`generateScript`, `saveScript`, `approveScript`, `generateAudio`, `generateMusic`, `savePrompt`, `uploadMusic`, `generatePlan`, `startRender`) use `try/finally` without `catch`. On API failure, loader stops but user gets no error message/toast.
**Fix:** Add `catch` branches with user-facing feedback (toast/banner), and include error text from `ApiRequestError`. Keep `finally` for loading reset.

### [🟠 HIGH] UX: “Перегенерировать все” button is non-functional
**File:** `src/components/PipelineHeader.tsx:134`
**Issue:** The button is rendered without `onClick`, so it looks actionable but does nothing.
**Fix:** Wire it to a real handler (regenerate images/videos as intended) or remove/disable it until implemented.

### [🟠 HIGH] State Consistency: Optimistic updates have no rollback on failed writes
**File:** `src/stores/projectStore.ts:480`
**Issue:** Methods like `updateShotStatus`, `batchUpdateShotStatus`, `updateBriefText`, `removeBriefAsset`, `deleteShotImage`, etc. optimistically mutate local state and only `console.error` on API failure. UI can diverge from backend state silently.
**Fix:** Add rollback snapshots or guaranteed revalidation (`api.projects.get`) on failure, and surface error via toast/store error.

### [🟡 MEDIUM] Zustand Design: Monolithic store + broad selectors increase unnecessary re-renders
**File:** `src/stores/projectStore.ts:20`
**Issue:** One large store mixes project data, async workflows, UI state, and director state. Components frequently subscribe via `s.activeProject()` (e.g., `src/App.tsx:46`), so many unrelated updates can trigger wide rerenders.
**Fix:** Split into domain slices/stores (project data, generation jobs, UI/session), expose stable selectors, and prefer narrow subscriptions with `shallow` where possible.

### [🟡 MEDIUM] React Hooks: Missing dependencies can cause stale behavior
**File:** `src/components/MontageView.tsx:162`
**Issue:** Effects miss dependencies (`project.voiceoverVoiceId` in `VoiceoverStep`, `onRefresh` in `RenderStep` at line 610), confirmed by eslint warnings.
**Fix:** Include missing deps or stabilize callbacks with `useCallback` in parent and pass stable refs.

### [🟡 MEDIUM] Memoization: Unstable fallback objects defeat `useMemo` benefits
**File:** `src/components/DirectorView.tsx:159`
**Issue:** `const reviews = directorState?.reviews || []` and `latestByStage = ... || {}` create new references each render when undefined, invalidating memo dependencies and causing repeated recompute (eslint exhaustive-deps warnings).
**Fix:** Use stable constants/memoized fallbacks (`useMemo`) or default values at source.

### [🟡 MEDIUM] Concurrency/API: Batch reject runs N parallel mutations without coordination
**File:** `src/components/DirectorView.tsx:516`
**Issue:** Rejecting multiple images loops over IDs and fires `directorApplyFeedback` for each without awaiting. This can race store `directorLoading`, spam requests/toasts, and produce out-of-order state refreshes.
**Fix:** Add a dedicated batch endpoint/action (preferred) or `await Promise.allSettled(...)` with single consolidated refresh + summary toast.

### [🟡 MEDIUM] UX/API: Bulk video generation has no progress/error state and can flood requests
**File:** `src/components/ShotBoard.tsx:143`
**Issue:** `handleBulkGenerateVideos` fires `generateVideoAction` in a loop without await, throttling, disable state, or aggregate feedback.
**Fix:** Reuse `mapWithConcurrency` (like images), add in-progress UI/disable control, and show consolidated success/failure status.

### [🟡 MEDIUM] Accessibility: Non-semantic clickable thumbnail + unlabeled icon controls
**File:** `src/components/BriefEditor.tsx:357`
**Issue:** Thumbnail preview is a clickable `<div>` (mouse-only semantics), and icon-only action buttons (auto-describe/remove) rely on `title` but miss explicit `aria-label` (`:400`, `:416`).
**Fix:** Use `<button type="button">` for interactive thumbnail, add keyboard handlers if needed, and provide explicit `aria-label` on icon buttons.

### [🟡 MEDIUM] Accessibility: Custom combobox/menu lacks full keyboard navigation patterns
**File:** `src/components/ModelSelect.tsx:94`
**Issue:** Combobox opens on ArrowDown/Escape but lacks option navigation (ArrowUp/ArrowDown, Home/End, active descendant management). Similar partial keyboard handling exists in project menu (`src/components/Sidebar.tsx:153`).
**Fix:** Implement full WAI-ARIA combobox/menu keyboard behavior or use an accessible headless component library.

### [🟡 MEDIUM] Error Boundaries: Coverage excludes persistent shell components
**File:** `src/App.tsx:199`
**Issue:** `ErrorBoundary` wraps only `renderView()` (`:210`), while `Sidebar`, `PipelineHeader`, `Toaster`, and `Lightbox` are outside. Crashes there can take down the whole app.
**Fix:** Add boundary layers for app shell + overlay components, and consider route-level boundaries.

### [🟡 MEDIUM] Bundle Size: All major views are eagerly loaded in root bundle
**File:** `src/App.tsx:3`
**Issue:** Heavy screens (Montage, Director, Settings, ShotBoard with DnD/framer-motion) are imported synchronously at app startup.
**Fix:** Use `React.lazy` + `Suspense` for route/view-level code splitting, especially for rarely used tabs.

### [🔵 LOW] Type Safety: Extensive `any` usage bypasses strict TypeScript guarantees
**File:** `src/stores/projectStore.ts:114`
**Issue:** Numerous `catch (e: any)` and `request<any>` (`src/lib/api.ts:232`) reduce static safety despite `strict: true` config.
**Fix:** Prefer `unknown` in catches with narrowing helpers, and define typed API response interfaces instead of `any`.

### [🔵 LOW] CSS/Tailwind Consistency: Raw palette classes bypass design tokens
**File:** `src/components/MontageView.tsx:680`
**Issue:** Uses `border-red-500` / `text-red-400` while most app uses semantic token classes (`rose`, `text-*`, etc.), causing theme inconsistency.
**Fix:** Replace with existing semantic token classes (e.g., `border-rose`, `text-rose`) for design-system consistency.

### [🔵 LOW] React Anti-pattern: Index keys used in dynamic text blocks
**File:** `src/components/ScriptView.tsx:34`
**Issue:** Paragraphs use `key={i}`; when content is edited/reordered, React may reuse DOM nodes incorrectly.
**Fix:** Use stable keys derived from content/hash or structured paragraph IDs.

### [🔵 LOW] Accessibility: Toast close button lacks accessible name
**File:** `src/components/Toaster.tsx:42`
**Issue:** Icon-only close button has no `aria-label`.
**Fix:** Add `aria-label="Закрыть уведомление"` (or localized equivalent).

---

**Findings count by severity:**
- 🔴 CRITICAL: 1
- 🟠 HIGH: 3
- 🟡 MEDIUM: 9
- 🔵 LOW: 4
- ⚪ INFO: 0
