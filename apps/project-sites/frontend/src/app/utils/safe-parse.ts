/**
 * Safe JSON parse helpers for untrusted browser-side input.
 *
 * @remarks
 * Mirrors the backend `src/utils/safe-parse.ts` helpers so Angular components
 * can read `localStorage`, `sessionStorage`, query strings, and fetched
 * payloads without scattering `try / catch` blocks. Angular's tree-shaker
 * cannot re-use Worker code, so the helpers are duplicated here.
 *
 * @example
 * const raw = localStorage.getItem('ui-prefs');
 * const prefs = safeParseJSON<UiPrefs>(raw, { density: 'comfy', theme: 'dark' });
 *
 * @example
 * const body = await fetch('/api/me').then((r) => r.text());
 * const me = safeParseJSONOrNull<User>(body);
 * if (!me) router.navigateByUrl('/signin');
 */

/**
 * Parse a JSON string and return `fallback` on null / undefined / parse error.
 *
 * @typeParam T - The expected shape of the parsed value. Caller-owned.
 * @param raw - The string to parse. `null` / `undefined` short-circuit to `fallback`.
 * @param fallback - The value returned when `raw` is empty or invalid JSON.
 * @returns The parsed value cast to `T`, or `fallback` on any failure.
 *
 * @example
 * safeParseJSON<{ count: number }>('{"count":3}', { count: 0 }); // { count: 3 }
 * safeParseJSON<{ count: number }>('not json',    { count: 0 }); // { count: 0 }
 * safeParseJSON<{ count: number }>(null,          { count: 0 }); // { count: 0 }
 */
export function safeParseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse a JSON string and return `null` on null / undefined / parse error.
 *
 * @typeParam T - The expected shape of the parsed value. Caller-owned.
 * @param raw - The string to parse.
 * @returns The parsed value cast to `T`, or `null` on any failure.
 *
 * @example
 * safeParseJSONOrNull<{ ok: boolean }>('{"ok":true}'); // { ok: true }
 * safeParseJSONOrNull<{ ok: boolean }>('broken');      // null
 */
export function safeParseJSONOrNull<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
