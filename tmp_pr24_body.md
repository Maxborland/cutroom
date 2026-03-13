## Problem
fal-ai veo3 image-to-video endpoints accept only literal durations like '4s', '6s', or '8s'.

Today we pass numeric shot durations (e.g. 3 or 5), which causes a validation error on the first attempt, and only then we retry with a permitted duration.

## Change
- Add endpoint heuristic normalization for veo3 image-to-video endpoints:
  - if endpoint contains `veo3` and `image-to-video`, normalize the requested duration to the nearest of `['4s', '6s', '8s']` before the first subscribe call.
- Keep the existing retry-based normalization as a fallback for other endpoints (or if the heuristic misses).

## Tests
- New unit test: veo3 endpoints pre-normalize duration (single subscribe call).
- Existing retry-based test kept for a non-veo3 endpoint.

No behavior change for non-veo3 endpoints; this just avoids the initial failed attempt for veo3.