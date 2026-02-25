import path from 'node:path';

/**
 * Resolve a path ensuring it stays within the given base directory.
 * Throws if the resolved path escapes the base.
 */
export function resolvePathWithin(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, ...segments);
  const relative = path.relative(resolvedBase, resolvedPath);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedPath;
  }

  throw new Error(`Resolved path escapes base directory: ${resolvedPath}`);
}

/**
 * Sanitize a user-provided filename for safe disk storage.
 * Strips path traversal, control chars, and OS-reserved characters.
 */
export function sanitizeUploadedFilename(originalname: string, fallbackPrefix = 'upload'): string {
  const baseName = path.basename((originalname || '').replace(/\\/g, '/'));
  const noControl = baseName.replace(/[\x00-\x1f\x7f]/g, '');
  const cleaned = noControl.replace(/[<>:"/\\|?*]/g, '_').trim();
  const safe = cleaned && cleaned !== '.' && cleaned !== '..'
    ? cleaned
    : `${fallbackPrefix}_${Date.now().toString(36)}`;
  return safe.slice(0, 255);
}
