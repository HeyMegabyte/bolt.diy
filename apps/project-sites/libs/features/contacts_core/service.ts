/**
 * @module libs/features/contacts_core/service
 * @description Business logic for Contacts Core (CRM). Owns the shared
 * `contacts` table so every capture surface dedupes into one person entity.
 *
 * The cross-module write contract is {@link recordContact} — other feature
 * modules import THIS function rather than touching the table directly, which
 * is what keeps de-stubbing synchronous (one schema, one dedupe rule).
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import {
  ContactSchema,
  UpsertContactSchema,
  type Contact,
  type UpsertContactInput,
  type ListContactsQuery,
} from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'contacts_core';

/** Shape of a raw D1 row from the `contacts` table. */
interface ContactRow {
  id: string;
  org_id: string;
  site_id: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  source: string;
  tags: string;
  metadata: string;
  consent_email: number;
  consent_sms: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/** Parse a JSON column defensively — never throw on a bad row. */
function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Map a raw D1 row to a validated {@link Contact}. */
export function rowToContact(row: ContactRow): Contact {
  return ContactSchema.parse({
    id: row.id,
    orgId: row.org_id,
    siteId: row.site_id,
    email: row.email,
    phone: row.phone,
    name: row.name,
    source: row.source,
    tags: safeJson<string[]>(row.tags, []),
    metadata: safeJson<Record<string, unknown>>(row.metadata, {}),
    consentEmail: row.consent_email === 1,
    consentSms: row.consent_sms === 1,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Find an existing contact id for the dedupe key (org + email, else org + phone). */
async function findExistingId(
  db: D1Database,
  orgId: string,
  email: string | undefined,
  phone: string | undefined,
): Promise<string | null> {
  if (email) {
    const { data } = await dbQuery<{ id: string }>(
      db,
      `SELECT id FROM contacts
       WHERE org_id = ? AND lower(email) = lower(?) AND deleted_at IS NULL LIMIT 1`,
      [orgId, email],
    );
    if (data[0]) return data[0].id;
  }
  if (phone) {
    const { data } = await dbQuery<{ id: string }>(
      db,
      `SELECT id FROM contacts
       WHERE org_id = ? AND phone = ? AND deleted_at IS NULL LIMIT 1`,
      [orgId, phone],
    );
    if (data[0]) return data[0].id;
  }
  return null;
}

/**
 * Upsert a contact, deduping by (org, email) then (org, phone). The cross-module
 * write contract — call this from any capture surface.
 *
 * @remarks Merges non-null fields on an existing row, bumps `last_seen_at`, and
 * unions `tags`. Consent flags only ever flip 0→1 (a later capture never revokes
 * an earlier opt-in here).
 * @param env   - Worker env (uses `env.DB`).
 * @param input - Validated against {@link UpsertContactSchema}.
 * @returns The materialized {@link Contact}.
 * @throws ZodError when `input` is invalid (no email AND no phone).
 * @example
 * ```ts
 * await recordContact(env, { orgId, email: 'a@b.com', source: 'inbox', name: 'Ada' });
 * ```
 */
export async function recordContact(env: Env, input: UpsertContactInput): Promise<Contact> {
  const v = UpsertContactSchema.parse(input);
  const db = env.DB;
  const existingId = await findExistingId(db, v.orgId, v.email, v.phone);

  if (existingId) {
    const { data } = await dbQuery<ContactRow>(db, `SELECT * FROM contacts WHERE id = ?`, [
      existingId,
    ]);
    const current = data[0] ? rowToContact(data[0]) : null;
    const mergedTags = Array.from(new Set([...(current?.tags ?? []), ...(v.tags ?? [])]));
    // Object spread of undefined is a no-op, so no `?? {}` fallback needed here
    // (unlike the array spread above, where `...undefined` would throw).
    const mergedMeta = { ...current?.metadata, ...v.metadata };

    await dbExecute(
      db,
      `UPDATE contacts SET
         site_id       = COALESCE(?, site_id),
         email         = COALESCE(?, email),
         phone         = COALESCE(?, phone),
         name          = COALESCE(?, name),
         tags          = ?,
         metadata      = ?,
         consent_email = CASE WHEN ? = 1 THEN 1 ELSE consent_email END,
         consent_sms   = CASE WHEN ? = 1 THEN 1 ELSE consent_sms END,
         last_seen_at  = datetime('now'),
         updated_at    = datetime('now')
       WHERE id = ?`,
      [
        v.siteId ?? null,
        v.email ?? null,
        v.phone ?? null,
        v.name ?? null,
        JSON.stringify(mergedTags),
        JSON.stringify(mergedMeta),
        v.consentEmail ? 1 : 0,
        v.consentSms ? 1 : 0,
        existingId,
      ],
    );
    const { data: after } = await dbQuery<ContactRow>(db, `SELECT * FROM contacts WHERE id = ?`, [
      existingId,
    ]);
    return rowToContact(after[0]!);
  }

  const id = crypto.randomUUID();
  await dbExecute(
    db,
    `INSERT INTO contacts
       (id, org_id, site_id, email, phone, name, source, tags, metadata, consent_email, consent_sms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      v.orgId,
      v.siteId ?? null,
      v.email ?? null,
      v.phone ?? null,
      v.name ?? null,
      v.source,
      JSON.stringify(v.tags ?? []),
      JSON.stringify(v.metadata ?? {}),
      v.consentEmail ? 1 : 0,
      v.consentSms ? 1 : 0,
    ],
  );
  const { data } = await dbQuery<ContactRow>(db, `SELECT * FROM contacts WHERE id = ?`, [id]);
  return rowToContact(data[0]!);
}

/** Fetch one org-scoped contact by id, or null. */
export async function getContact(env: Env, orgId: string, id: string): Promise<Contact | null> {
  const { data } = await dbQuery<ContactRow>(
    env.DB,
    `SELECT * FROM contacts WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
  return data[0] ? rowToContact(data[0]) : null;
}

/** List org-scoped contacts with optional site/source/search filters + paging. */
export async function listContacts(
  env: Env,
  orgId: string,
  q: ListContactsQuery,
): Promise<{ contacts: Contact[]; total: number }> {
  const where: string[] = ['org_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [orgId];
  if (q.siteId) {
    where.push('site_id = ?');
    params.push(q.siteId);
  }
  if (q.source) {
    where.push('source = ?');
    params.push(q.source);
  }
  if (q.search) {
    where.push('(email LIKE ? OR name LIKE ? OR phone LIKE ?)');
    const like = `%${q.search}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');

  const { data: countRows } = await dbQuery<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM contacts WHERE ${whereSql}`,
    params,
  );
  const total = countRows[0]?.n ?? 0;

  const { data } = await dbQuery<ContactRow>(
    env.DB,
    `SELECT * FROM contacts WHERE ${whereSql} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
    [...params, q.limit, q.offset],
  );
  return { contacts: data.map(rowToContact), total };
}

/** Soft-delete an org-scoped contact. */
export async function deleteContact(env: Env, orgId: string, id: string): Promise<boolean> {
  const { error } = await dbExecute(
    env.DB,
    `UPDATE contacts SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
  return !error;
}
