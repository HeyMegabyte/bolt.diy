/**
 * @module services/coverage_summary
 * @description Lead Scanner #97 — coverage + funnel aggregation. Pure,
 * deterministic roll-up of scan coverage + lead-funnel state into the numbers
 * the owner/operator dashboard renders: ZIPs scanned (+ most-recent timestamp),
 * leads by propensity tier, contact rate, build-triggered / claimed counts, and
 * $ pipeline value. Zero-I/O — the caller resolves scan-run + lead rows from D1
 * and renders the returned summary, so this layer unit-tests with no DB.
 *
 * @packageDocumentation
 */

import type { PropensityTier } from './lead_propensity.js';
import type { LeadStage } from './lead_pipeline.js';

/** One completed scan-run row (a geo×category sweep). */
export interface ScanRunRow {
  /** ZIP (or geo key) that was swept. */
  readonly zip: string;
  /** Unix-ms timestamp the sweep ran. */
  readonly scannedAt: number;
}

/** One lead row for the funnel roll-up. */
export interface CoverageLeadRow {
  readonly tier: PropensityTier;
  readonly stage: LeadStage;
  /** Estimated pipeline value in cents (0 when unknown). */
  readonly estValueCents?: number;
}

export interface CoverageSummary {
  /** Distinct ZIPs scanned at least once. */
  readonly zipsScanned: number;
  /** Most-recent scan time across all runs (Unix ms), or null if none. */
  readonly lastScanAt: number | null;
  readonly totalLeads: number;
  /** Leads per propensity tier (A–D), always all four keys. */
  readonly byTier: Record<PropensityTier, number>;
  /** Leads that reached contacted-or-beyond ÷ total, 0–100 one decimal. */
  readonly contactRate: number;
  readonly buildTriggered: number;
  readonly claimed: number;
  /** Sum of estimated value (cents) across non-lost leads. */
  readonly pipelineValueCents: number;
}

/** Funnel stages at/after "contacted" (for contact-rate). `lost` excluded. */
const CONTACTED_PLUS: ReadonlySet<LeadStage> = new Set<LeadStage>([
  'contacted',
  'build_triggered',
  'preview_sent',
  'claimed',
]);

/**
 * Roll up scan runs + leads into the coverage/funnel {@link CoverageSummary}.
 * Pure + deterministic; empty inputs yield an all-zero summary (never throws).
 *
 * @param scanRuns - Completed scan-run rows.
 * @param leads - Lead rows (any stage/tier).
 * @returns The aggregated {@link CoverageSummary}.
 *
 * @example
 * const s = summarizeCoverage(runs, leads);
 * // → { zipsScanned: 12, contactRate: 41.7, claimed: 3, ... }
 */
export function summarizeCoverage(
  scanRuns: readonly ScanRunRow[],
  leads: readonly CoverageLeadRow[],
): CoverageSummary {
  const zips = new Set<string>();
  let lastScanAt: number | null = null;
  for (const r of scanRuns) {
    if (r.zip) zips.add(r.zip.trim().toLowerCase());
    if (typeof r.scannedAt === 'number' && (lastScanAt == null || r.scannedAt > lastScanAt)) {
      lastScanAt = r.scannedAt;
    }
  }

  const byTier: Record<PropensityTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  let contacted = 0;
  let buildTriggered = 0;
  let claimed = 0;
  let pipelineValueCents = 0;
  for (const l of leads) {
    if (l.tier in byTier) byTier[l.tier] += 1;
    if (CONTACTED_PLUS.has(l.stage)) contacted += 1;
    if (l.stage === 'build_triggered') buildTriggered += 1;
    if (l.stage === 'claimed') claimed += 1;
    if (l.stage !== 'lost') pipelineValueCents += Math.max(0, Math.round(l.estValueCents ?? 0));
  }

  const totalLeads = leads.length;
  const contactRate = totalLeads > 0 ? Math.round((contacted / totalLeads) * 1000) / 10 : 0;

  return {
    zipsScanned: zips.size,
    lastScanAt,
    totalLeads,
    byTier,
    contactRate,
    buildTriggered,
    claimed,
    pipelineValueCents,
  };
}
