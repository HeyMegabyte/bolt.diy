/**
 * Lead Scanner orchestrator core — composes discovery → enrichment → scoring →
 * CRM sink for one scan profile. The KEYSTONE that makes the scanner automatic
 * (top-14 #3). See `docs/lead-scanner/automatic-engine.md`.
 *
 * @remarks
 * Pure orchestration via dependency injection — NO network/D1/env here. The real
 * provider fetches (OSM/Places/SoS), email enrichment (`email_enrich`), and CRM
 * upsert (`crm_leads.upsertLeadToCrm`) are injected by the deploy-gated scan
 * route/cron, so this brain is fully unit-testable. It builds {@link LeadSignals}
 * per candidate, ranks them ({@link rankLeads}), caps to the profile budget, and
 * sinks the best — never throws (a per-lead failure is tallied, not fatal).
 *
 * @packageDocumentation
 */

import type { DiscoveredBusiness } from './crm_leads.js';
import { leadToCrmCompany, type CrmUpsertResult } from './crm_leads.js';
import {
  payPropensity,
  type AddressSource,
  type EmailSource,
  type LeadSignals,
  type PropensityTier,
} from './lead_propensity.js';
import { rankLeads } from './lead_propensity.js';

/** A discovered business plus optional provider-supplied signal hints. */
export type ScanCandidate = DiscoveredBusiness & {
  /** Extra signals the provider knows (incorporation age, source count, address provenance). */
  signalHints?: Partial<LeadSignals> & { addressSource?: AddressSource };
};

/** A scan profile (the editable "what to hunt" config, top-14 #5). */
export interface ScanProfile {
  /** Provenance label written to the CRM, e.g. 'google_places' | 'osm' | 'sos_oh'. */
  source: string;
  /** Default address provenance for this provider when a candidate has an address. */
  addressSource?: AddressSource;
  /** Cap the number of leads sunk per run (budget guard). */
  maxLeads?: number;
}

/** Injected effects (all async, never-throw expected). */
export interface ScanDeps {
  /** Discover candidate siteless businesses for the profile. */
  discover: (profile: ScanProfile) => Promise<ScanCandidate[]>;
  /** Optional email enrichment per candidate (returns the resolved source). */
  enrich?: (c: ScanCandidate) => Promise<{ email?: string | null; emailSource?: EmailSource }>;
  /** Sink one scored lead into the CRM. */
  sink: (candidate: ScanCandidate, signals: LeadSignals) => Promise<CrmUpsertResult>;
}

/** Tally of a scan run. */
export interface ScanRunSummary {
  discovered: number;
  considered: number;
  upserted: number;
  skipped: number;
  errors: number;
  byTier: Record<PropensityTier, number>;
}

/**
 * Build {@link LeadSignals} for a candidate. Providers only return siteless
 * businesses, so `hasWebsite` is false. Merges provider hints over derived
 * defaults; an enriched email source overrides a hinted/listing one.
 */
export function candidateToSignals(
  c: ScanCandidate,
  profile: ScanProfile,
  enrichedEmailSource?: EmailSource,
): LeadSignals {
  const hints = c.signalHints ?? {};
  const addressSource: AddressSource =
    hints.addressSource ?? (c.address ? (profile.addressSource ?? 'listing') : null);
  const emailSource: EmailSource =
    enrichedEmailSource ?? hints.emailSource ?? (c.email ? 'listing' : null);

  const signals: LeadSignals = {
    hasWebsite: false,
    emailSource,
    addressSource,
    hasPhone: Boolean(c.phone),
    ...(c.category ? { category: c.category } : {}),
  };
  if (hints.incorporationAgeMonths != null) {
    signals.incorporationAgeMonths = hints.incorporationAgeMonths;
  }
  if (hints.sourceCount != null) signals.sourceCount = hints.sourceCount;
  if (hints.claimedListing != null) signals.claimedListing = hints.claimedListing;
  if (hints.socialOnly != null) signals.socialOnly = hints.socialOnly;
  if (hints.reviewCount != null) signals.reviewCount = hints.reviewCount;
  if (hints.rating != null) signals.rating = hints.rating;
  return signals;
}

/**
 * Run one scan profile end-to-end: discover → enrich → score → rank → cap → sink.
 *
 * @param deps    - Injected discover/enrich/sink effects.
 * @param profile - The scan profile.
 * @returns A {@link ScanRunSummary}. Never throws.
 *
 * @example
 * ```ts
 * const summary = await runScan(
 *   { discover, enrich, sink: (c, s) => upsertLeadToCrm(env, leadToCrmCompany(c, s, profile.source)) },
 *   { source: 'osm', addressSource: 'places', maxLeads: 50 },
 * );
 * ```
 */
export async function runScan(deps: ScanDeps, profile: ScanProfile): Promise<ScanRunSummary> {
  const summary: ScanRunSummary = {
    discovered: 0,
    considered: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
    byTier: { A: 0, B: 0, C: 0, D: 0 },
  };

  let candidates: ScanCandidate[];
  try {
    candidates = await deps.discover(profile);
  } catch {
    return summary; // discovery failure → empty run, never throw
  }
  summary.discovered = candidates.length;

  // Build signals (with optional enrichment) for each candidate.
  const scored: Array<{ candidate: ScanCandidate; signals: LeadSignals }> = [];
  for (const c of candidates) {
    let enrichedSource: EmailSource | undefined;
    if (deps.enrich) {
      try {
        const e = await deps.enrich(c);
        enrichedSource = e.emailSource ?? undefined;
        if (e.email && !c.email) c.email = e.email;
      } catch {
        enrichedSource = undefined;
      }
    }
    scored.push({ candidate: c, signals: candidateToSignals(c, profile, enrichedSource) });
  }

  // Rank most-likely-to-pay first, then cap to the profile budget.
  const ranked = rankLeads(scored.map((s) => s.signals));
  const order = new Map(scored.map((s, i) => [s.signals, i] as const));
  const orderedPairs = ranked.map((r) => scored[order.get(r.lead)!]);
  const cap = profile.maxLeads ?? orderedPairs.length;

  for (const pair of orderedPairs.slice(0, cap)) {
    summary.considered++;
    const tier = payPropensity(pair.signals).tier;
    summary.byTier[tier]++;
    try {
      const res = await deps.sink(pair.candidate, pair.signals);
      if (res.ok) summary.upserted++;
      else if (res.skipped) summary.skipped++;
      else summary.errors++;
    } catch {
      summary.errors++;
    }
  }

  return summary;
}

/**
 * Convenience sink factory: maps (candidate, signals) → CRM payload → upsert.
 * The route/cron passes its bound `upsertLeadToCrm(env, payload)`.
 *
 * @param source - Provenance label for the CRM payload.
 * @param upsert - Bound upsert (e.g. `(p) => upsertLeadToCrm(env, p)`).
 */
export function crmSink(
  source: string,
  upsert: (payload: ReturnType<typeof leadToCrmCompany>) => Promise<CrmUpsertResult>,
): ScanDeps['sink'] {
  return (candidate, signals) => upsert(leadToCrmCompany(candidate, signals, source));
}
