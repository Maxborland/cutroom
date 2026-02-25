# Security Best Practices Report
_Generated on 2026-02-19_

## Executive Summary
- High-level authentication prevents only when `API_ACCESS_KEY` is set; the middleware intentionally skips every route otherwise, so the API can be left wide open in misconfigured environments.
- The ad-hoc rate limiter stores an entry for every caller and never prunes it, creating a straightforward memory-based DoS path once an attacker sends requests from many distinct IPs.
- There is no production-grade error handler in `server/index.ts`, so Express’s default error handler (which exposes stack traces when `NODE_ENV !== 'production'`) remains active.

Severity legend: P0 = Critical, P1 = High, P2 = Medium, P3 = Low.
- High-level authentication prevents only when `API_ACCESS_KEY` is set; the middleware intentionally skips every route otherwise, so the API can be left wide open in misconfigured environments.
- The ad-hoc rate limiter stores an entry for every caller and never prunes it, creating a straightforward memory-based DoS path once an attacker sends requests from many distinct IPs.
- There is no production-grade error handler in `server/index.ts`, so Express’s default error handler (which exposes stack traces when `NODE_ENV !== 'production'`) remains active.

## Findings

### FINDING-001 — P1 (High): Missing enforcement of API access key
- **Location:** `server/index.ts:33-74`
- **Evidence:** `apiAccessKey` falls back to `''`, the `/api` middleware allows every request when that string is empty, and the health route is skipped before the check. No route can be reached without an API key unless the environment variable is populated.
- **Impact:** When `API_ACCESS_KEY` is unset (common in dev or forgotten staging setups) the entire `/api` surface, including settings and asset uploads, becomes unauthenticated and can be reached by any client, exposing secrets and editable project data.
- **Fix:** Treat a missing API key as configuration error—refuse to start or immediately reply 401. Move the middleware earlier so every `/api` request must have `x-api-key`, or add a fallback key/identity provider.
- **Mitigation:** Layer additional tokens (per-user, per-origin) or gate the server at the proxy level while the API key is missing; refuse to log/return secrets when the API key is absent.

### FINDING-002 — P2 (Medium): Rate limiting state never cleaned up
- **Location:** `server/index.ts:33-81`
- **Evidence:** `rateLimitStore` is a `Map` whose entries’ `resetAt` timestamp is compared, but nothing removes the entry after the window expires. Each new IP adds a key, and that key stays forever even after the timer passes.
- **Impact:** An attacker that iterates through many source IPs / client IDs can grow `rateLimitStore` without bound, exhausting memory, while legitimate clients are still rate limited by stale entries. No garbage collection or eviction makes the limiter itself a DoS vector.
- **Fix:** Use an eviction strategy (remove entries once `resetAt` passes or on timer), cap the map size, or adopt a battle-tested middleware such as `rate-limiter-flexible`/`express-rate-limit`.
- **Mitigation:** If immediate cleanup is hard, expire entries periodically with a background timer, combine per-key TTLs, and record only hashed keys instead of storing full IP strings.

### FINDING-003 — P2 (Medium): Default Express error handler risking sensitive leaks
- **Location:** `server/index.ts:96-112` (no `app.use((err, req, res, next) => ...)` before `app.listen`)
- **Evidence:** Every middleware block in `server/index.ts` ends before registering any error-handling middleware. Express will therefore use its default handler, and unless the deployment sets `NODE_ENV=production`, it will return stack traces and module paths to clients.
- **Impact:** An error anywhere in the `/api` routes (rate limiter, file reads, third-party calls) can leak stack traces or `err` details to clients, potentially exposing secrets, filesystem paths, or internal state.
- **Fix:** Add a final error-handling middleware that logs the exception server-side and returns a sanitized JSON error message (e.g., `{ error: 'Internal server error' }`). Ensure `NODE_ENV` is set to `production` or guard against verbose responses in staging.
- **Mitigation:** In addition to the middleware, wrap async handlers with a shared helper that catches rejections and sends consistent responses so that any future route additions inherit the safe pattern.
