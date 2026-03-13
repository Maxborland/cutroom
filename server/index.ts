import { createApp } from './app.js';
import { recoverExternalImageReferencesOnStartup } from './lib/external-image-cache.js';

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined): boolean | null => {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
};

const PORT = parsePort(process.env.PORT, 3001);

type AuthMode = 'disabled' | 'optional' | 'required';

const parseAuthMode = (value: string | undefined): AuthMode | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'disabled') return 'disabled';
  if (normalized === 'optional') return 'optional';
  if (normalized === 'required') return 'required';
  return null;
};

const authModeEnv = parseAuthMode(process.env.AUTH_MODE);
const requireApiAccessKeyEnv = parseBoolean(process.env.REQUIRE_API_ACCESS_KEY);

const authMode: AuthMode = authModeEnv
  ?? (requireApiAccessKeyEnv == null
    ? (process.env.NODE_ENV === 'production' ? 'required' : 'optional')
    : (requireApiAccessKeyEnv ? 'required' : 'optional'));

const allowMissingApiKey = authMode !== 'required';

if (authMode === 'required' && !process.env.API_ACCESS_KEY?.trim()) {
  console.error('[video-pipeline] AUTH_MODE=required but API_ACCESS_KEY is empty');
  process.exit(1);
}

const app = createApp({
  // AUTH_MODE=disabled should bypass API key checks even if a key is present in env.
  apiAccessKey: authMode === 'disabled' ? '' : process.env.API_ACCESS_KEY,
  allowMissingApiKey,
});

app.listen(PORT, () => {
  console.log(`[video-pipeline] API server running on http://localhost:${PORT} (auth=${authMode})`);

  void recoverExternalImageReferencesOnStartup()
    .then((summary) => {
      if (summary.referencesFound === 0) return;

      console.log(
        `[external-cache] Startup recovery finished: cached ${summary.cachedCount}/${summary.referencesFound} refs ` +
        `(${summary.projectsScanned} projects, ${summary.shotsScanned} shots)`,
      );

      if (summary.failedCount > 0) {
        console.warn(`[external-cache] Startup recovery failed for ${summary.failedCount} refs`);
      }
    })
    .catch((err) => {
      console.error('[external-cache] Startup recovery crashed:', err);
    });
});
