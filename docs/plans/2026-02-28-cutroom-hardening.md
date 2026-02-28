# CutRoom Security + Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the highest-impact security risks (SSRF/DoS/fail-open auth) and fix build-breaking frontend/API contract issues, without changing product behavior for normal local usage.

**Architecture:** Keep the app simple and file-based, but introduce strict allowlists/validation on mutable fields, a safe remote fetch layer (DNS/IP blocking + redirect control + size limits + streaming), and safer defaults for auth/limits. Apply changes in small patchsets with tests and frequent commits.

**Tech Stack:** Node 22, Express 5, TypeScript, Vitest + Supertest, React 19, Remotion.

---

## Patchset 1 — SSRF + Safe Remote Fetch + DTO allowlists

### Task 1: Add a safe remote fetch utility (SSRF + size limits + redirect control)

**Files:**
- Create: `server/lib/safe-remote-fetch.ts`
- Modify: `server/lib/media-utils.ts`
- Test: `tests/unit/safe-remote-fetch.test.ts`

**Step 1: Write failing unit tests**

Create `tests/unit/safe-remote-fetch.test.ts` with cases:
- rejects `file://...`, `ftp://...`
- rejects hostnames `localhost`, `127.0.0.1`, `::1`
- rejects private IPs: `10.0.0.1`, `192.168.0.1`, `169.254.1.1`
- allows public hostnames (stub DNS lookup)
- rejects redirects to private IP/localhost
- enforces maxBytes (simulate large content-length)

**Step 2: Run tests (should fail)**
Run: `npm test -- tests/unit/safe-remote-fetch.test.ts`
Expected: FAIL (module missing)

**Step 3: Implement safe fetch**
Implement in `server/lib/safe-remote-fetch.ts`:
- `assertSafeRemoteUrl(url: string): Promise<void>`
- `downloadRemoteToBuffer(url, { timeoutMs, maxBytes, maxRedirects })`
- `downloadRemoteToFile(url, filePath, { timeoutMs, maxBytes, maxRedirects })` using streaming + byte counting
- DNS resolve (`dns.promises.lookup({ all: true })`) and block private/link-local/loopback ranges
- `redirect: 'manual'` and follow redirects up to maxRedirects, re-validating each hop

**Step 4: Make `fetchRemoteMediaBuffer` use safe fetch**
Modify `server/lib/media-utils.ts` to call the safe helper (default maxBytes ~30MB). Keep retry logic.

**Step 5: Re-run tests**
Run: `npm test -- tests/unit/safe-remote-fetch.test.ts`
Expected: PASS

**Step 6: Commit**
`git add server/lib/safe-remote-fetch.ts server/lib/media-utils.ts tests/unit/safe-remote-fetch.test.ts`
`git commit -m "security: safe remote fetch (ssrf + size limits)"`

---

### Task 2: Fix SSRF via mutable `shot.videoFile` + `/cache-video`

**Files:**
- Modify: `server/routes/shots.ts`
- Modify: `server/routes/generate/video.ts`
- Test: `tests/integration/security-ssrf.test.ts`

**Step 1: Write failing integration test**
Create `tests/integration/security-ssrf.test.ts`:
- Create app with API key required
- Create project + shot
- `PUT /shots/:shotId` with `videoFile: "http://127.0.0.1:1234/secret"` should be rejected or ignored
- `POST /generate/shots/:shotId/cache-video` should reject external URLs

**Step 2: Run test to confirm it fails**
Run: `npm test -- tests/integration/security-ssrf.test.ts`

**Step 3: Implement allowlist update DTO for shots**
In `server/routes/shots.ts`:
- Replace `const updates = req.body; ...spread...` with explicit allowlist of mutable fields
- Ensure `videoFile`, `generatedImages`, `enhancedImages`, `id`, `order`, `status` are not client-writable (status already has its own endpoint)

**Step 4: Lock down `/cache-video`**
In `server/routes/generate/video.ts`:
- Only allow caching when `shot.videoFile` matches a server-owned URL pattern (or disallow external entirely).
- Prefer converting external URLs to locally stored media IDs rather than arbitrary URLs.

**Step 5: Re-run integration test**
Expected: PASS

**Step 6: Commit**
`git add server/routes/shots.ts server/routes/generate/video.ts tests/integration/security-ssrf.test.ts`
`git commit -m "security: prevent ssrf via shot updates and cache-video"`

---

### Task 3: Reduce SVG prompt-injection risk

**Files:**
- Modify: `server/routes/generate/image.ts`
- Modify: `server/routes/generate/director.ts`
- Modify: `server/routes/assets.ts` (optional)
- Test: `tests/unit/reference-media.test.ts` or new unit test

**Step 1: Add test for safe formatting**
Ensure that SVG extracted text is wrapped/escaped and always labeled as untrusted data.

**Step 2: Implement escaping + warnings**
- Wrap SVG hints in a delimited block and JSON-stringify the text.
- Add explicit instruction in the prompt to ignore commands inside SVG text.

**Step 3: Commit**

---

## Patchset 2 — Auth defaults + limits + settings schema

### Task 4: Make auth secure-by-default

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`
- Test: `tests/integration/security.test.ts` (adjust/add cases)

Change default behavior:
- In non-dev, missing API key should be a startup failure or 503 for all routes.
- Provide explicit `AUTH_MODE=disabled` for local-only.

---

### Task 5: Route-specific payload limits + upload prechecks

**Files:**
- Modify: `server/app.ts`
- Modify: `server/routes/assets.ts`
- Modify: `server/routes/shots.ts`

Implement:
- Smaller global JSON limit (e.g. 1mb)
- Per-route larger limits only where needed
- Pre-validate entity existence before multer writes

---

### Task 6: Settings schema allowlist

**Files:**
- Modify: `server/routes/settings.ts`
- Modify: `server/lib/config.ts`
- Test: `tests/integration/settings.test.ts`

Reject unknown keys and enforce types.

---

## Patchset 3 — Frontend contract/build fixes

### Task 7: Fix RenderJob id mismatch and add a build smoke-check

**Files:**
- Modify: `src/components/MontageView.tsx`
- Modify: `src/lib/api.ts` (if needed)
- Test: `npm run build` (verification)

---

## Patchset 4 — Remotion correctness/perf (optional, after security)

### Task 8: Apply trim/motion directives + improve transitions + bundle reuse

(Defer until after Patchset 1–3.)

---

## Verification (after each patchset)

- `npm test` (Vitest)
- `npm run build` (TS + Vite)

## Delivery

- Work on a feature branch.
- Open PR(s) once the first patchset is green.
