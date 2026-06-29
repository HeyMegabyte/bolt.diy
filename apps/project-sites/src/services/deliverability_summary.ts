/**
 * @module services/deliverability_summary
 * @description LM23 — deliverability dashboard rollup. Aggregates bounce and
 * complaint suppression rows into the rates and breakdowns a /admin health
 * panel renders (total sent, bounce/complaint %, top reasons, 30d trend).
 * Pure + zero-I/O: the caller queries `email_suppressions` rows and sends stats;
 * this layer is the deterministic math. Never throws.
 *
 * @packageDocumentation
 */

export interface SuppressionRow {
  readonly reason: 'bounce' | 'complaint' | string;
  readonly subType?: string | null; // 'Permanent' / 'Transient' / etc.
  readonly createdAtMs: number; // Unix ms
}

export interface DeliverabilityCounts {
  readonly sent: number;
  readonly bounces: number;
  readonly complaints: number;
  readonly bounceRate: number; // 0–100, one decimal
  readonly complaintRate: number;
  /** Top bounce subtypes, sorted by count descending. */
  readonly bounceBreakdown: Readonly<Record<string, number>>;
  /** Top complaint subtypes (if available). */
  readonly complaintBreakdown: Readonly<Record<string, number>>;
}

export interface TrendPoint {
  readonly day: string; // YYYY-MM-DD
  readonly sent: number;
  readonly bounces: number;
  readonly complaints: number;
}

const DAY = 24 * 60 * 60 * 1000;

export function aggregateDeliverability(
  suppressions: readonly SuppressionRow[],
  totalSent: number,
): DeliverabilityCounts {
  const list = Array.isArray(suppressions) ? suppressions : [];
  const sent = Math.max(0, Math.round(totalSent));
  let bounces = 0;
  let complaints = 0;
  const bounceMap = new Map<string, number>();
  const complaintMap = new Map<string, number>();

  for (const r of list) {
    if (!r || !r.reason) continue;
    if (r.reason === 'bounce') {
      bounces++;
      const kind = (r.subType ?? 'unknown').trim() || 'unknown';
      bounceMap.set(kind, (bounceMap.get(kind) ?? 0) + 1);
    } else if (r.reason === 'complaint') {
      complaints++;
      const kind = (r.subType ?? 'unknown').trim() || 'unknown';
      complaintMap.set(kind, (complaintMap.get(kind) ?? 0) + 1);
    }
  }

  const bounceRate = sent > 0 ? Math.round((bounces / sent) * 1000) / 10 : 0;
  const complaintRate = sent > 0 ? Math.round((complaints / sent) * 1000) / 10 : 0;

  return {
    sent,
    bounces,
    complaints,
    bounceRate,
    complaintRate,
    bounceBreakdown: Object.fromEntries([...bounceMap.entries()].sort((a, b) => b[1] - a[1])),
    complaintBreakdown: Object.fromEntries([...complaintMap.entries()].sort((a, b) => b[1] - a[1])),
  };
}

export function dailyTrend(
  suppressions: readonly SuppressionRow[],
  sendsByDay: Readonly<Record<string, number>>, // YYYY-MM-DD → count
  windowDays = 30,
): TrendPoint[] {
  const list = Array.isArray(suppressions) ? suppressions : [];
  const days: Record<string, { sent: number; bounces: number; complaints: number }> = {};
  const nowMs = Date.now();
  const cutoff = nowMs - windowDays * DAY;

  for (const r of list) {
    if (!r || typeof r.createdAtMs !== 'number' || r.createdAtMs < cutoff) continue;
    const d = new Date(r.createdAtMs).toISOString().slice(0, 10);
    const pt = (days[d] ??= { sent: 0, bounces: 0, complaints: 0 });
    if (r.reason === 'bounce') pt.bounces++;
    else if (r.reason === 'complaint') pt.complaints++;
  }

  for (const [d, count] of Object.entries(sendsByDay ?? {})) {
    (days[d] ??= { sent: 0, bounces: 0, complaints: 0 }).sent += Math.max(0, Math.round(count));
  }

  return Object.entries(days)
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
