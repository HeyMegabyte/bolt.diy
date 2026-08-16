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
