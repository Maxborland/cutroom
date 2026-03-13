### [🔴 CRITICAL] Security: SSRF via mutable `shot.videoFile` + `/cache-video`
**File:** `server/routes/generate/video.ts:238`
**Issue:** `/shots/:shotId/cache-video` downloads whatever URL is in `shot.videoFile` when it is external. That field is user-controllable through `PUT /shots/:shotId` (`server/routes/shots.ts:143-151`), where request body is merged without field allowlisting. This enables server-side requests to internal hosts (SSRF), potentially exposing internal services/metadata.
**Fix:** Treat `videoFile` as server-managed only (do not allow client updates in `PUT /shots/:shotId`), enforce strict URL allowlist (scheme + host + port), block private/link-local/loopback ranges after DNS resolution, and require signed provider URLs or stored media IDs instead of arbitrary URLs.

### [🟠 HIGH] Authentication/Authorization: API auth is fail-open by default
**File:** `server/app.ts:71`
**Issue:** `allowMissingApiKey` defaults to `true`, and `server/index.ts:19-24` sets `requireApiAccessKey` to `false` when env is unset. In default deployment, all API routes (except health) become accessible without authentication, including settings updates and expensive generation endpoints.
**Fix:** Make secure default: require API key unless explicitly disabled for local dev. Fail startup in non-dev when key is missing. Add explicit `AUTH_MODE=disabled` for local-only usage.

### [🟠 HIGH] Security: Unrestricted external `sourceImage` can trigger server-side fetch
**File:** `server/routes/generate/image.ts:119`
**Issue:** `sourceImage` from request body is accepted as external URL (`:516-517`). On provider fetch failures, fallback path `toLocalReferenceImage` calls `fetchRemoteMediaBuffer(sourceImage)` (`:130`), which may fetch attacker-controlled URLs. This is another SSRF vector (conditional but reachable).
**Fix:** Validate/allowlist remote media origins, reject private/internal IP ranges (including DNS rebinding checks), limit redirects, and prefer cached server-owned references over arbitrary URLs.

### [🟡 MEDIUM] Input validation: Mass-assignment style updates on project/shot objects
**File:** `server/routes/shots.ts:143`
**Issue:** Shot updates spread `req.body` into persisted objects (`...updates`), and project updates do the same in `server/routes/projects.ts:90-96`. This permits unvalidated fields/types, schema corruption, and unsafe state transitions (e.g., client forcing internal fields).
**Fix:** Introduce request schemas (Zod/Joi/TypeBox), explicit DTOs, and per-route allowlists of mutable fields. Reject unknown fields and enforce type/length/range constraints.

### [🟡 MEDIUM] Large payload/storage abuse: Upload middleware runs before entity existence checks
**File:** `server/routes/assets.ts:84`
**Issue:** `upload.array(...)` executes before verifying project existence (`:86`), and similarly in `server/routes/shots.ts:201` before validating project/shot. Attackers can force disk writes for non-existent resources, creating orphan files and storage pressure.
**Fix:** Pre-validate project/shot before multer processing (as already done in `/montage/upload-music`), or use custom storage that aborts early if entity lookup fails.

### [🟡 MEDIUM] Error handling: Multer errors likely surface as generic 500s
**File:** `server/app.ts:173`
**Issue:** Routes using direct multer middleware (`assets.ts:84`, `shots.ts:201`) do not wrap/translate `MulterError` consistently. Limit/type violations can fall into global handler and return 500 instead of 400/413 with clear error codes.
**Fix:** Add centralized multer-aware error middleware (`instanceof multer.MulterError`) mapping to 400/413, with stable API error codes.

### [🟡 MEDIUM] Validation/Error handling: `feedback.trim()` called without string type-check
**File:** `server/routes/montage.ts:570`
**Issue:** `if (!feedback || !feedback.trim())` assumes `feedback` is string. Non-string payloads can throw and produce 500 instead of a clean 400 validation error.
**Fix:** Validate `typeof feedback === 'string'` first, trim safely, and return structured 400 errors for invalid types.

### [🟡 MEDIUM] API design consistency: Mixed error envelope in `split-shots`
**File:** `server/routes/generate/script.ts:206`
**Issue:** Most routes use `sendApiError(...)`, but `split-shots` returns ad-hoc `res.status(422).json({ error, raw })` (`:206-217`). This breaks response contract consistency and complicates frontend error handling.
**Fix:** Standardize all errors via `sendApiError` with consistent `{ error: { code, message, details } }` shape; include raw model output only behind debug flag.

### [🟡 MEDIUM] Large payload handling: Very permissive global/body limits for all routes
**File:** `server/app.ts:101`
**Issue:** Global `express.json({ limit: '50mb' })` applies to every JSON route, and uploads allow high limits (e.g., 50 files × 50MB in `assets.ts:84` and 500MB video in `shots.ts:79`). This increases memory/disk DoS surface.
**Fix:** Use route-specific parsers with minimal limits (e.g., 256KB for settings/metadata), stricter upload quotas per project/user/time window, and enforce total request size + concurrent upload limits.

### [🔵 LOW] Route organization: Overlapping video file endpoints
**File:** `server/app.ts:164`
**Issue:** `generate/video.ts` defines `GET /shots/:shotId/video/:filename` (`server/routes/generate/video.ts:253`) while `shots.ts` also defines `GET /:shotId/video/:filename` (`server/routes/shots.ts:236`) under `/api/projects/:id/shots`. Mounted order makes one effectively shadow the other, increasing maintenance risk.
**Fix:** Keep a single canonical video-serving route and remove duplicate handler.

### [🔵 LOW] Rate limiting: IP-only in-memory limiter is brittle behind proxies and for costly endpoints
**File:** `server/app.ts:119`
**Issue:** Limiter keys by `req.ip` without explicit proxy trust strategy and applies one flat budget to all `/api` routes. Expensive AI endpoints are not protected by stricter quotas/concurrency caps.
**Fix:** Configure `trust proxy` explicitly, use stable client identity (API key/user), add per-endpoint cost-based limits and concurrency guards for generation routes.

### [⚪ INFO] Configuration hygiene: Settings accepts arbitrary keys without schema
**File:** `server/routes/settings.ts:86`
**Issue:** `updates` is merged directly into settings (`:118-121`) with `[key: string]: unknown` allowed. Unknown/invalid keys can silently persist and create config drift.
**Fix:** Define strict settings schema, whitelist allowed keys, normalize types, and reject unknown properties.

**Findings summary:**
- 🔴 CRITICAL: 1
- 🟠 HIGH: 2
- 🟡 MEDIUM: 6
- 🔵 LOW: 2
- ⚪ INFO: 1
