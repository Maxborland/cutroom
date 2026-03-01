@codex

## Fix: Duration normalization rounds up

User preference: accept any integer seconds in UI/requests, but when the provider only permits a set of duration values, normalize **upwards** (ceiling) rather than picking the nearest (which previously biased downwards).

### Changes
- Replace nearest-duration selection with **round-up / clamp-to-max** selection.
  - Example: permitted [4s,6s,8s]
    - 5s -> 6s
    - 7s -> 8s
    - 9s -> 8s (clamp)
- Applies to:
  - veo3 pre-normalization heuristic
  - generic "permitted durations" retry path when fal returns a validation error

### Tests
- Update unit test to assert 5s -> 6s for veo3 pre-normalization.

### Checklist
- [x] unit tests
- [x] build
