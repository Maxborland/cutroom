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
const requireApiAccessKeyEnv = parseBoolean(process.env.REQUIRE_API_ACCESS_KEY);
const requireApiAccessKey = requireApiAccessKeyEnv ?? false;

const app = createApp({
  apiAccessKey: process.env.API_ACCESS_KEY,
  allowMissingApiKey: !requireApiAccessKey,
});

app.listen(PORT, () => {
  console.log(`[video-pipeline] API server running on http://localhost:${PORT}`);
  if (!process.env.API_ACCESS_KEY && requireApiAccessKey) {
    console.warn('[video-pipeline] API access key is required, but API_ACCESS_KEY is empty');
  }

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
