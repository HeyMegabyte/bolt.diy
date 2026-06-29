/**
 * Secretary-of-State new-filings provider for the automatic Lead Scanner.
 * Recently-incorporated businesses are the highest-intent leads (they need a
 * site NOW) but SoS records carry NO contact info → they must be enriched
 * downstream. This module parses a bulk filings feed into discovered businesses
 * + an incorporation age. See top-14 #11.
 *
 * @remarks
 * All functions are PURE (no I/O): the bulk file fetch + the per-state column
 * mapping live in the orchestrator. Ohio publishes free monthly bulk; other
 * states vary (see `docs/lead-scanner/automatic-engine.md`).
 *
 * @packageDocumentation
 */

import type { DiscoveredBusiness } from './crm_leads.js';

/** A discovered business plus SoS-specific metadata. */
export interface SosLead {
  business: DiscoveredBusiness;
  /** Whole months since incorporation at `nowMs` (null when undated). */
  incorporationAgeMonths: number | null;
}

/** Column mapping from a state's CSV header → our fields. */
export interface SosColumnMap {
  name: string;
  filingDate: string;
  address?: string;
  /** Stable filing id column (dedupe key). */
  filingId?: string;
}

/**
 * Whole months between an ISO/`YYYY-MM-DD` filing date and `nowMs`.
 *
 * @param filingDate - ISO or `YYYY-MM-DD` string.
 * @param nowMs - Current time in ms (injected for determinism).
 * @returns Whole months (≥0), or null when the date is unparseable.
 *
 * @example
 * ```ts
 * monthsSince('2026-03-28', Date.parse('2026-06-28T00:00:00Z')); // 3
 * ```
 */
export function monthsSince(filingDate: string | null | undefined, nowMs: number): number | null {
  if (!filingDate) return null;
  const t = Date.parse(filingDate);
  if (Number.isNaN(t)) return null;
  if (nowMs < t) return 0;
  // Calendar-month difference (a filing exactly N years ago = N*12 months).
  const from = new Date(t);
  const now = new Date(nowMs);
  let months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth());
  if (now.getUTCDate() < from.getUTCDate()) months -= 1; // day-of-month not yet reached
  return Math.max(0, months);
}

/** True when incorporated within `maxMonths` (default 6). */
export function isRecentlyIncorporated(ageMonths: number | null, maxMonths = 6): boolean {
  return ageMonths != null && ageMonths >= 0 && ageMonths <= maxMonths;
}

/**
 * Parse one SoS feed row (already split into a header→value record) into a
 * {@link SosLead}, or null when the business name is missing.
 *
 * @param row - Header→value record for one filing.
 * @param map - Which columns hold name/filingDate/address/filingId.
 * @param nowMs - Current time in ms (for the age calc).
 * @param stateCode - Two-letter state for provenance (e.g. 'OH').
 * @returns A {@link SosLead}, or null to skip.
 */
export function parseSosRow(
  row: Record<string, string>,
  map: SosColumnMap,
  nowMs: number,
  stateCode: string,
): SosLead | null {
  const name = row[map.name]?.trim();
  if (!name) return null;

  const filingDate = map.filingDate ? row[map.filingDate]?.trim() : undefined;
  const business: DiscoveredBusiness = { businessName: name };
  if (map.address && row[map.address]?.trim()) business.address = row[map.address].trim();
  if (map.filingId && row[map.filingId]?.trim()) {
    business.externalId = `sos_${stateCode.toLowerCase()}:${row[map.filingId].trim()}`;
  }
  return { business, incorporationAgeMonths: monthsSince(filingDate, nowMs) };
}

/**
 * Parse + filter a batch of SoS rows to the recently-incorporated leads.
 *
 * @param rows - Header→value records.
 * @param map - Column mapping.
 * @param opts - `nowMs`, `stateCode`, optional `maxMonths` (default 6).
 * @returns {@link SosLead}[] for businesses incorporated within `maxMonths`.
 */
export function selectRecentSosLeads(
  rows: ReadonlyArray<Record<string, string>>,
  map: SosColumnMap,
  opts: { nowMs: number; stateCode: string; maxMonths?: number },
): SosLead[] {
  const out: SosLead[] = [];
  for (const row of rows) {
    const lead = parseSosRow(row, map, opts.nowMs, opts.stateCode);
    if (lead && isRecentlyIncorporated(lead.incorporationAgeMonths, opts.maxMonths ?? 6)) {
      out.push(lead);
    }
  }
  return out;
}
