/**
 * Sanitize a value for safe inclusion in log output.
 * Strips control characters (\r \n \t and C0 range) and truncates to maxLen.
 * Prevents log injection / log forging attacks (CodeQL js/log-injection).
 */
export function safeLogValue(value: unknown, maxLen = 200): string {
  return Array.from(String(value ?? ''))
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .slice(0, maxLen);
}
