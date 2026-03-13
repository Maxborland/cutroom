# CutRoom — Comprehensive Code Review
**Date:** 2026-02-28  
**Reviewer:** Automated Subagent (Claude)  
**Scope:** `server/`, `src/`, `tests/`, config files  
**Test suite:** 263/264 passing (1 skipped)  
**ESLint errors at time of review:** 190 errors, 9 warnings

---

## Table of Contents
1. [Code Review](#1-code-review)
2. [Tech Debt Review](#2-tech-debt-review)
3. [Project Health Review](#3-project-health-review)
4. [Summary](#4-summary)

---

## 1. CODE REVIEW

### 1.1 Security Vulnerabilities

---

### 🔴 CRITICAL Security: Mojibake UTF-8 encoding in director.ts prompts

**File:** `server/routes/generate/director.ts:440-462, 505-548, 1022-1030`

**Issue:** The file contains double-encoded UTF-8 (mojibake). Russian text like `"Ты рецьюируешь СЦЕНАРИЙ"` appears in the source as `"РўС‹ СЂРµРІСЊСЋРёС€СЊ РЎР¦Р•РќРђР РР™"`. This means every LLM prompt for director review stages (review-script, review-shots, regenerate-script, regenerate-shots) contains garbled text instead of proper Russian. The LLM receives nonsense instructions.

Example (line 440):
```
'РўС‹ СЂРµРІСЊСЋРёС€СЊ РЎР¦Р•РќРђР РР™ СЂРµРєР»Р°РјРЅРѕРіРѕ СЂРѕР»РёРєР°...'
```
Should be:
```
'Ты рецьюируешь СЦЕНАРИЙ рекламного ролика...'
```

The same bug affects the projectStore.ts toast messages (line 370-372) and several inline strings throughout director.ts.

**Suggestion:** Re-save the file with correct UTF-8 encoding. Run: `iconv -f latin1 -t utf8 server/routes/generate/director.ts > director_fixed.ts`. Verify all Russian strings in the file are readable. Add a CI step (`file -i` or `chardet`) to catch encoding regressions. Consider externalizing all prompts to locale files.

---

### 🔴 CRITICAL Security: Missing `shotId` validation allows path traversal

**File:** `server/routes/generate/video.ts:263-267`, `server/routes/generate/image.ts:469-472`

**Issue:** The `shotId` URL parameter is passed directly to `resolveProjectPath(projectId, 'shots', shotId, ...)`. Although `resolveProjectPath` internally calls `resolvePathWithin` which throws on traversal, the `shotId` is **never validated against the project's actual shot list before calling `resolveProjectPath`**. An attacker can try `shot-../../../etc` and the check in `resolvePathWithin` is the only safety net. More importantly, for the image/video `serve` endpoints, the code verifies the project exists but does **not** check that `shotId` is a real shot ID belonging to that project before attempting to build and access the path.

```ts
// server/routes/generate/image.ts:470
filePath = resolveProjectPath(project.id, 'shots', shotId, 'generated', filename);
```

**Suggestion:** Add explicit shotId validation using the project's shot list:
```ts
const SHOT_ID_PATTERN = /^shot-\d{3}$/;
if (!SHOT_ID_PATTERN.test(shotId)) {
  sendApiError(res, 400, 'Invalid shot ID');
  return;
}
const shot = project.shots.find(s => s.id === shotId);
if (!shot) {
  sendApiError(res, 404, 'Shot not found');
  return;
}
```

---

### 🔴 CRITICAL Security: `filename` parameter in serve endpoints not validated against allowlist

**File:** `server/routes/generate/image.ts:459-488`, `server/routes/generate/video.ts:253-283`

**Issue:** The `filename` URL parameter is used to construct file paths with only `resolvePathWithin` as guard. There is no check that the filename is actually in the shot's `generatedImages` or `videoFile` list. A valid project+shotId combination could be used to probe arbitrary filenames within the `generated/` or `video/` directory.

**Suggestion:** After loading the project and shot, verify the requested filename is in the shot's known files:
```ts
const shot = project.shots.find(s => s.id === shotId);
if (!shot) { sendApiError(res, 404, 'Shot not found'); return; }
if (!shot.generatedImages.includes(filename) && filename !== shot.videoFile) {
  sendApiError(res, 403, 'Forbidden'); return;
}
```

---

### 🟠 HIGH Security: Hardcoded `HTTP-Referer` leaks deployment origin

**File:** `server/lib/openrouter.ts:63`

**Issue:** 
```ts
'HTTP-Referer': 'http://localhost:5173',
```
This hardcoded localhost URL is sent as a referer to OpenRouter on every API call. In production this would report a localhost URL to a third-party API, which is inaccurate and could cause issues with OpenRouter's analytics or rate-limiting by origin.

**Suggestion:** Make this configurable via an environment variable with a sensible default:
```ts
'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
```

---

### 🟠 HIGH Security: No file upload size limits

**File:** `server/routes/assets.ts` (multer config), `server/routes/shots.ts`

**Issue:** The `multer` configuration for asset and video uploads does not set `limits.fileSize`. An attacker could upload arbitrarily large files, exhausting disk space.

**Suggestion:** Add size limits to multer config:
```ts
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
    cb(null, allowed.includes(file.mimetype));
  }
});
```

---

### 🟠 HIGH Security: API key partially logged to console

**File:** `server/lib/openrouter.ts:40`

**Issue:**
```ts
console.log(`[openrouter] POST ${OPENROUTER_URL} model=${body.model} key=...${apiKey.slice(-4)}`);
```
The last 4 characters of the API key are logged to stdout. While low-risk alone, in production environments logs are often aggregated and retained, potentially exposing key fragments.

**Suggestion:** Remove the key fragment from logs entirely:
```ts
console.log(`[openrouter] POST ${OPENROUTER_URL} model=${body.model}`);
```

---

### 🟠 HIGH Security: `directorState` escapes type system via `as any` cast

**File:** `server/routes/generate/director.ts:69, 84, 340, 343, 369, 406, 812, 922`

**Issue:** `DirectorState` is a fully-defined interface, but it is stored on the `Project` object using `(project as any).directorState`. The `Project` type does not include this field. This pattern bypasses TypeScript's type safety, creates invisible coupling, and can cause `directorState` to be accidentally dropped during project migrations since `normalizeProject` has an explicit `if (!project.directorState)` guard using the same `as any` cast.

**Suggestion:** Add `directorState` to the `Project` interface in `server/lib/storage.ts`:
```ts
export interface Project {
  // ...existing fields...
  directorState?: DirectorState;
}
```
Remove all `(project as any).directorState` casts throughout `director.ts`.

---

### 🟠 HIGH Security: `saveProject()` bypasses the write-serialization queue

**File:** `server/lib/storage.ts:481-488`

**Issue:** `saveProject()` calls `serializeProjectWrite()`, which is correct. However, many routes call `saveProject(project)` on a **stale** project object that was read earlier, rather than using `withProject()`. This means concurrent requests can race:
1. Request A reads project → modifies field X → calls `saveProject`
2. Request B reads project → modifies field Y → calls `saveProject`
3. Request A's write overwrites Request B's changes

The `withProject()` function exists precisely to prevent this, but only ~30% of write paths use it (director routes use it correctly).

**Suggestion:** Audit all routes that call `saveProject()` after a non-serialized read, and convert them to `withProject()`. Key offenders: `generate-image`, `enhance-image`, `generate-video`, `generate-script`, `split-shots`.

---

### 1.2 Architecture Issues

---

### 🟠 HIGH Architecture: `directorState` not part of Project interface (schema drift)

**File:** `server/lib/storage.ts:29-50`, `server/routes/generate/director.ts`

**Issue:** `directorState` is written to project JSON and read back but is not in the `Project` TypeScript interface. `normalizeProject()` initializes it via `(project as any).directorState`. The frontend `src/types/index.ts` DOES include `directorState?: DirectorState` on its `Project` type, creating a discrepancy between frontend and backend types.

**Suggestion:** Add `directorState?: DirectorState` to the backend `Project` interface and remove all `as any` casts.

---

### 🟠 HIGH Architecture: Long-running batch operations block HTTP forever

**File:** `server/routes/generate/image.ts:586-674` (`/enhance-all`), `server/routes/generate/video.ts:285-359` (`/generate-all-videos`)

**Issue:** Both endpoints process shots sequentially in a loop (no parallelism), can take 30+ minutes, and return a single JSON response at the end. If the client disconnects, the server continues processing with no way to abort. There is also no progress feedback to the client.

**Suggestion:** Convert to a job queue pattern:
1. Immediately return a job ID
2. Process shots in the background with configurable concurrency
3. Add a `GET /jobs/:jobId/status` endpoint for polling progress
Alternatively, use Server-Sent Events (SSE) for real-time progress.

---

### 🟡 MEDIUM Architecture: `isExternalMediaRef()` duplicated

**File:** `server/routes/generate/video.ts:19-21`, `server/lib/external-image-cache.ts:15-17`

**Issue:** Two identical implementations of `isExternalMediaRef()` exist. The version in `video.ts` is a local function while `external-image-cache.ts` exports it.

**Suggestion:** Import from `external-image-cache.ts`:
```ts
import { isExternalMediaRef } from '../../lib/external-image-cache.js';
```

---

### 🟡 MEDIUM Architecture: Shot JSON parsing logic duplicated

**File:** `server/routes/generate/script.ts:221-245`, `server/routes/generate/director.ts:1083-1097`

**Issue:** The code to parse LLM-returned shot JSON arrays into `ShotMeta` objects (including field aliasing, clamping, etc.) is copy-pasted identically in both `split-shots` and `director.ts`'s `regenerate-shots` action.

**Suggestion:** Extract to a shared utility `server/lib/shot-parser.ts`:
```ts
export function parseRawShotsFromLLM(rawShots: unknown[]): ShotMeta[]
```

---

### 🟡 MEDIUM Architecture: `mapWithConcurrency` reimplemented locally

**File:** `server/routes/generate/director.ts:314-336`

**Issue:** A generic `mapWithConcurrency` function is reimplemented in `director.ts`. The project already has `src/lib/async-pool.ts` which does the same thing for the frontend.

**Suggestion:** Move `async-pool.ts` to a shared `server/lib/` location or create a shared utility, then use it in `director.ts`.

---

### 🟡 MEDIUM Architecture: `App.tsx` accesses store state directly via `useProjectStore.getState()`

**File:** `src/App.tsx:65, 99`

**Issue:** Several places call `useProjectStore.getState()` inside `useEffect` callbacks to read current state. This circumvents React's reactivity model and can cause stale closures.

```ts
const state = useProjectStore.getState()
```

**Suggestion:** Use proper Zustand selectors or pass the needed state values as dependencies to the effects.

---

### 🟡 MEDIUM Architecture: `normalizeProject` uses untyped `any` everywhere

**File:** `server/lib/storage.ts:336-419`

**Issue:** `normalizeProject(data: any)` uses `(data as any)` and `(shot as any)` to migrate old data formats. This is the main data migration path and has no schema validation (e.g., using Zod). A corrupted project.json could produce a partially-valid `Project` object that causes runtime errors later.

**Suggestion:** Use `zod` or similar for validation:
```ts
const ProjectSchema = z.object({ id: z.string(), name: z.string(), ... });
const parsed = ProjectSchema.safeParse(data);
if (!parsed.success) { /* handle corrupted data */ }
```

---

### 🟡 MEDIUM Architecture: `generate-all-videos` and `enhance-all` re-read project from disk on every iteration

**File:** `server/routes/generate/image.ts:653-660`, `server/routes/generate/video.ts:340-344`

**Issue:** Inside the `for` loop, each shot saves the result by calling `getProject(projectId)` and `saveProject()`. For a project with 15 shots, this means 30 file system reads and 15 writes all going through the write queue sequentially.

**Suggestion:** After all processing is complete, do a single consolidated save. Use `withProject()` to batch updates.

---

### 🟡 MEDIUM Architecture: `VideoClip.tsx` uses string regex to detect image vs video

**File:** `server/remotion/src/components/VideoClip.tsx:20`

**Issue:**
```ts
const isImage = clip.file.match(/\.(jpg|jpeg|png|webp)$/i);
```
The `match()` return value is a `RegExpMatchArray | null`, used directly as a truthy value. This is functional but fragile — it misses `gif`, `avif`, `tiff`, and would silently fall through to the `<Video>` component for unsupported types.

**Suggestion:**
```ts
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const isImage = IMAGE_EXTENSIONS.has(path.extname(clip.file).toLowerCase());
```

---

### 🟡 MEDIUM Architecture: `Root.tsx` default composition has 4K resolution hardcoded

**File:** `server/remotion/src/Root.tsx:14-15`

**Issue:**
```ts
durationInFrames={900} // default, overridden at render time
fps={30}
width={3840}
height={2160}
```
The default 4K resolution means Remotion Studio preview always renders at 4K, making local development extremely slow.

**Suggestion:** Use environment variables or a lower preview resolution for local development.

---

### 1.3 Error Handling Gaps

---

### 🟠 HIGH Error Handling: `regenerate-shots` in director does not handle JSON parse failure

**File:** `server/routes/generate/director.ts:1080-1081`

**Issue:**
```ts
const rawShots = JSON.parse(jsonStr);
if (!Array.isArray(rawShots)) { sendApiError(res, 422, 'LLM response is not an array'); return; }
```
The `JSON.parse()` can throw if the LLM returns invalid JSON, but there is no `try/catch` wrapping this specific parse call in `regenerate-shots`. The outer `try/catch` catches it, but it returns a generic 500 rather than the 422 with the raw response that `split-shots` correctly provides.

**Suggestion:** Wrap with explicit try/catch returning 422 + raw response, matching `split-shots` behavior.

---

### 🟡 MEDIUM Error Handling: Unhandled promise rejections in background void operations

**File:** `server/routes/generate/image.ts:355`, `server/routes/generate/video.ts:185, 345`

**Issue:**
```ts
void cacheExternalImageReference(project.id, shot.id, storedImageRef);
void cacheExternalVideoInBackground(project.id, shotId, videoUrl);
```
These `void`-prefixed background operations swallow all errors (the functions have internal error logging, which is good). However if a crash occurs in these operations and the Node process has no `unhandledRejection` handler (the current `server/index.ts` does not register one), it could crash the server in older Node versions.

**Suggestion:** Add a global unhandled rejection handler in `server/index.ts`:
```ts
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
```

---

### 🟡 MEDIUM Error Handling: `enhance-image` catches source file errors but exposes raw filename in error message

**File:** `server/routes/generate/image.ts:527-529`

**Issue:**
```ts
} catch {
  sendApiError(res, 404, `Source image not found: ${sourceImage}`);
  return;
}
```
`sourceImage` is user-controlled (from `req.body.sourceImage`). Reflecting it back in an error message could expose information about path structures or be used for user enumeration.

**Suggestion:** Return a generic message: `sendApiError(res, 404, 'Source image not found')`.

---

### 🔵 LOW Error Handling: `_next` error handler parameter unused in app.ts

**File:** `server/app.ts:173`

**Issue:** The global error handler's 4th argument `_next` is flagged by ESLint and never called. While the 4-argument signature is required by Express to recognize it as an error handler, `_next` should never be called in a terminal error handler.

**Suggestion:** Add a comment:
```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
```

---

### 1.4 Type Safety Issues

---

### 🟠 HIGH Type Safety: 190 ESLint errors — all `no-explicit-any`

**File:** Multiple files (see lint output)

**Issue:** ESLint reports 190 errors, the majority being `@typescript-eslint/no-explicit-any`. While `strict: true` is set in all tsconfigs, the `any` type defeats TypeScript's safety guarantees. Key offenders:
- `server/lib/replicate-client.ts` — 10 `any` usages
- `server/routes/generate/director.ts` — 14 `any` usages  
- `src/stores/projectStore.ts` — 18 `any` usages
- `server/lib/storage.ts` — 15 `any` usages

**Suggestion:** Work through them systematically. For error handling, use:
```ts
catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
}
```
For API responses, define proper response types. For the store, define typed catch handlers.

---

### 🟡 MEDIUM Type Safety: Frontend `Project.settings` type diverges from backend

**File:** `src/types/index.ts:50-57` vs `server/lib/storage.ts:8-13`

**Issue:** Frontend defines:
```ts
interface ProjectSettings {
  textModel: string; imageModel: string; enhanceModel: string;
  masterPromptScriptwriter: string; masterPromptShotSplitter: string; masterPromptEnhance: string;
}
```
Backend defines:
```ts
interface ProjectSettings {
  scriptwriterPrompt: string; shotSplitterPrompt: string; model: string; temperature: number;
}
```
These are completely different field names. The frontend types are stale/incorrect.

**Suggestion:** Share types between frontend and backend using a `shared/` directory or generate frontend types from the backend schema.

---

### 🟡 MEDIUM Type Safety: `Shot` frontend type missing `selectedImage` field

**File:** `src/types/index.ts:25-38`

**Issue:** The backend `ShotMeta` interface includes `selectedImage: string | null`, but the frontend `Shot` type omits it. This means `selectedImage` is invisible to frontend code, which relies on `enhancedImages` array instead.

**Suggestion:** Add to frontend `Shot` type:
```ts
selectedImage: string | null
```

---

### 🟡 MEDIUM Type Safety: `chatCompletion` called with `as any` to pass vision messages

**File:** `server/routes/generate/image.ts:733`

**Issue:**
```ts
reviewText = await chatCompletion(effective.reviewModel, reviewMessages as any, 0.4);
```
The `chatCompletion` function's `messages` parameter doesn't support the OpenAI vision message format (array content with `image_url`), forcing the cast.

**Suggestion:** Update `ChatMessage` in `openrouter.ts` to properly type vision messages:
```ts
type VisionContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | VisionContentPart[];
}
```

---

### 🟡 MEDIUM Type Safety: `ShotStatus` typed as `string` in backend

**File:** `server/lib/storage.ts:64`

**Issue:** The backend defines `ShotMeta.status` as `string`, not the union `'draft' | 'img_gen' | 'img_review' | 'vid_gen' | 'vid_review' | 'approved'`. The frontend correctly uses `ShotStatus`. The backend exports `VALID_SHOT_STATUSES` and `ShotStatus` type but doesn't use it on `ShotMeta`.

**Suggestion:**
```ts
export interface ShotMeta {
  status: ShotStatus;  // instead of string
  // ...
}
```

---

### 🟡 MEDIUM Type Safety: Server `tsconfig.json` missing strictness flags

**File:** `server/tsconfig.json`

**Issue:** The server tsconfig does not include `noUnusedLocals` or `noUnusedParameters`, which explains why unused imports like `path` in `normalize.ts` and unused variables in `settings.ts` are only caught by ESLint, not `tsc`.

**Suggestion:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

### 1.5 Dead Code / Unused Items

---

### 🔵 LOW Dead Code: Unused imports in multiple files

**Files:**
- `server/lib/normalize.ts:3` — `import path` unused
- `server/remotion/src/lib/plan-reader.ts:5` — `TimelineEntry`, `TransitionEntry`, `LowerThird` imported but unused
- `server/remotion/src/components/VideoClip.tsx:19` — `fps` prop unused
- `src/components/MontageView.tsx:1` — `useCallback` unused, `MontagePlan` unused
- `tests/unit/montage-render.test.ts:12` — `Project` unused, `mockDeleteRenderJob` assigned but unused
- `tests/unit/montage-vo.test.ts:10` — `saveProject` unused
- `tests/integration/montage.test.ts:16` — `Project` unused
- `tests/integration/generate-replicate.test.ts:22` — `_opts` unused
- `server/routes/settings.ts:61-64, 111-114` — 4 legacy variables destructured but prefixed with `_` and flagged

**Suggestion:** Clean up with `eslint --fix` where possible, then manually resolve the rest.

---

### 🔵 LOW Dead Code: `settings.ts` legacy field stripping code

**File:** `server/routes/settings.ts:61-64`

**Issue:**
```ts
const { openRouterApiKey: _legacy, huggingFaceApiKey: _legacyHf, ... } = body;
```
Four legacy fields are destructured into unused variables to strip them from the body. This leaves ESLint warnings and dead code.

**Suggestion:** Use a typed pick utility instead:
```ts
const allowedKeys: (keyof GlobalSettings)[] = ['defaultTextModel', 'falApiKey', ...];
const sanitized = Object.fromEntries(allowedKeys.filter(k => k in body).map(k => [k, body[k]]));
```

---

### 1.6 Code Smells / Naming

---

### 🔵 LOW Code Smell: `package.json` name is `video-pipeline`, not `cutroom`

**File:** `package.json:2`

**Issue:** `"name": "video-pipeline"` — the project is called CutRoom.

**Suggestion:** Update to `"name": "cutroom"`.

---

### 🔵 LOW Code Smell: `Root.tsx` in Remotion violates fast-refresh rules

**File:** `server/remotion/src/Root.tsx:6`

**Issue:** ESLint reports: `Fast refresh only works when a file has exports. Move your component(s) to a separate file`. The `registerRoot()` call and `RemotionRoot` component are in the same file.

**Suggestion:** Move `RemotionRoot` to its own file and import it.

---

### 🔵 LOW Code Smell: `isExternalMediaRef` defined inline in `video.ts` duplicates exported version

Already reported under Architecture. Additionally the inline version is subtly inconsistent — it also checks `data:` URLs as "external", which may not be the right semantic for video files.

---

## 2. TECH DEBT REVIEW

### 2.1 Hardcoded Values

---

### 🟠 HIGH Tech Debt: Massive hardcoded prompt strings in `storage.ts`

**File:** `server/lib/storage.ts:168-242`

**Issue:** `DEFAULT_SETTINGS` contains 200+ line Russian-language prompt strings for scriptwriter and shot-splitter, hardcoded in the TypeScript source. These are domain-specific prompts that a non-developer content team should be able to update.

**Suggestion:** Move default prompts to `server/defaults/prompts/` as `.md` or `.txt` files, loaded at startup. This also makes them Git-diffable as content rather than code changes.

---

### 🟠 HIGH Tech Debt: Hardcoded video dimensions (4K) in montage plan

**File:** `server/lib/montage-plan.ts:208-211`

**Issue:**
```ts
format: {
  width: 3840,
  height: 2160,
  fps: 30,
},
```
The montage plan always generates at 4K 30fps. These should come from project settings or global config.

**Suggestion:** Add `renderWidth`, `renderHeight`, `renderFps` to `GlobalSettings` and read them in `generateMontagePlan()`.

---

### 🟡 MEDIUM Tech Debt: Hardcoded style presets in `montage-plan.ts`

**File:** `server/lib/montage-plan.ts:239-246`

**Issue:**
```ts
style: {
  preset: 'premium',
  fontFamily: 'Montserrat',
  primaryColor: '#1a1a2e',
  secondaryColor: '#e2b44d',
  textColor: '#ffffff',
},
```
The default style is hardcoded. Clients customizing the brand can't change these without code changes.

**Suggestion:** Move to `GlobalSettings.defaultMontagePreset` and a `MontagePresets` registry.

---

### 🟡 MEDIUM Tech Debt: `VIDEO_DOWNLOAD_ATTEMPTS = 5` and timeouts hardcoded

**File:** `server/routes/generate/video.ts:16-17`

**Issue:** Retry/timeout constants are hardcoded at the top of the file. These affect reliability under slow networks and can't be tuned without code changes.

**Suggestion:** Move to `server/lib/config.ts` with `GlobalSettings` overrides.

---

### 🟡 MEDIUM Tech Debt: `DIRECTOR_REVIEW_BATCH_SIZE = 5` hardcoded

**File:** `server/routes/generate/director.ts:21-27`

**Issue:** All director review constants are hardcoded. For projects with 20+ shots, the default batch size of 5 may cause sub-optimal token usage.

**Suggestion:** Expose key constants in settings (batch size, concurrency, max tokens).

---

### 2.2 DRY Violations

---

### 🟡 MEDIUM DRY: Image enhancement logic copy-pasted between `enhance-image` and `enhance-all`

**File:** `server/routes/generate/image.ts:490-584, 586-674`

**Issue:** The enhancement logic (get source image → call OpenRouter → save file → update project) is nearly identical between the single-shot and batch endpoints. Approximately 60 lines of logic are duplicated.

**Suggestion:** Extract `enhanceShotImage(projectId, shotId, options)` as a shared function, similar to how `generateShotImageForProject()` was extracted for image generation.

---

### 🟡 MEDIUM DRY: `toFileUrl()` helper duplicated

**File:** `server/remotion/src/components/VideoClip.tsx:6-10`, `server/remotion/src/components/AudioMixer.tsx:17-22`

**Issue:** The same `toFileUrl()` helper function is copy-pasted in both Remotion component files.

**Suggestion:** Extract to `server/remotion/src/lib/utils.ts` and import.

---

### 2.3 Test Coverage Gaps

---

### 🟠 HIGH Coverage Gap: No tests for security-critical path traversal protection

**File:** `server/lib/file-utils.ts`, `server/routes/generate/image.ts`

**Issue:** `resolvePathWithin()` is the primary defense against path traversal attacks, but there are no tests that verify it correctly rejects `../` sequences in `projectId`, `shotId`, and `filename` parameters from live HTTP routes.

**Suggestion:** Add integration tests:
```ts
it('rejects path traversal in shotId', async () => {
  const res = await request(app).get(`/api/projects/${pid}/shots/../../../etc/passwd/generated/foo`);
  expect(res.status).toBe(400);
});
```

---

### 🟠 HIGH Coverage Gap: No tests for `director.ts` review endpoints

**File:** `tests/integration/director-apply-feedback.test.ts`

**Issue:** `director-apply-feedback.test.ts` tests `apply-feedback` actions but there are **no tests** for the core review endpoints: `POST /director/review-script`, `POST /director/review-shots`, `POST /director/review-images`. These are the most complex functions in the codebase (1122 lines).

**Suggestion:** Add integration tests with mocked `chatCompletion` for each review stage, verifying that the review object is correctly saved and the JSON parsing/verdict normalization works correctly.

---

### 🟡 MEDIUM Coverage Gap: No tests for batch operations (`enhance-all`, `generate-all-videos`)

**Issue:** The batch enhancement and video generation endpoints are completely untested. These are high-value operations that touch every shot in a project.

---

### 🟡 MEDIUM Coverage Gap: No tests for Remotion `plan-reader.ts`

**File:** `server/remotion/src/lib/plan-reader.ts`

**Issue:** `resolvePlan()` does critical frame math (converting seconds to frames, building clip/transition/lowerThird arrays). There are no unit tests for this function. Arithmetic bugs here would produce corrupted video compositions.

**Suggestion:** Unit-test `resolvePlan()` with a sample `MontagePlan` verifying frame counts, transition positions, and audio file resolution.

---

### 🟡 MEDIUM Coverage Gap: No tests for `montage-plan.ts` duration distribution edge cases

**File:** `server/lib/montage-plan.ts`

**Issue:** The duration proportional allocation has edge cases (single shot, shots summing to 0, voiceover duration = 0) that are partially tested but some path branches remain uncovered.

---

### 🔵 LOW Coverage Gap: No E2E tests can run without a live server

**File:** `playwright.config.ts`

**Issue:** The Playwright config points to `localhost:5173` with `webServer` configuration, but the review environment doesn't have the full server running. The E2E test suite (`test:e2e`) is effectively disabled in CI.

---

### 2.4 Missing Error Boundaries (Frontend)

---

### 🟡 MEDIUM Missing Error Boundary: Only one `ErrorBoundary` in the app

**File:** `src/App.tsx:210`

**Issue:** There is a single `<ErrorBoundary>` wrapping all view components. If `Toaster` or `Lightbox` crash, they are outside the boundary. If a view like `DirectorView` crashes, the entire workspace is replaced with the error screen. Per-view error boundaries would allow graceful degradation.

**Suggestion:** Wrap each major view individually:
```tsx
case 'director':
  return <ErrorBoundary key="director"><DirectorView /></ErrorBoundary>;
```

---

### 🟡 MEDIUM Missing Error Boundary: No error boundary around `Sidebar`

**File:** `src/App.tsx:199`

**Issue:** `<Sidebar>` renders outside the `<ErrorBoundary>`. A crash in sidebar (e.g., malformed project data) would bubble to the React root and crash the entire app.

---

### 2.5 Performance Bottlenecks

---

### 🟠 HIGH Performance: `listProjects()` reads all project JSONs on every request

**File:** `server/lib/storage.ts:423-443`

**Issue:** `GET /api/projects` triggers `listProjects()` which reads and parses every `project.json` file on disk sequentially. With 50+ projects each having large `shots[]` arrays with base64 image filenames, this endpoint becomes very slow.

**Suggestion:** Maintain a lightweight project index (`data/projects.index.json`) with only `{id, name, created, updated, stage}` and rebuild it on writes. `listProjects()` reads the index; full data loads only when a specific project is requested.

---

### 🟡 MEDIUM Performance: DirectorView `useMemo` deps create new arrays on every render

**File:** `src/components/DirectorView.tsx:159-160`

**Issue:** ESLint warns (9 warnings total in DirectorView):
```ts
const reviews = directorState?.reviews || []
const latestByStage = directorState?.latestByStage || {}
```
These fallback expressions create new object references on every render, causing downstream `useMemo` hooks to re-compute on every render cycle.

**Suggestion:**
```ts
const reviews = useMemo(() => directorState?.reviews ?? [], [directorState?.reviews])
const latestByStage = useMemo(() => directorState?.latestByStage ?? {}, [directorState?.latestByStage])
```

---

### 🟡 MEDIUM Performance: `MontageView.tsx` missing `useCallback` on `onRefresh`

**File:** `src/components/MontageView.tsx:610`

**Issue:** ESLint warns about missing `onRefresh` in `useEffect` deps. The polling `useEffect` that refreshes render job status doesn't include `onRefresh` in its dependencies, causing a stale closure that may miss updates.

---

### 🟡 MEDIUM Performance: No HTTP caching headers on static media assets

**File:** `server/routes/generate/image.ts:483`, `server/routes/generate/video.ts:278`

**Issue:** `res.sendFile(filePath)` serves generated images and videos without `Cache-Control` headers. Every page load re-fetches all visible images from the server.

**Suggestion:**
```ts
res.sendFile(filePath, {
  headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
});
```
Generated content never changes (files are named with timestamps), so immutable caching is safe.

---

### 2.6 Missing Logging / Monitoring

---

### 🟡 MEDIUM Logging: No structured logging — all `console.log`

**File:** Entire `server/` directory

**Issue:** All logging uses raw `console.log`/`console.error` with string interpolation. There is no log level control, no structured JSON output, no request ID correlation between related log lines.

**Suggestion:** Introduce a lightweight logger like `pino`:
```ts
import pino from 'pino';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
logger.info({ projectId, shotId, model }, 'generate-image start');
```

---

### 🟡 MEDIUM Logging: No request-level logging middleware

**File:** `server/app.ts`

**Issue:** Express has no request logging middleware (like `morgan` or `pino-http`). There is no way to audit which API endpoints were called, response times, or error rates in production.

**Suggestion:**
```ts
import pinoHttp from 'pino-http';
app.use(pinoHttp({ logger }));
```

---

### 🔵 LOW Logging: Generation timing not tracked

**File:** `server/routes/generate/image.ts`, `server/routes/generate/video.ts`

**Issue:** There is no timing measurement for AI generation calls. Slow model responses can't be identified without external APM tooling.

**Suggestion:** Add timing:
```ts
const start = Date.now();
const result = await generateImageMulti(...)
console.log(`[generate-image] done in ${Date.now() - start}ms`);
```

---

### 2.7 Documentation Gaps

---

### 🟡 MEDIUM Docs: No `.env.example` file

**Issue:** The project requires several API keys (`OPENROUTER_API_KEY`, `FAL_API_KEY`, `REPLICATE_API_TOKEN`, `ELEVENLABS_API_KEY`, `SUNO_API_KEY`) but has no `.env.example` or `env.sample` file documenting what environment variables are needed.

**Suggestion:** Create `.env.example`:
```bash
OPENROUTER_API_KEY=sk-or-...
FAL_API_KEY=...
REPLICATE_API_TOKEN=r8_...
ELEVENLABS_API_KEY=...
SUNO_API_KEY=...
PORT=3001
APP_URL=http://localhost:5173
DATA_DIR=./data/projects
```

---

### 🔵 LOW Docs: No JSDoc on public functions in server libs

**File:** `server/lib/generation.ts`, `server/lib/media-utils.ts`, `server/lib/storage.ts`

**Issue:** Core library functions (`generateImageMulti`, `generateVideoFromImage`, `saveImageResult`, `withProject`) have no JSDoc documentation. The storage serialization queue mechanics are particularly non-obvious.

---

---

## 3. PROJECT HEALTH REVIEW

### 3.1 README Accuracy

---

### 🟡 MEDIUM README: Missing setup instructions for API keys

**File:** `README.md`

**Issue:** The README documents the project well at a high level but does not explain how to configure the required API keys. Users must discover the Settings UI to enter them. There is no mention of environment variable alternatives.

**Suggestion:** Add a "Configuration" section documenting that API keys can be set via the Settings UI or via environment variables at startup.

---

### 🔵 LOW README: `package.json` name mismatch

**File:** `README.md`, `package.json`

**Issue:** README says "CutRoom" but `package.json` says `"name": "video-pipeline"`.

---

### 3.2 Package.json Scripts

---

### 🟠 HIGH Scripts: No `typecheck` script

**File:** `package.json`

**Issue:** There is no `npm run typecheck` script. Developers cannot run TypeScript type checking independently from the build. This means type errors are only caught at build time, not as a lightweight pre-commit check.

**Suggestion:**
```json
"typecheck": "tsc -b --noEmit"
```

---

### 🟡 MEDIUM Scripts: `test:e2e` cannot run without a live server

**File:** `package.json`, `playwright.config.ts`

**Issue:** `npm run test:e2e` and `npm run test:all` will fail in CI without a running server. The `playwright.config.ts` has `webServer` configured but the command runs `vite` alone, not the Express API server concurrently.

**Suggestion:** Update the Playwright webServer config to run both frontend and backend:
```ts
webServer: [
  { command: 'npm run server', port: 3001, reuseExistingServer: !process.env.CI },
  { command: 'npm run dev', port: 5173, reuseExistingServer: !process.env.CI },
]
```

---

### 🔵 LOW Scripts: No `clean` script

**Issue:** No way to clean build artifacts (`dist/`, `node_modules/.tmp/`, `.tsbuildinfo`) without manually deleting them.

**Suggestion:** `"clean": "rm -rf dist node_modules/.tmp *.tsbuildinfo"`

---

### 3.3 CI/CD Status

---

### 🟠 HIGH CI: Only CodeQL workflow exists — no test CI

**File:** `.github/workflows/codeql.yml`, `.github/dependabot.yml`

**Issue:** The only GitHub Actions workflow is CodeQL static analysis (which runs weekly + on push). There is no CI workflow that runs `npm test` on PRs or pushes. With 263 tests, this means regressions can be merged without automated detection.

**Suggestion:** Add `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

---

### 🟡 MEDIUM CI: No `npm audit` in CI

**Issue:** Dependabot is configured for npm updates, but there's no `npm audit --audit-level=high` check in CI to catch known vulnerabilities in the dependency tree.

**Suggestion:** Add `npm audit --audit-level=high` as a CI step.

---

### 3.4 License Compliance (AGPL-3.0)

---

### 🟡 MEDIUM License: AGPL-3.0 requires source disclosure for networked use

**File:** `LICENSE`

**Issue:** AGPL-3.0 is correct for an open-source project, but if CutRoom is ever offered as a SaaS or networked service, ALL users who interact with it must be offered the source code under AGPL terms. Key dependencies like `remotion` are licensed under the Remotion license (NOT AGPL-compatible for commercial use without a commercial license). `@fal-ai/client`, `replicate`, and `framer-motion` are MIT-compatible.

**Critical:** `remotion` is under the **Remotion License** which requires purchasing a company license for commercial production use. This may conflict with AGPL-3.0 if the project is used commercially.

**Suggestion:** Review `remotion` licensing for commercial deployments. Consider adding a `NOTICE` file documenting third-party licenses.

---

### ⚪ INFO License: All other dependencies are MIT/ISC/Apache-2.0

**Issue:** Checked key dependencies: `express` (MIT), `react` (MIT), `zustand` (MIT), `sharp` (Apache-2.0), `uuid` (MIT), `archiver` (MIT), `multer` (MIT), `cors` (MIT). These are all compatible with AGPL-3.0.

---

### 3.5 .gitignore Completeness

---

### 🟡 MEDIUM .gitignore: `data/` directory not in `.gitignore`

**File:** `.gitignore`

**Issue:** The `data/projects/` directory is where all project data (JSON, images, videos) is stored. If this directory is not in `.gitignore`, generated images and videos (potentially hundreds of MB) could be accidentally committed.

**Suggestion:** Add to `.gitignore`:
```
data/
*.tmp
server/remotion/dist/
```

---

### 🔵 LOW .gitignore: Remotion build artifacts

**File:** `.gitignore`

**Issue:** The Remotion composition may generate build artifacts in `server/remotion/dist/` that should be ignored.

---

### 3.6 Environment Variable Documentation

---

### 🟠 HIGH Env Vars: No `.env.example` file (repeated from 2.7)

**File:** Root directory

**Issue:** `server/lib/config.ts` reads from a `settings.json` file, not environment variables. However, the server port (`PORT`), data directory (`DATA_DIR`), and potential API keys could/should be configurable via environment variables for containerized deployments. Currently, the only env configuration is whatever `config.ts` reads.

**Suggestion:** Support both settings.json and environment variable overrides (env takes precedence), and document this in `.env.example` and README.

---

### 3.7 Docker / Deployment Readiness

---

### 🔴 CRITICAL Deployment: No Dockerfile or docker-compose

**Issue:** There is no `Dockerfile`, `docker-compose.yml`, or deployment configuration of any kind. `sharp` (a native Node module) requires platform-specific builds. `remotion` requires Chromium for rendering. Deploying this application to a server requires non-trivial system dependencies that are not documented anywhere.

**Suggestion:** Create a `Dockerfile`:
```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y chromium ffmpeg \
    libvips-dev fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "server/index.js"]
```
Also create `docker-compose.yml` for local development with volume mounts for `data/`.

---

### 🟠 HIGH Deployment: `sharp` requires native binaries not documented

**File:** `package.json`

**Issue:** `sharp` is a native Node.js module that requires libvips to be installed on the host. This is not documented anywhere in the README or deployment guide. On a fresh Linux server, `npm install` will try to compile it or download a prebuilt binary, which can fail without the right dependencies.

**Suggestion:** Document system requirements:
```
System requirements:
- Node.js 22+
- FFmpeg (for Remotion rendering)
- Chromium/Chrome (for Remotion rendering)  
- libvips (bundled with sharp on most platforms)
```

---

### 🟠 HIGH Deployment: No process manager configuration

**Issue:** There is no `PM2`, `systemd`, or supervisor configuration for running the server in production. The `server` script uses `tsx watch` which is a development tool and should not be used in production.

**Suggestion:** Add a production start script:
```json
"start": "node --experimental-vm-modules server/index.js"
```
And provide a `pm2.config.js` or `ecosystem.config.js`.

---

### 🟡 MEDIUM Deployment: Render jobs write to local filesystem

**File:** `server/lib/render-worker.ts`

**Issue:** Render output files are written to `data/projects/{id}/renders/`. This means rendered videos cannot survive a server restart in a containerized or stateless deployment without persistent volume mounts.

**Suggestion:** Document that `data/` must be a persistent volume in any deployment. Long-term, consider S3/object storage for rendered outputs.

---

---

## 4. SUMMARY

### Findings by Severity

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 4 |
| 🟠 HIGH | 17 |
| 🟡 MEDIUM | 28 |
| 🔵 LOW | 11 |
| ⚪ INFO | 1 |
| **Total** | **61** |

---

### Top 5 Priorities

1. **🔴 Fix mojibake encoding in `director.ts`** — All LLM prompts for the creative director feature are sending garbled Russian text. The feature is effectively broken. Re-save the file with correct UTF-8 and verify all string literals.

2. **🔴 Add Docker + deployment documentation** — The application cannot be reliably deployed without knowing about `sharp`/`libvips`, Chromium for Remotion, and FFmpeg. Add a `Dockerfile`, document system requirements, and change the production start command from `tsx watch` to a proper runtime.

3. **🟠 Add shot/filename validation in media serve endpoints** — The `generated/:filename` and `video/:filename` endpoints should verify the requested filename is in the shot's known files list. This closes a potential information disclosure vulnerability.

4. **🟠 Fix race condition: convert more routes to `withProject()`** — `generate-image`, `enhance-image`, `generate-video`, `split-shots`, and `generate-script` all read a project, modify it, and call `saveProject()` on the stale object. Under concurrent requests (batch generation), data can be lost. Convert these to use `withProject()` for atomic read-modify-write.

5. **🟠 Add a CI test workflow** — 263 tests exist but no automated CI runs them on PRs. Add `.github/workflows/ci.yml` running `npm run lint && npm test && npm run build`. This prevents regressions from being merged undetected.

---

### Overall Project Health Score: **6.5 / 10**

**Strengths:**
- Solid test suite (263 tests, well-organized into unit/integration/component layers)
- Write queue serialization (`withProject`) prevents most file corruption races — architecture is sound
- Good error propagation from API layer to frontend via `ApiRequestError`
- `resolvePathWithin` path-traversal protection is implemented and used consistently
- TypeScript strict mode enabled everywhere
- Optimistic UI updates with background API sync is a good UX pattern
- Director review system is sophisticated (batch processing, concurrency, fallback parsing)
- Atomic writes via temp file + rename prevents partial JSON corruption
- Well-structured route separation

**Weaknesses:**
- Critical bug: mojibake in `director.ts` breaks the director review feature entirely
- No Dockerfile or deployment documentation for a complex multi-dependency app
- 190 ESLint errors (`no-explicit-any`) indicate type safety is partially bypassed
- No CI workflow (tests never auto-run on PRs)
- No `.env.example`, no `typecheck` script, no `clean` script
- Long-running batch endpoints block HTTP connections indefinitely
- File-based storage will not scale beyond ~100 projects without performance issues
- Frontend and backend type definitions have diverged (different `ProjectSettings` shape)
