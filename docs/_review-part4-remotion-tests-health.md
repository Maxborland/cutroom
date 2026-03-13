### [🟠 HIGH] Remotion: Montage trim/motion directives are ignored during render
**File:** `server/remotion/src/components/VideoClip.tsx:24`
**Issue:** `ResolvedClip.trimEndSec` and `motionEffect` are produced by planning (`plan-reader`) but never used by `VideoClip`. Also video playback is hardcoded with `startFrom={0}` (`VideoClip.tsx:43`), so clip trimming behavior from the plan is not applied.
**Fix:** Extend `ResolvedClip` to include explicit `trimStartFrames`/`trimEndFrames`, then pass to `<Video startFrom endAt />`. Implement `motionEffect` transforms (Ken Burns / pan) in this component.

### [🟠 HIGH] Remotion: `crossfade`/`wipe` transitions are visual black overlays, not real clip-to-clip transitions
**File:** `server/remotion/src/components/Transition.tsx:48`
**Issue:** Transition types like `crossfade` and `wipe` do not blend outgoing/incoming clips; they render black overlays. This breaks expected transition semantics and can visually darken footage.
**Fix:** Implement overlap-based transitions (two clip layers during transition window) and animate opacity/clip-path/masks between outgoing and incoming clips.

### [🟡 MEDIUM] Remotion: frame rounding strategy can introduce cumulative 1-frame drift
**File:** `server/remotion/src/lib/plan-reader.ts:58`
**Issue:** `Math.round(sec * fps)` is applied to each `startSec` and `durationSec` independently. For fractional second values this can create tiny gaps/overlaps between clips over long timelines and minor A/V sync drift.
**Fix:** Use a frame cursor approach (`startFrame = cursor; durationFrames = round(duration); cursor += durationFrames`) so boundaries stay deterministic and contiguous.

### [🟡 MEDIUM] Audio sync/mix: music ducking is applied even when no voiceover exists
**File:** `server/remotion/src/components/AudioMixer.tsx:44`
**Issue:** Ducking curve is always computed from intro/outro window, even when `voiceoverFile` is empty. Result: music is unnecessarily reduced in the middle section.
**Fix:** If no voiceover file is present, keep music at constant `musicGainDb` (disable ducking interpolation).

### [🟡 MEDIUM] Remotion error handling: missing media files are not validated before expensive render steps
**File:** `server/lib/render-worker.ts:109`
**Issue:** Render proceeds to bundle/select composition before checking that referenced clip/audio files exist/readable. Failures happen late with less actionable errors.
**Fix:** Add preflight validation (`fs.access`) for timeline clips, voiceover, and music before bundling; return structured missing-file errors per asset.

### [🟠 HIGH] Video rendering memory/perf risk: bundle is rebuilt for every render job
**File:** `server/lib/render-worker.ts:113`
**Issue:** Each render calls `bundle()` again. Under repeated jobs this adds avoidable CPU/memory pressure and longer queue latency.
**Fix:** Cache `serveUrl`/bundle output per process with invalidation on code changes (or pre-bundle at startup for production workers).

### [🔵 LOW] Remotion composition correctness: lower-third `position` is ignored
**File:** `server/remotion/src/components/LowerThird.tsx:43`
**Issue:** `ResolvedLowerThird.position` exists but overlay is always rendered at fixed bottom-left coordinates.
**Fix:** Map `bottom_left`/`bottom_center`/`bottom_right` to dynamic style positioning.

### [🟡 MEDIUM] Tests coverage gap: Remotion components are largely untested
**File:** `tests/unit/montage-render.test.ts:242`
**Issue:** Tests cover `resolvePlan()` happy paths but do not assert behavior of `VideoClip`, `AudioMixer`, `Transition`, `Intro/Outro`, or lower-third layout.
**Fix:** Add component-level tests (or frame snapshot tests) for trim behavior, transition overlap, ducking curve, and text overlays.

### [🟡 MEDIUM] Test mock quality: over-mocking hides real montage/render integration risks
**File:** `tests/integration/montage.test.ts:25`
**Issue:** `render-worker`, `montage-plan`, normalization, and TTS are mocked, so critical end-to-end contracts (real plan -> resolvePlan -> render input correctness) are not exercised.
**Fix:** Keep most tests mocked for speed, but add at least one thin-slice integration test using real `generateMontagePlan` + `resolvePlan` and short render output.

### [🟡 MEDIUM] Flaky E2E risk: fixed time waits and conditional UI branching
**File:** `tests/e2e/project-crud.spec.ts:8`
**Issue:** `waitForTimeout(3000/1000)` and branching on `isVisible()` are timing-sensitive and can intermittently fail in slower CI.
**Fix:** Replace sleeps with deterministic waits (`expect(locator).toBeVisible()` / `waitForURL` / API-driven setup fixtures).

### [🟡 MEDIUM] README incompleteness: missing operational prerequisites and setup details
**File:** `README.md:48`
**Issue:** Quick Start lacks required prerequisites/config details (API keys location, ffmpeg requirement, production/deployment guidance).
**Fix:** Add sections: prerequisites, configuration keys, local/CI setup, and deployment runbook.

### [🟡 MEDIUM] Project health: missing `.env.example` and container/deployment artifacts
**File:** `.env.example:1`
**Issue:** `.env.example` is absent, and there is no Dockerfile/compose deployment baseline. This slows onboarding and increases config drift.
**Fix:** Add `.env.example` documenting all required variables; add Dockerfile (+ optional compose) and deployment docs.

### [🟠 HIGH] Dependency audit: high-severity vulnerabilities currently present
**File:** `package.json:21`
**Issue:** `npm audit` reports high vulnerabilities in dependency tree (including `rollup` path traversal, `minimatch` ReDoS, and `serialize-javascript` RCE chain via webpack/remotion toolchain).
**Fix:** Run `npm audit fix` for patchable issues, pin patched versions where needed, and track/mitigate no-fix advisories by upgrading/removing vulnerable transitive chains.

### [🔵 LOW] Dependency declaration hygiene: direct import from transitive package
**File:** `server/lib/render-worker.ts:6`
**Issue:** Code imports `@remotion/bundler` directly but `package.json` does not declare it explicitly (currently satisfied transitively via `@remotion/cli`). This is brittle across package managers.
**Fix:** Add `@remotion/bundler` as a direct dependency; remove unused deps after verification (e.g., `@remotion/media-utils` if truly unused).

### [🔵 LOW] `.gitignore` is minimal and may miss common generated artifacts
**File:** `.gitignore:1`
**Issue:** Missing patterns such as `coverage/`, `.env.local`, `.env.*.local`, `.DS_Store`, temp artifacts, etc.
**Fix:** Expand ignore rules to standard Node/TS/Vite + local env and report outputs.

### [🔵 LOW] AGPL-3.0 compliance guidance is not documented for hosted usage
**File:** `README.md:76`
**Issue:** License is declared, but there is no practical compliance guidance for network deployment scenarios (source offer / modifications notice).
**Fix:** Add a short AGPL compliance section with operator checklist and source-distribution policy.

### [⚪ INFO] Dependency freshness: multiple packages are behind latest releases
**File:** `package.json:22`
**Issue:** `npm outdated` shows several dependencies/devDependencies behind latest (e.g., Tailwind, ESLint, multer, react-router-dom, types packages).
**Fix:** Establish scheduled dependency update cadence (monthly), with CI smoke tests and selective pinning for risky majors.

---

**Findings count:**
- 🔴 CRITICAL: 0
- 🟠 HIGH: 4
- 🟡 MEDIUM: 8
- 🔵 LOW: 4
- ⚪ INFO: 1
