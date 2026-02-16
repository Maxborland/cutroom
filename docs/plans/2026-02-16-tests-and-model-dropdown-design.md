# CutRoom: Tests & Model Dropdown — Design Document

**Date:** 2026-02-16

## 1. Test Infrastructure

### Stack

| Level | Tool | Target |
|-------|------|--------|
| Unit | Vitest | storage.ts, openrouter.ts, API client, Zustand store |
| Integration | Vitest + supertest | Express routes — CRUD, upload, export |
| Component | Vitest + @testing-library/react | React components in isolation |
| E2E | Playwright | Full pipeline from project creation to export |

### File Structure

```
tests/
├── unit/
│   ├── storage.test.ts          # File system CRUD operations
│   ├── openrouter.test.ts       # OpenRouter wrapper (mocked fetch)
│   ├── api-client.test.ts       # Frontend API client (mocked fetch)
│   └── projectStore.test.ts     # Zustand store actions
├── integration/
│   ├── projects.test.ts         # GET/POST/PUT/DELETE /api/projects
│   ├── assets.test.ts           # Upload/serve/delete brief assets
│   ├── shots.test.ts            # Shot CRUD + video upload
│   ├── settings.test.ts         # Settings read/write + API key masking
│   ├── generate.test.ts         # Script/shot generation (mocked LLM)
│   └── export.test.ts           # ZIP + prompts text export
├── components/
│   ├── SettingsView.test.tsx     # Model dropdown, save, load
│   ├── BriefEditor.test.tsx     # Upload zone, text input, asset list
│   ├── ShotBoard.test.tsx       # Kanban columns, card rendering
│   ├── ShotDetail.test.tsx      # Edit fields, status actions, generate
│   └── PipelineHeader.test.tsx  # Stage buttons, statistics display
└── e2e/
    ├── pipeline.spec.ts         # Full pipeline: brief → script → shots → export
    ├── settings.spec.ts         # Settings page with model dropdown
    └── project-crud.spec.ts     # Create/switch/delete projects
```

### Testing Approach

- **Backend integration tests** use a temporary `data/` directory, cleaned after each test
- **OpenRouter API** always mocked — no real API calls in tests
- **E2E tests** start both servers via Playwright `webServer` config
- **Component tests** mock `api.ts` via `vi.mock()`
- **Zustand store tests** mock the API layer, test state transitions

### NPM Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:components": "vitest run tests/components",
  "test:e2e": "playwright test",
  "test:all": "vitest run && playwright test"
}
```

## 2. Model Dropdown

### Backend: `GET /api/models`

New endpoint that fetches available models from OpenRouter API:

```
GET https://openrouter.ai/api/v1/models
```

Response is filtered and cached:
- **Cache TTL**: 10 minutes (in-memory)
- **Filter**: separate text models (modality includes "text") and image models (id contains "image" or known image model list)
- **Fallback**: if API key missing or request fails, return empty arrays
- **Response format**:
```json
{
  "textModels": [
    { "id": "openai/gpt-4o", "name": "GPT-4o" }
  ],
  "imageModels": [
    { "id": "openai/gpt-image-1", "name": "GPT Image 1" }
  ]
}
```

### Frontend: SettingsView Changes

Replace text `<input>` fields for model selection with custom dropdown `<select>`:

- Searchable filter input at the top of dropdown
- Shows `model_name` with `model_id` in muted text
- Currently selected model highlighted
- Loading spinner while models are being fetched
- **Fallback**: if models list is empty (no API key), show text input as before
- Models fetched on component mount via `api.models.list()`

### API Client Addition

```typescript
api.models: {
  list: () => request<{ textModels: Model[], imageModels: Model[] }>('/models')
}
```
