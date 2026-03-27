# Fal Schema-Driven Capabilities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Fal model capabilities schema-driven everywhere so settings UI and generation payloads use real provider-native options from Fal OpenAPI.

**Architecture:** Add a cached Fal schema loader + capability normalizer on the backend, feed `/api/models` from that normalized layer, and reuse the same layer when building image/video payloads. Keep the current registry only as identity/fallback metadata when schema is unavailable.

**Tech Stack:** Express, TypeScript, Vitest, Vite, Fal OpenAPI

---

### Task 1: Add schema loader and parser

**Files:**
- Create: `server/lib/fal-schema.ts`
- Test: `tests/unit/fal-schema.test.ts`

Write failing tests for parsing Fal OpenAPI into normalized capabilities, including `resolution`, `aspect_ratio`, and `duration`. Implement the minimal loader/parser with caching-friendly helpers.

### Task 2: Feed `/api/models` from Fal schema

**Files:**
- Modify: `server/routes/models.ts`
- Test: `tests/integration/models.test.ts`

Write failing integration tests showing that Fal image/video model options are populated from endpoint schema. Implement schema-backed enrichment while preserving fallback behavior.

### Task 3: Use schema-backed capabilities in generation payloads

**Files:**
- Modify: `server/routes/generate/image.ts`
- Modify: `server/routes/generate/video.ts`
- Test: `tests/integration/generate-fal-input-fallback.test.ts`
- Test: `tests/unit/generation-video-quality.test.ts`

Write failing tests proving image/video requests use provider-native schema values when available. Implement payload mapping through normalized capabilities instead of hardcoded heuristics.

### Task 4: Make settings UI reflect real model capabilities

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Test: `tests/components/SettingsView.test.tsx`

Write failing component tests for schema-driven options in image/video controls. Implement UI behavior so exact provider options are shown when schema exists, with honest degraded copy otherwise.

### Task 5: Final verification and docs

**Files:**
- Modify: `README.md` (if needed)
- Modify: `docs/self-hosted.md` (if needed)

Run focused tests first, then repo verification. Update docs only if user-facing settings behavior or model capability expectations changed materially.
