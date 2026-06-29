/**
 * @module services/lead_suppression
 * @description Lead Scanner #98 — auto-suppression + compliance + dedupe. Pure,
 * deterministic, never-throw filters the orchestrator (#87) runs over discovered
 * businesses BEFORE any outreach spend so we NEVER re-contact a business that has
 * already claimed a site, opted out, or hard-bounced — and never contact the same
 * business twice (dedupe on the stable `externalId`).
 *
 * All inputs are passed in (the D1/KV-backed suppression sources are resolved by
 * the caller), keeping this layer unit-testable with zero I/O.
 *
 * @packageDocumentation
 */

import type { DiscoveredBusiness } from './crm_leads.js';

/** Suppression sources, resolved by the caller from D1/KV. */
export interface SuppressionSets {
  /** External ids (place_id, etc.) of businesses already claimed/contacted. */
  readonly claimedExternalIds?: Iterable<string>;
  /** Lower-cased emails that opted out (unsubscribe / compliance). */
  readonly optedOutEmails?: Iterable<string>;
  /** Lower-cased emails that hard-bounced (from `email_suppressions`). */
  readonly bouncedEmails?: Iterable<string>;
}

/** Why a candidate was dropped (for the coverage/compliance dashboard #97). */
export type SuppressionReason = 'duplicate' | 'claimed' | 'opted_out' | 'bounced';

export interface SuppressionResult {
  /** Contactable, deduped businesses in input order. */
  readonly contactable: DiscoveredBusiness[];
  /** Count dropped per reason (the rest of the funnel's top-of-funnel honesty). */
  readonly dropped: Record<SuppressionReason, number>;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Stable identity for dedupe: prefer the explicit `externalId`, else a
 * normalized `name|address` composite (so the same business from two providers
 * collapses). Returns `''` when nothing identifying is present (never deduped).
 *
 * @param b - A discovered business.
 * @returns A lower-cased dedupe key, or `''`.
 *
 * @example
 * dedupeKey({ businessName: 'Joe’s', externalId: 'place_1' }); // 'place_1'
 */
export function dedupeKey(b: DiscoveredBusiness): string {
  const ext = norm(b.externalId);
  if (ext) return ext;
  const name = norm(b.businessName);
  const addr = norm(b.address);
  return name ? `${name}|${addr}` : '';
}

/**
 * Filter discovered businesses to the contactable set: dedupe on identity, then
 * drop claimed / opted-out / bounced. Order-preserving + deterministic; a
 * candidate with no identity is kept (can't prove it's a dup). Bounce/opt-out
 * only apply when the candidate carries that email.
 *
 * @param candidates - Discovered businesses (any provider mix).
 * @param sets - Resolved suppression sources.
 * @returns The {@link SuppressionResult} — contactable list + per-reason drops.
 *
 * @example
 * const { contactable, dropped } = filterContactable(found, {
 *   claimedExternalIds: claimed, optedOutEmails: optedOut, bouncedEmails: bounced,
 * });
 */
export function filterContactable(
  candidates: readonly DiscoveredBusiness[],
  sets: SuppressionSets = {},
): SuppressionResult {
  const claimed = new Set([...(sets.claimedExternalIds ?? [])].map(norm).filter(Boolean));
  const optedOut = new Set([...(sets.optedOutEmails ?? [])].map(norm).filter(Boolean));
  const bounced = new Set([...(sets.bouncedEmails ?? [])].map(norm).filter(Boolean));

  const seen = new Set<string>();
  const contactable: DiscoveredBusiness[] = [];
  const dropped: Record<SuppressionReason, number> = {
    duplicate: 0,
    claimed: 0,
    opted_out: 0,
    bounced: 0,
  };

  for (const b of candidates) {
    const key = dedupeKey(b);
    if (key && seen.has(key)) {
      dropped.duplicate += 1;
      continue;
    }
    const ext = norm(b.externalId);
    if (ext && claimed.has(ext)) {
      dropped.claimed += 1;
      if (key) seen.add(key);
      continue;
    }
    const email = norm(b.email);
    if (email && optedOut.has(email)) {
      dropped.opted_out += 1;
      if (key) seen.add(key);
      continue;
    }
    if (email && bounced.has(email)) {
      dropped.bounced += 1;
      if (key) seen.add(key);
      continue;
    }
    if (key) seen.add(key);
    contactable.push(b);
  }

  return { contactable, dropped };
}
