# CutRoom — Master Review Summary (2026-02-28)

This document summarizes findings from 4 Codex 5.3 review reports:

- Part 1 (server/lib): `docs/_review-part1-server-lib.md`
- Part 2 (server/routes): `docs/_review-part2-server-routes.md`
- Part 3 (frontend): `docs/_review-part3-frontend.md`
- Part 4 (remotion/tests/health): `docs/_review-part4-remotion-tests-health.md`

## Severity totals (combined)

- 🔴 CRITICAL: 2
- 🟠 HIGH: 12
- 🟡 MEDIUM: 27
- 🔵 LOW: 14
- ⚪ INFO: 3

## Top priorities (fix first)

### 1) 🔴 SSRF vectors (server-side request forgery)
**Where:** Part 2 + Part 1

- Mutable `shot.videoFile` + `POST /cache-video` can be abused to make the server fetch arbitrary URLs.
- External `sourceImage` can trigger remote server-side fetch in fallback paths.
- `fetchRemoteMediaBuffer(url)` performs unrestricted fetch with no IP-range blocking, redirect control, or size limits.

**Impact:** if the server is reachable beyond localhost/VPN, this can expose internal services (metadata endpoints), scan network, and/or leak data.

**Fix direction:**
- Treat `videoFile` and other server-managed fields as immutable from client updates (field allowlist / DTO validation).
- Add a “safe remote fetch” utility:
  - allowlist protocols (https/http)
  - block private/link-local/loopback ranges after DNS resolution
  - limit redirects and re-validate each hop
  - enforce max download bytes; stream to file for large assets

### 2) 🟠 Fail-open auth defaults
**Where:** Part 2

By default, API access can become unauthenticated if env key is unset.

**Fix direction:** secure-by-default (fail closed) for non-dev; explicit opt-out for local-only.

### 3) 🟠 DoS risk (memory/disk)
**Where:** Part 1 + Part 2

- Unbounded `arrayBuffer()` downloads can blow memory.
- Generous body/upload limits applied globally.

**Fix direction:** route-specific parsers, strict size caps, streaming downloads, concurrency/rate limiting for expensive endpoints.

### 4) 🔴 Frontend build-breaking type mismatch
**Where:** Part 3

Mismatch in montage render job id contract (`result.jobId` vs `RenderJob.id`) can break prod build or runtime behavior.

**Fix direction:** align API response + TS types, add a compile/build check.

### 5) 🟠 Remotion semantics & perf
**Where:** Part 4

- Some plan directives (trim/motion) are ignored.
- Some transition types aren’t real clip-to-clip transitions.
- Bundle rebuild per render job is expensive.

**Fix direction:** implement missing semantics, add preflight validation, reuse bundle where possible.

## Next deliverables

1) **Security patchset** (SSRF + safe fetch + DTO allowlists + download limits)
2) **Auth defaults patchset** (fail closed by default)
3) **Frontend contract patchset** (type mismatch)
4) **Remotion correctness/perf patchset**

---

If you want the raw findings, open the 4 part reports linked above.
