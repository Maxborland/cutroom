# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React + TypeScript frontend.
- `src/components/` holds UI views and reusable components (for example `ShotBoard.tsx`, `SettingsView.tsx`).
- `src/stores/` contains Zustand state stores; `src/lib/` contains API and utility helpers; `src/types/` centralizes shared types.
- `server/` contains the Express API (`server/index.ts`, `server/routes/**`, `server/lib/**`).
- `tests/` is split by scope: `unit/`, `components/`, `integration/`, and `e2e/`.
- Runtime data is written under `data/` (gitignored). Build output is `dist/`.

## Build, Test, and Development Commands
- `npm run dev`: start Vite frontend on `5173`.
- `npm run server`: start backend with `tsx watch` on `3001`.
- `npm run dev:all`: run frontend and backend together.
- `npm run build`: type-check (`tsc -b`) and build production assets.
- `npm run preview`: preview the production build.
- `npm run lint`: run ESLint across the repo.
- `npm run test`, `npm run test:unit`, `npm run test:integration`, `npm run test:components`: run Vitest suites.
- `npm run test:e2e`: run Playwright tests.
- `npm run test:all`: run Vitest + Playwright end-to-end.

## Coding Style & Naming Conventions
- Use TypeScript with strict compiler options; do not ignore unused locals/parameters.
- Use 2-space indentation and keep existing style in each area (frontend is mostly semicolonless; server files use semicolons).
- Use `PascalCase` for React component files, `camelCase` for utilities/stores, and descriptive route filenames in `server/routes/`.
- Run `npm run lint` before opening a PR.

## Testing Guidelines
- Frameworks: Vitest (`jsdom` for frontend tests, `node` for integration) and Playwright for browser flows.
- Naming: `*.test.ts` / `*.test.tsx` for Vitest; `*.spec.ts` for Playwright.
- Add or update tests for any behavior change in stores, routes, or pipeline flow.
- For significant changes, run `npm run test:all` locally before requesting review.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history: `feat:`, `fix:`, `refactor:`, `test:`.
- Keep commits focused and scoped to one logical change.
- PRs should include: concise summary, linked issue/task, testing performed (exact commands), and screenshots for UI changes.
- Call out any config, API, or data-shape changes explicitly.

## Security & Configuration Tips
- Never commit secrets or generated runtime data (`.env`, `data/`, `test-results/` are ignored).
- Treat API keys in settings as sensitive; validate CORS/auth changes in `server/index.ts` when touching API access logic.

## Product Language
- The product UI language is Russian by default.
- Keep all user-facing UI text, toasts, and prompt instructions in Russian unless the user explicitly asks for another language.
- Use English only for code identifiers, API fields, protocol values, and developer-only logs.
