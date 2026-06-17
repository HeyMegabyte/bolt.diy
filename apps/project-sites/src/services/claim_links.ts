/**
 * Claim shortlinks — the bridge between the lead scanner (#9) and the
 * claimyour.site build flow (#1).
 *
 * @remarks
 * A scanned lead is issued a short, URL-safe token (`claimyour.site/<token>`).
 * Clicking it resolves the token back to its lead so the build session can open.
 * Token generation is pure (Web Crypto); persistence goes through the D1 helpers
 * (mockable). The `claim_links` table is migration `0568_claim_links.sql`.
 *
 * @example
 * ```ts
 * const { token } = await createClaimLink(env.DB, lead.id);          // scanner
 * const hit = await resolveLeadByShortlink(env.DB, token);           // on click
 * if (hit) await markClaimLinkClicked(env.DB, token);
 * ```
 */
import type { D1Database } from '@cloudflare/workers-types';
import { dbQueryOne, dbInsert, dbExecute } from './db.js';

const TABLE = 'claim_links';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a URL-safe base62 claim token.
 *
 * @param length - Token length (default 8 → 62^8 ≈ 2.2e14 space).
 * @returns A random `[A-Za-z0-9]{length}` string.
 */
export function generateShortToken(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** A resolved claim link. */
export interface ClaimLink {
  token: string;
  leadId: string;
}

/**
 * Create + persist a claim link for a lead.
 *
 * @param db - D1 binding.
 * @param leadId - The lead the link claims.
 * @param token - Optional explicit token (else a fresh one is generated).
 * @returns The created {@link ClaimLink}.
 */
export async function createClaimLink(
  db: D1Database,
  leadId: string,
  token?: string,
): Promise<ClaimLink> {
  const tok = token ?? generateShortToken();
  await dbInsert(db, TABLE, { token: tok, lead_id: leadId });
  return { token: tok, leadId };
}

/**
 * Resolve a shortlink token back to its lead.
 *
 * @param db - D1 binding.
 * @param token - The claim token from the URL.
 * @returns The {@link ClaimLink} or `null` when unknown.
 */
export async function resolveLeadByShortlink(
  db: D1Database,
  token: string,
): Promise<ClaimLink | null> {
  const row = await dbQueryOne<{ token: string; lead_id: string }>(
    db,
    `SELECT token, lead_id FROM ${TABLE} WHERE token = ?`,
    [token],
  );
  return row ? { token: row.token, leadId: row.lead_id } : null;
}

/**
 * Record a click on a claim link (click attribution). Best-effort increment.
 *
 * @param db - D1 binding.
 * @param token - The clicked token.
 */
export async function markClaimLinkClicked(db: D1Database, token: string): Promise<void> {
  await dbExecute(
    db,
    `UPDATE ${TABLE} SET click_count = click_count + 1, clicked_at = datetime('now') WHERE token = ?`,
    [token],
  );
}
