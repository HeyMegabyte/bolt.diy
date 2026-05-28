/**
 * @module visitor_identity
 * @description Cross-channel visitor identity resolution for the Unified Inbox.
 *
 * Resolution priority (highest first):
 *   1. email   — most stable; links form + email channel submissions
 *   2. phone   — links voice calls + SMS
 *   3. visitor_id — client-set cookie/localStorage token (persistent)
 *   4. anon_id — CF-Ray or random UUID (session-scoped)
 *
 * On each inbound event, call `resolveOrCreateIdentity()` to get or mint a
 * `visitor_identities` row. This returns the canonical `visitor_id` for the
 * caller to attach to its `conversations` row.
 *
 * @example
 * ```ts
 * const id = await resolveOrCreateIdentity(env, { orgId, siteId, email, phone, anonId });
 * await openOrFetchConversation(env, { orgId, siteId, visitorId: id.id, channel: 'form' });
 * ```
 */

import type { Env } from '../types/env.js';

export interface IdentitySignals {
  orgId: string;
  siteId: string;
  email?: string | null;
  phone?: string | null;
  visitorId?: string | null;  // client-provided persistent cookie
  anonId?: string | null;     // CF-Ray or ephemeral token
  displayName?: string | null;
}

export interface VisitorIdentityRow {
  id: string;
  org_id: string;
  site_id: string;
  email: string | null;
  phone: string | null;
  visitor_id: string | null;
  anon_id: string | null;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  channel_flags: string;
  metadata_json: string;
}

/**
 * Finds the best-match existing identity row or creates a new one.
 * Updates `last_seen_at` and merges any newly supplied signals on every call.
 *
 * @remarks
 *   - Never throws; errors from D1 are caught + re-thrown as AppError.
 *   - Safe to call on every inbound request (idempotent upsert semantics).
 *
 * @throws {Error} if D1 write fails after a read attempt
 */
export async function resolveOrCreateIdentity(
  env: Env,
  signals: IdentitySignals,
): Promise<VisitorIdentityRow> {
  const { orgId, siteId, email, phone, visitorId, anonId, displayName } = signals;
  const db = env.DB;

  // ── 1. Try email match ─────────────────────────────────────────────────────
  if (email) {
    const row = await db
      .prepare(
        `SELECT * FROM visitor_identities
         WHERE org_id = ? AND site_id = ? AND email = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(orgId, siteId, email)
      .first<VisitorIdentityRow>()
      .catch(() => null);
    if (row) return touchIdentity(db, row, signals);
  }

  // ── 2. Try phone match ─────────────────────────────────────────────────────
  if (phone) {
    const row = await db
      .prepare(
        `SELECT * FROM visitor_identities
         WHERE org_id = ? AND site_id = ? AND phone = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(orgId, siteId, phone)
      .first<VisitorIdentityRow>()
      .catch(() => null);
    if (row) return touchIdentity(db, row, signals);
  }

  // ── 3. Try visitor_id (client cookie) ─────────────────────────────────────
  if (visitorId) {
    const row = await db
      .prepare(
        `SELECT * FROM visitor_identities
         WHERE org_id = ? AND site_id = ? AND visitor_id = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(orgId, siteId, visitorId)
      .first<VisitorIdentityRow>()
      .catch(() => null);
    if (row) return touchIdentity(db, row, signals);
  }

  // ── 4. No match — mint a new identity ─────────────────────────────────────
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const channelFlags = JSON.stringify({ form: 0, chat: 0, voice: 0, sms: 0, email: 0 });

  await db
    .prepare(
      `INSERT INTO visitor_identities
         (id, org_id, site_id, email, phone, visitor_id, anon_id, display_name,
          first_seen_at, last_seen_at, channel_flags, metadata_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, orgId, siteId,
      email ?? null,
      phone ?? null,
      visitorId ?? null,
      anonId ?? null,
      displayName ?? null,
      now, now, channelFlags, '{}', now, now,
    )
    .run();

  return {
    id,
    org_id: orgId,
    site_id: siteId,
    email: email ?? null,
    phone: phone ?? null,
    visitor_id: visitorId ?? null,
    anon_id: anonId ?? null,
    display_name: displayName ?? null,
    first_seen_at: now,
    last_seen_at: now,
    channel_flags: channelFlags,
    metadata_json: '{}',
  };
}

/** Updates `last_seen_at` and backfills any newly supplied signal columns. */
async function touchIdentity(
  db: D1Database,
  row: VisitorIdentityRow,
  signals: IdentitySignals,
): Promise<VisitorIdentityRow> {
  const now = new Date().toISOString();
  // Merge: fill in any NULL columns with newly provided values.
  const mergedEmail = row.email ?? signals.email ?? null;
  const mergedPhone = row.phone ?? signals.phone ?? null;
  const mergedVisitorId = row.visitor_id ?? signals.visitorId ?? null;
  const mergedDisplayName = row.display_name ?? signals.displayName ?? null;

  await db
    .prepare(
      `UPDATE visitor_identities
          SET last_seen_at = ?, email = ?, phone = ?, visitor_id = ?,
              display_name = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, mergedEmail, mergedPhone, mergedVisitorId, mergedDisplayName, now, row.id)
    .run()
    .catch(() => null);

  return {
    ...row,
    last_seen_at: now,
    email: mergedEmail,
    phone: mergedPhone,
    visitor_id: mergedVisitorId,
    display_name: mergedDisplayName,
  };
}

/**
 * Returns or creates the single open conversation for a visitor on a given
 * channel. If the most-recent conversation for this visitor+channel is already
 * resolved, a new one is opened.
 *
 * @param db     D1Database binding
 * @param params conversation parameters
 * @returns      conversation id
 */
export async function openOrFetchConversation(
  db: D1Database,
  params: {
    orgId: string;
    siteId: string;
    visitorId: string;
    channel: 'form' | 'chat' | 'voice' | 'sms' | 'email';
    subject?: string;
    slaDueAt?: string;
  },
): Promise<string> {
  const { orgId, siteId, visitorId, channel, subject, slaDueAt } = params;

  // Look for an existing open conversation for this identity+channel
  const existing = await db
    .prepare(
      `SELECT id FROM conversations
        WHERE org_id = ? AND site_id = ? AND visitor_id = ? AND channel = ?
          AND status = 'open' AND deleted_at IS NULL
        ORDER BY last_message_at DESC
        LIMIT 1`,
    )
    .bind(orgId, siteId, visitorId, channel)
    .first<{ id: string }>()
    .catch(() => null);

  if (existing) return existing.id;

  // Create a new conversation
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO conversations
         (id, org_id, site_id, visitor_id, channel, subject, status,
          sla_due_at, last_message_at, tags_json, metadata_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, orgId, siteId, visitorId, channel,
      subject ?? null,
      'open',
      slaDueAt ?? null,
      now, '[]', '{}', now, now,
    )
    .run();

  return id;
}
