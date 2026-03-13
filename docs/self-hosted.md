# Self-Hosted Deployment

This profile packages CutRoom as a single-tenant installation for a customer-managed cloud VM or on-prem server.

## Stack

- `app`: Express API + built frontend from `dist`
- `worker`: background jobs for render, export, and media caching
- `postgres`: PostgreSQL for users, licensing state, projects, and jobs
- `app_data` volume: local project/media storage

## First Boot

1. Copy `.env.self-hosted.example` to `.env.self-hosted`.
2. Change at least:
   - `POSTGRES_PASSWORD`
   - `DATABASE_URL`
   - `BOOTSTRAP_SETUP_TOKEN`
   - `CORS_ORIGINS` if the browser origin differs from the app origin
   - `AUTH_COOKIE_SECURE=true` if you terminate TLS in front of the app and the proxy does not forward `X-Forwarded-Proto: https`
3. Build and start the stack:

```bash
docker compose -f docker-compose.self-hosted.yml up -d --build
```

4. Open `http://<server>:3001`.
5. Complete bootstrap with the `BOOTSTRAP_SETUP_TOKEN`, create the first `owner`, then invite the rest of the team from `Настройки -> Команда`.

## Runtime Notes

- The `app` service runs `npm run db:migrate` before the API starts.
- The frontend is served by Express from `dist`, so customers only need one public URL.
- The `worker` service must stay online for render, export preparation, and background media caching.
- `REQUIRE_API_ACCESS_KEY=false` is the safe default for the current browser-based deployment profile; authentication is enforced with invite-only sessions.
- Auth cookies automatically stay non-`Secure` for direct HTTP first boot and switch to `Secure` when requests arrive through HTTPS or forwarded `X-Forwarded-Proto: https`.

## Backup

Back up both persistent volumes:

- `postgres_data`
- `app_data`

For a consistent backup, stop writes or snapshot the VM/storage while PostgreSQL is in a safe state.

## Upgrade

1. Pull the new application version.
2. Rebuild and restart:

```bash
docker compose -f docker-compose.self-hosted.yml up -d --build
```

3. Confirm the app is healthy:

```bash
docker compose -f docker-compose.self-hosted.yml ps
```

4. Open `/api/health` and verify the UI loads.

## Operational Checks

- `app` health: `GET /api/health`
- verify owner/admin login
- verify `Настройки -> Лицензия` and `Настройки -> Команда`
- verify the worker is running before testing render/export
