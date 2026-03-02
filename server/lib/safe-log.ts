/**
 * Sanitize a value for safe inclusion in log output.
 * Strips control characters (\r \n \t and C0 range) and truncates to maxLen.
 * Prevents log injection / log forging attacks (CodeQL js/log-injection).
 */
export function safeLogValue(value: unknown, maxLen = 200): string {
  return String(value ?? '').replace(/[\r\n\t\x00-\x1f]/g, ' ').slice(0, maxLen);
}
