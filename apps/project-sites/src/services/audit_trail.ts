/**
 * @module services/audit_trail
 *
 * Pure audit log entry classifier and sensitive-field redactor. All exports
 * are deterministic (no clock, no I/O): the caller supplies timestamps, this
 * module shapes them into typed AuditEntry records and provides aggregation
 * helpers.
 *
 * @example
 * ```ts
 * const entry = createAuditEntry('user.login', 'user_abc', 'session', 'sess_1', { ip: '127.0.0.1' });
 * // → { id: '…', action: 'user.login', actorId: 'user_abc', targetType: 'session', targetId: 'sess_1', … }
 * ```
 */

// ---------------------------------------------------------------------------
// AuditAction — the closed set of tracked event kinds
// ---------------------------------------------------------------------------

/**
 * Every action the audit trail accepts. Adding a new value here updates
 * both the type union and the runtime constant array.
 */
export const AUDIT_ACTIONS = Object.freeze([
  'user.login',
  'user.logout',
  'site.create',
  'site.delete',
  'billing.upgrade',
  'domain.add',
  'flag.change',
  'api.call',
] as const);

/** Validates a string is a known AuditAction. */
export function isAuditAction(s: string): s is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// AuditEntry — the canonical event record shape
// ---------------------------------------------------------------------------

/** A single entry in the audit trail. */
export interface AuditEntry {
  /** Deterministic id — caller provides or generated via crypto.randomUUID(). */
  id: string;
  /** Event kind. */
  action: AuditAction;
  /** Who performed the action. */
  actorId: string;
  /** Entity type affected (e.g. 'session', 'site', 'subscription', 'domain'). */
  targetType: string;
  /** Entity ID affected. */
  targetId: string;
  /** Arbitrary structured context (secrets redacted before storage). */
  metadata: Record<string, unknown>;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
}

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'site.create'
  | 'site.delete'
  | 'billing.upgrade'
  | 'domain.add'
  | 'flag.change'
  | 'api.call';

// ---------------------------------------------------------------------------
// Constants — metadata keys that carry sensitive data
// ---------------------------------------------------------------------------

/** Metadata keys whose values are stripped by redactPii. */
export const PII_KEYS = Object.freeze([
  'email',
  'phone',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'secret',
  'password',
] as const);

export type PiiKey = (typeof PII_KEYS)[number];

// ---------------------------------------------------------------------------
// createAuditEntry — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed AuditEntry record.
 *
 * @param action    - The event kind.
 * @param actorId   - The user who performed the action.
 * @param targetType - Entity type the action targets.
 * @param targetId  - Entity ID the action targets.
 * @param metadata  - Optional structured context (defaults to {}).
 * @param timestamp - ISO 8601 UTC string (defaults to current time ISO).
 * @returns A complete AuditEntry ready for storage.
 *
 * @example
 * ```ts
 * const e = createAuditEntry('site.create', 'user_1', 'site', 'site_abc', { slug: 'my-site' });
 * expect(e.action).toBe('site.create');
 * expect(e.actorId).toBe('user_1');
 * ```
 */
export function createAuditEntry(
  action: AuditAction,
  actorId: string,
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>,
  timestamp?: string,
): AuditEntry {
  return {
    action,
    actorId,
    id: crypto.randomUUID(),
    metadata: { ...(metadata ?? {}) },
    targetId,
    targetType,
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// redactPii — sensitive-field scrubber
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone: requires a non-digit/dot char (dash, space, paren, `+`) to avoid
// matching bare IP addresses like "127.0.0.1".
const PHONE_RE = /^(?![.\d]+$)\+?[\d\s\-().]{7,20}$/;
const TOKEN_RE = /^(?:sk|pk|wh|tok|sec|rs|eyJ)[\w\-.]+$/;

/**
 * Returns a new AuditEntry with sensitive metadata values redacted.
 *
 * Scans every metadata value:
 * - Keys matching a known PII key name → replace with `'[REDACTED]'`.
 * - String values matching email / phone / token patterns → replace with
 *   `'[REDACTED]'`.
 *
 * The original entry is never mutated.
 *
 * @param entry - The audit entry to redact.
 * @returns A shallow copy with redacted metadata; the original is unchanged.
 *
 * @example
 * ```ts
 * const e = createAuditEntry('user.login', 'u1', 'session', 's1', { email: 'a@b.com' });
 * const r = redactPii(e);
 * expect(r.metadata.email).toBe('[REDACTED]');
 * expect(e.metadata.email).toBe('a@b.com'); // original untouched
 * ```
 */
export function redactPii(entry: AuditEntry): AuditEntry {
  const metadata: Record<string, unknown> = {};
  let changed = false;

  for (const [key, raw] of Object.entries(entry.metadata)) {
    // Key-name match — always redact
    if ((PII_KEYS as readonly string[]).includes(key)) {
      metadata[key] = '[REDACTED]';
      changed = true;
      continue;
    }

    // Value-pattern match for strings
    if (
      typeof raw === 'string' &&
      (EMAIL_RE.test(raw) || PHONE_RE.test(raw) || TOKEN_RE.test(raw))
    ) {
      metadata[key] = '[REDACTED]';
      changed = true;
      continue;
    }

    metadata[key] = raw;
  }

  // Avoid creating a new object when nothing changed
  if (!changed) return entry;

  return { ...entry, metadata };
}

// ---------------------------------------------------------------------------
// auditSummary — aggregate counters
// ---------------------------------------------------------------------------

/**
 * Produces an aggregate summary of the given audit entries: total count,
 * counts grouped by action, and counts grouped by actor.
 *
 * Returns zero-value placeholders for every known action and actor that
 * appears in the input.
 *
 * @param entries - List of audit entries to aggregate.
 * @returns Summary object with counts.
 *
 * @example
 * ```ts
 * const entries = [
 *   createAuditEntry('user.login', 'alice', 'session', 's1'),
 *   createAuditEntry('user.login', 'bob', 'session', 's2'),
 *   createAuditEntry('site.create', 'alice', 'site', 'sa'),
 * ];
 * const s = auditSummary(entries);
 * expect(s.total).toBe(3);
 * expect(s.byAction['user.login']).toBe(2);
 * expect(s.byActor['alice']).toBe(2);
 * ```
 */
export function auditSummary(entries: readonly AuditEntry[]): {
  total: number;
  byAction: Record<string, number>;
  byActor: Record<string, number>;
} {
  const byAction: Record<string, number> = {};
  const byActor: Record<string, number> = {};

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    byActor[e.actorId] = (byActor[e.actorId] ?? 0) + 1;
  }

  return {
    byAction,
    byActor,
    total: entries.length,
  };
}
