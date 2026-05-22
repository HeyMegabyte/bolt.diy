/**
 * Safe JSON parse helpers for untrusted / network-controlled input.
 *
 * @remarks
 * The native `JSON.parse` throws on the first invalid character. Wrapping
 * every call site in `try / catch` is repetitive and hides intent. These
 * helpers swallow the parse failure and return a caller-supplied default
 * (`safeParseJSON`) or `null` (`safeParseJSONOrNull`) so that route handlers,
 * KV reads, R2 reads, and webhook bodies can chain operations without
 * defensive boilerplate.
 *
 * @example
 * const cached = await env.CACHE_KV.get('session:42');
 * const session = safeParseJSON<Session>(cached, { id: '', tier: 'free' });
 *
 * @example
 * const body = await req.text();
 * const payload = safeParseJSONOrNull<WebhookPayload>(body);
 * if (!payload) return badRequest('invalid JSON');
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
