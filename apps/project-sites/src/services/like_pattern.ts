/**
 * @module like_pattern
 * @description Sanitizer for user-supplied SQL `LIKE` search terms.
 *
 * Lives in its OWN module (not `db.ts`) so a `jest.mock('../services/db.js')` in
 * a handler test never stubs it out to `undefined` — the six route/service tests
 * that mock the D1 layer still exercise the real sanitizer.
 */

/**
 * Sanitize a user-supplied search term for safe use inside a SQL `LIKE` pattern
 * by STRIPPING the wildcard metacharacters `%`, `_` and the escape char `\`.
 *
 * SQLite's `LIKE` treats `%` (any sequence) and `_` (any single char) as
 * wildcards, so wrapping raw user text as `` `%${term}%` `` both (a) matches
 * wrong rows — searching `"50%"` becomes a match-anything wildcard — and (b) trips
 * SQLite's `LIKE or GLOB pattern too complex` error on a wildcard-heavy term,
 * which `dbQuery` swallows into a lying-empty "no results".
 *
 * Escaping (`\%` + `ESCAPE '\'`) is the textbook fix for (a) but does NOT cure (b):
 * D1's SQLite raises "too complex" on the raw `%`/`_` byte count BEFORE resolving
 * escapes (verified live 2026-08-16 — a `%_`×30 term still errored WITH an
 * `ESCAPE '\'` clause). Stripping the metacharacters removes the wildcards
 * entirely, so the resulting `%${sanitizeLikeTerm(q)}%` pattern has exactly the
 * two intended outer wildcards — never wrong-matching, never "too complex".
 * Names containing a literal `%`/`_`/`\` are vanishingly rare and still match on
 * their surrounding text.
 *
 * @param term - Raw user search text (length-bound it BEFORE sanitizing).
 * @returns The term with every `%`, `_` and `\` removed.
 * @example
 * const like = `%${sanitizeLikeTerm(q)}%`; // plain `... WHERE name LIKE ?`
 * sanitizeLikeTerm('a%b_c'); // 'abc'
 * sanitizeLikeTerm('50% off'); // '50 off'
 */
export function sanitizeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '');
}

/**
 * Bound an INTENTIONAL `LIKE` pattern — one where the caller genuinely WANTS
 * `%`/`_` wildcards (an LLM-built admin filter, a glob→LIKE route filter) — so it
 * can never trip SQLite/D1's `LIKE or GLOB pattern too complex` guard.
 *
 * Unlike {@link sanitizeLikeTerm} (which strips ALL wildcards for a literal
 * substring search), this PRESERVES the caller's wildcards up to a safe budget:
 * 1. length-capped at 128 (defuses megabyte patterns),
 * 2. runs of `%` collapsed to one (SQLite treats `%%` === `%`; a long run of `%`
 *    is the classic trigger),
 * 3. total wildcard count capped (D1 raises "too complex" on the raw `%`/`_` byte
 *    count BEFORE resolving escapes — verified ~`%_`×30 in prod — so a small
 *    budget keeps every real query working while a pathological one stays valid).
 *
 * A bounded pattern still executes (never throws → never swallowed into a
 * lying-empty result); it just matches slightly more broadly than the pathological
 * input asked for — the correct trade for an adversarial/degenerate query.
 *
 * @param pattern - A LIKE pattern that legitimately contains `%`/`_`.
 * @param maxWildcards - Max `%`/`_` characters to keep (default 12; excess dropped).
 * @returns The pattern with its leading wildcards preserved but complexity bounded.
 * @example
 * boundLikePattern('site.%');        // 'site.%'  (unchanged — 1 wildcard)
 * boundLikePattern('%'.repeat(60));  // '%'       (run collapsed)
 * boundLikePattern('%_'.repeat(30)); // first 12 wildcards kept, rest dropped
 */
export function boundLikePattern(pattern: string, maxWildcards = 12): string {
  let out = pattern.slice(0, 128).replace(/%{2,}/g, '%');
  let count = 0;
  out = out.replace(/[%_]/g, (m) => (++count <= maxWildcards ? m : ''));
  return out;
}
