/**
 * @module services/listmonk_import
 * @description Pure CSV import validator + normalizer for Listmonk subscriber
 * batches. Zero I/O, never throws. Validates email shape, normalises extra
 * columns into subscriber attribs, enforces the batch limit. Returns typed
 * successes + per-row errors so the orchestrator can report granular failures
 * without stopping the whole batch.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscriberImport {
  readonly email: string;
  readonly name: string;
  readonly attribs: Readonly<Record<string, string>>;
  readonly status: 'enabled' | 'disabled';
}

export interface ImportResult {
  readonly subscribers: readonly SubscriberImport[];
  readonly errors: readonly string[];
  readonly valid: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max rows per import batch. */
export const MAX_IMPORT_ROWS = 10_000;

/** Required CSV columns (email is the floor). */
export const REQUIRED_COLUMNS: readonly string[] = ['email'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a single email (not comprehensive — just basic shape check).
 *
 * Must contain `@` with something before and after, no spaces, max 254 chars.
 *
 * @param email - Raw email string
 * @returns true when the email passes the basic shape check
 *
 * @example
 * isValidEmail('a@b.co')    // true
 * isValidEmail('')          // false
 * isValidEmail('a @b.co')   // false (space)
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 254) return false;
  if (trimmed.includes(' ')) return false;

  // exactly one @ with non-empty local and domain parts
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0 || atIdx !== trimmed.lastIndexOf('@')) return false;
  const afterAt = trimmed.slice(atIdx + 1);
  if (afterAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate + normalise a raw CSV row set into typed SubscriberImport[].
 *
 * Rules:
 * - Missing email → error at that row index.
 * - Bad email shape → error at that row index with the offending value.
 * - Name defaults to '' when missing.
 * - Extra columns (beyond email, name) become subscriber `attribs`.
 * - `status` defaults to `'enabled'` unless the row has a column `status`
 *   set to `'disabled'`.
 * - If rows.length exceeds MAX_IMPORT_ROWS, a batch-level error is added and
 *   ALL rows are still processed individually so the caller sees every error.
 * - Empty input yields ImportResult with valid:true, empty subscribers array.
 *
 * @param rows - Array of raw string-keyed row objects from the CSV parser
 * @returns ImportResult with per-row errors and the normalised subscriber list
 *
 * @example
 * const r = parseImportRows([{ email: 'a@b.co', name: 'Alice' }]);
 * r.valid     // true
 * r.errors    // []
 * r.subscribers[0].email  // 'a@b.co'
 */
export function parseImportRows(rows: readonly Record<string, string>[]): ImportResult {
  const subscribers: SubscriberImport[] = [];
  const errors: string[] = [];

  if (rows.length > MAX_IMPORT_ROWS) {
    errors.push(`exceeds max import rows (${MAX_IMPORT_ROWS})`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowErrors: string[] = [];

    const emailRaw = row.email ?? '';
    const email = emailRaw.trim();

    if (!email) {
      rowErrors.push(`row ${i + 1}: missing email`);
    } else if (!isValidEmail(email)) {
      rowErrors.push(`row ${i + 1}: invalid email '${emailRaw}'`);
    }

    // name — default '' when missing/empty
    const nameRaw = row.name ?? '';
    const name = nameRaw.trim();

    // status — default enabled; only 'disabled' flips it
    const statusRaw = (row.status ?? '').trim().toLowerCase();
    const status: 'enabled' | 'disabled' = statusRaw === 'disabled' ? 'disabled' : 'enabled';

    // attribs — everything except email, name, status
    const attribs: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      const k = key.trim().toLowerCase();
      if (k === 'email' || k === 'name' || k === 'status') continue;
      const v = row[key];
      if (v !== undefined && v !== null) {
        attribs[key] = String(v);
      }
    }

    // only push a subscriber when email is present and valid
    if (email && isValidEmail(email)) {
      subscribers.push({
        attribs: Object.freeze({ ...attribs }),
        email,
        name,
        status,
      });
    }

    errors.push(...rowErrors);
  }

  return {
    errors: Object.freeze(errors),
    subscribers: Object.freeze([...subscribers]),
    valid: errors.length === 0,
  };
}
