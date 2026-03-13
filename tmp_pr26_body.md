@codex

## Feature: Video review quick controls

When reviewing a generated video, adds quick tweak controls to the ShotDetail footer:

1. **Edit hint** — short text input appended to the existing `shot.videoPrompt` before regenerating. Hint is appended as `EDIT: ...`. Subsequent edits replace only the appended block (so the prompt doesn’t grow forever).

2. **Duration (seconds)** — accepts any integer seconds (1–60). The provider/server will normalize when an endpoint only permits certain values.
   - Also includes quick-pick buttons for 4 / 6 / 8 seconds (useful for veo3).

3. **"Apply + Regenerate"** button — saves duration and prompt changes to the server first (await), then triggers video generation. Prevents the race where the server reads old values if you regenerate too fast after edits.

### Tests
No new tests for ShotDetail (it mounts the full Zustand store and would require heavy mocking). Existing component + unit test suites pass.

### Checklist
- [x] build
- [x] test:unit
- [x] test:components
