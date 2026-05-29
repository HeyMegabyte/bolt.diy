/**
 * @module libs/features/audit_hash_chain/service
 * @description Hash-chain service for the SOC 2 / EU-AI-Act audit ledger
 * (idea #46). Closes the `audit_hash_chain` flag.
 *
 * Design:
 *   - We do NOT modify `audit_logs`. The chain lives in a parallel
 *     `audit_log_chain` table keyed on `audit_logs.id`.
 *   - `appendEntry()` is called immediately after `writeAuditLog()` —
 *     it reads the prior `last_hash` for the org, computes
 *     `entry_hash = SHA256(prev_hash || canonicalPayload || ts)`, and
 *     inserts the chain row in a per-org monotonic sequence.
 *   - `verifyChain()` walks the org's chain, recomputes each hash, and
 *     returns the first sequence number that fails — making tampering
 *     trivially detectable on demand and via a scheduled job.
 *
 * Canonical payload format: stable JSON.stringify of an alphabetically-
 * sorted object so two implementations of the canonicaliser produce the
 * same bytes for the same input.
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne } from '../../../src/services/db.js';
import {
  GENESIS_HASH,
  type ChainEntry,
  type HashHex,
  type HashablePayload,
  type VerificationResult,
} from './schemas.js';

const encoder = new TextEncoder();

/**
 * Canonicalise an object so any JSON implementation produces identical
 * bytes for identical input. Sorts keys deterministically; null is
 * preserved; nested objects + arrays are walked.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, sortReplacer);
}

function sortReplacer(_key: string, val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val;
  const obj = val as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted;
}

/** Lowercase hex SHA-256. */
export async function sha256Hex(input: string): Promise<HashHex> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as HashHex;
}

/**
 * Build the canonical input string we hash. Format:
 *   prev_hash || '\n' || canonicalPayload || '\n' || ts
 */
export function hashInput(prev: HashHex, payload: HashablePayload): string {
  return `${prev}\n${canonicalize(payload)}\n${payload.ts}`;
}

/**
 * Fetch the most recent chain entry for an org. Returns `null` for a
 * fresh org (genesis).
 */
async function getLastEntry(
  db: D1Database,
  orgId: string,
): Promise<{ sequence: number; entry_hash: HashHex } | null> {
  const row = await dbQueryOne<{ sequence: number; entry_hash: string }>(
    db,
    `SELECT sequence, entry_hash FROM audit_log_chain
       WHERE org_id = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    [orgId],
  );
  if (!row) return null;
  return { sequence: row.sequence, entry_hash: row.entry_hash as HashHex };
}

/**
 * Append one chain entry. Idempotent on `audit_id` — if a chain row
 * for the audit already exists, we return it instead of double-inserting.
 *
 * NOTE: the per-org `sequence` uniqueness is enforced by the DB.
 * Concurrent appends on the same org are extremely rare in practice
 * (one Worker invocation per audit write) but the unique index will
 * fail loud rather than silent if races ever happen.
 */
export async function appendEntry(
  db: D1Database,
  payload: HashablePayload,
): Promise<ChainEntry> {
  // Idempotency guard
  const existing = await dbQueryOne<{
    audit_id: string;
    org_id: string;
    sequence: number;
    prev_hash: string;
    entry_hash: string;
    payload_canonical: string;
    created_at: string;
  }>(
    db,
    `SELECT audit_id, org_id, sequence, prev_hash, entry_hash, payload_canonical, created_at
       FROM audit_log_chain
       WHERE audit_id = ?
       LIMIT 1`,
    [payload.audit_id],
  );
  if (existing) {
    return {
      audit_id: existing.audit_id,
      org_id: existing.org_id,
      sequence: existing.sequence,
      prev_hash: existing.prev_hash as HashHex,
      entry_hash: existing.entry_hash as HashHex,
      payload_canonical: existing.payload_canonical,
      created_at: existing.created_at,
    };
  }

  const last = await getLastEntry(db, payload.org_id);
  const prev_hash: HashHex = last?.entry_hash ?? GENESIS_HASH;
  const sequence = (last?.sequence ?? -1) + 1;
  const canonical = canonicalize(payload);
  const entry_hash = await sha256Hex(`${prev_hash}\n${canonical}\n${payload.ts}`);
  const created_at = new Date().toISOString();

  const { error } = await dbInsert(db, 'audit_log_chain', {
    audit_id: payload.audit_id,
    org_id: payload.org_id,
    sequence,
    prev_hash,
    entry_hash,
    payload_canonical: canonical,
    created_at,
  });
  if (error) throw new Error(`Failed to append chain entry: ${error}`);

  return {
    audit_id: payload.audit_id,
    org_id: payload.org_id,
    sequence,
    prev_hash,
    entry_hash,
    payload_canonical: canonical,
    created_at,
  };
}

/**
 * Walk the chain for one org and verify integrity end-to-end. Returns
 * the first sequence that fails (if any) so the admin UI can pin-point
 * the tamper.
 */
export async function verifyChain(
  db: D1Database,
  orgId: string,
): Promise<VerificationResult> {
  const result = await dbQuery<{
    audit_id: string;
    sequence: number;
    prev_hash: string;
    entry_hash: string;
    payload_canonical: string;
  }>(
    db,
    `SELECT audit_id, sequence, prev_hash, entry_hash, payload_canonical
       FROM audit_log_chain
       WHERE org_id = ?
       ORDER BY sequence ASC`,
    [orgId],
  );
  const rows = result.data;

  if (rows.length === 0) {
    return {
      ok: true,
      entries_checked: 0,
      break_at_sequence: null,
      break_reason: null,
      last_hash: null,
    };
  }

  let expectedPrev: HashHex = GENESIS_HASH;
  let lastHash: HashHex = GENESIS_HASH;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.sequence !== i) {
      return {
        ok: false,
        entries_checked: i,
        break_at_sequence: row.sequence,
        break_reason: 'sequence_gap',
        last_hash: expectedPrev,
      };
    }
    if (row.prev_hash !== expectedPrev) {
      return {
        ok: false,
        entries_checked: i,
        break_at_sequence: row.sequence,
        break_reason: 'prev_hash_mismatch',
        last_hash: expectedPrev,
      };
    }

    // Recompute entry_hash. The payload's ts is embedded in canonical JSON;
    // we feed the canonical string back through the same hashInput shape.
    let ts: string;
    try {
      const parsed = JSON.parse(row.payload_canonical) as { ts?: unknown };
      if (typeof parsed.ts !== 'string') {
        return {
          ok: false,
          entries_checked: i,
          break_at_sequence: row.sequence,
          break_reason: 'payload_corrupt',
          last_hash: expectedPrev,
        };
      }
      ts = parsed.ts;
    } catch {
      return {
        ok: false,
        entries_checked: i,
        break_at_sequence: row.sequence,
        break_reason: 'payload_corrupt',
        last_hash: expectedPrev,
      };
    }

    const recomputed = await sha256Hex(
      `${expectedPrev}\n${row.payload_canonical}\n${ts}`,
    );
    if (recomputed !== row.entry_hash) {
      return {
        ok: false,
        entries_checked: i,
        break_at_sequence: row.sequence,
        break_reason: 'entry_hash_mismatch',
        last_hash: expectedPrev,
      };
    }

    expectedPrev = row.entry_hash as HashHex;
    lastHash = row.entry_hash as HashHex;
  }

  return {
    ok: true,
    entries_checked: rows.length,
    break_at_sequence: null,
    break_reason: null,
    last_hash: lastHash,
  };
}

/** Read the chain for an org, paginated, newest first. */
export async function listChain(
  db: D1Database,
  orgId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ChainEntry[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const result = await dbQuery<{
    audit_id: string;
    org_id: string;
    sequence: number;
    prev_hash: string;
    entry_hash: string;
    payload_canonical: string;
    created_at: string;
  }>(
    db,
    `SELECT audit_id, org_id, sequence, prev_hash, entry_hash, payload_canonical, created_at
       FROM audit_log_chain
       WHERE org_id = ?
       ORDER BY sequence DESC
       LIMIT ? OFFSET ?`,
    [orgId, limit, offset],
  );
  return result.data.map((r) => ({
    audit_id: r.audit_id,
    org_id: r.org_id,
    sequence: r.sequence,
    prev_hash: r.prev_hash as HashHex,
    entry_hash: r.entry_hash as HashHex,
    payload_canonical: r.payload_canonical,
    created_at: r.created_at,
  }));
}
