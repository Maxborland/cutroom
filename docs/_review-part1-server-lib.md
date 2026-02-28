### [🟠 HIGH] Security: SSRF via unrestricted remote media fetching
**File:** `server/lib/media-utils.ts:40`
**Issue:** `fetchRemoteMediaBuffer()` accepts arbitrary URLs and fetches them directly (`fetch(url)`), with no hostname/IP restrictions. This can be abused to access internal services (e.g., localhost, link-local, RFC1918 ranges) when attacker-controlled URLs reach this path.
**Fix:** Validate URLs before fetch: allow only `https`, block localhost/private/link-local CIDRs, optionally enforce a trusted domain allowlist/CDN proxy, and reject non-image content types.

### [🟠 HIGH] Security: Unbounded remote download can cause memory DoS
**File:** `server/lib/media-utils.ts:63`
**Issue:** Remote responses are fully loaded into memory via `response.arrayBuffer()` with no max-size enforcement. Large files can exhaust memory and destabilize the server.
**Fix:** Enforce byte limits (via `Content-Length` + streaming byte counter), abort on threshold exceed, and stream to disk instead of buffering entire payloads in RAM.

### [🟠 HIGH] Security: Untrusted SVG text can be used for prompt injection
**File:** `server/lib/reference-media.ts:141`
**Issue:** Uploaded SVG content is converted to text and preserved (`result.svgText`) with only whitespace/comment normalization. If passed to LLM prompts, malicious SVG instructions can steer model behavior.
**Fix:** Treat SVG text as untrusted: disable by default, extract only safe metadata (not free-form text), sanitize aggressively, and wrap in explicit “data-only / do-not-follow-instructions” guardrails before LLM use.

### [🟡 MEDIUM] Missing validation: Division by zero/NaN risk in montage duration allocation
**File:** `server/lib/montage-plan.ts:111`
**Issue:** `totalShotDuration` can be `0` (e.g., invalid shot durations), then proportional allocation divides by zero at line 119, producing invalid durations and corrupted montage plans.
**Fix:** Validate all shot durations (`Number.isFinite(duration) && duration > 0`) before planning; if invalid, fallback to equal duration distribution or reject with a clear validation error.

### [🟡 MEDIUM] Missing validation: ffmpeg receives unchecked duration values
**File:** `server/lib/normalize.ts:111`
**Issue:** `imageToVideo()` uses `durationSec` directly (`-t`, zoompan frame count) without bounds checks. Negative/NaN/extreme durations can break ffmpeg jobs or create runaway processing.
**Fix:** Clamp duration to a safe range (e.g., 0.5–30s), reject non-finite values, and validate shot durations before normalization starts.

### [🟡 MEDIUM] Race condition: render deletion check is non-atomic (TOCTOU)
**File:** `server/lib/render-worker.ts:210`
**Issue:** `deleteRenderJob()` checks job status via `getProject()` and later mutates in `withProject()`. Job state can change between those operations, allowing deletion of a job that has just started rendering.
**Fix:** Move lookup + status check + deletion into a single `withProject()` transaction; optionally add a `deleting`/lock state and cancellation handshake.

### [🟡 MEDIUM] Performance: In-memory reference cache has no eviction policy
**File:** `server/lib/reference-media.ts:44`
**Issue:** `referenceCache` is a process-wide `Map` with unbounded growth across projects/files/options over uptime, causing memory bloat.
**Fix:** Replace with bounded LRU/TTL cache (size cap + expiry), and add cache invalidation on project deletion/update.

### [🔵 LOW] Error handling: Corrupted settings JSON can break all settings consumers
**File:** `server/lib/config.ts:69`
**Issue:** `readSettings()` calls `JSON.parse()` without recovery. A partially written/corrupt `settings.json` causes repeated runtime failures.
**Fix:** Catch parse errors, back up the bad file, recreate defaults atomically, and validate shape via schema (zod/io-ts).

### [🔵 LOW] Type safety: server/lib is not included in TypeScript project references
**File:** `tsconfig.json:3`
**Issue:** Root `tsconfig.json` references only app/node configs. Combined with `npm run build` (`tsc -b`), backend `server/lib` may skip strict type-checking in CI/build.
**Fix:** Add `tsconfig.server.json` including `server/**/*.ts`, add it to root references, and run a dedicated `typecheck` script in CI.

### [🔵 LOW] Hardcoded values: render concurrency is fixed and ignores existing settings field
**File:** `server/lib/render-worker.ts:30`
**Issue:** Concurrency is hardcoded to `2` in presets, while `GlobalSettings` already has `remotionConcurrency` (`server/lib/config.ts:46`) but it is unused.
**Fix:** Read `remotionConcurrency` from settings, validate/clamp it, and apply per-job with sane defaults.

### [🔵 LOW] DRY/logic inconsistency: normalization uses first generated image, not best available image
**File:** `server/lib/normalize.ts:162`
**Issue:** Fallback image selection uses `generatedImages[0]`, while shared helper `getBestImageFile()` selects most relevant (`enhanced last` / `generated last`). This can reduce output quality and duplicates logic.
**Fix:** Reuse `getBestImageFile(shot)` in `normalizeClips()` to keep image selection consistent across pipelines.

### [⚪ INFO] Dead code: unused import in normalization module
**File:** `server/lib/normalize.ts:3`
**Issue:** `path` is imported but never used.
**Fix:** Remove the unused import (or use it if intended) to keep module clean.

**Findings summary:** 🔴 CRITICAL 0 | 🟠 HIGH 3 | 🟡 MEDIUM 4 | 🔵 LOW 4 | ⚪ INFO 1