/**
 * @module services/campaign_analytics
 * @description Pure, never-throws helpers for computing per-campaign send/open/click/
 *   bounce/complaint performance stats from a flat event stream. Used by the campaign
 *   dashboard to render delivery-quality rollups and surface top-performing campaigns.
 *
 * Pure + total — no I/O, no clock. Every function returns a deterministic result from
 * its inputs alone.
 */

/** A single event in a campaign's delivery lifecycle. */
export interface CampaignEvent {
  readonly campaignId: string;
  readonly eventType: 'sent' | 'open' | 'click' | 'bounce' | 'complaint';
  readonly timestampMs: number;
}

/** Aggregated performance for a single campaign. All rates as 0–1 decimals. */
export interface CampaignStats {
  readonly campaignId: string;
  readonly sent: number;
  readonly opens: number;
  readonly clicks: number;
  readonly openRate: number;
  readonly clickRate: number;
  readonly bounceRate: number;
  readonly complaintRate: number;
}

/**
 * Fraction-computing helper that returns 0 when the divisor is 0 (prevents NaN).
 * @internal
 */
function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Aggregate a flat array of campaign events into per-campaign stats.
 *
 * Each {@link CampaignStats} counts sent/opens/clicks/bounces/complaints per
 * `campaignId` and derives the four standard email-delivery rates.
 *
 * @param events - The raw event stream (readonly, not mutated).
 * @returns One {@link CampaignStats} per distinct `campaignId` in the input,
 *   in insertion order (first seen → last).
 *
 * @example
 * aggregateCampaignStats([
 *   { campaignId:'c1', eventType:'sent', timestampMs:1 },
 *   { campaignId:'c1', eventType:'open', timestampMs:2 },
 * ])
 * // → [{ campaignId:'c1', sent:1, opens:1, clicks:0, openRate:1,
 * //       clickRate:0, bounceRate:0, complaintRate:0 }]
 */
export function aggregateCampaignStats(events: readonly CampaignEvent[]): CampaignStats[] {
  const map = new Map<
    string,
    { bounces: number; clicks: number; complaints: number; opens: number; sent: number }
  >();

  for (const ev of events) {
    let acc = map.get(ev.campaignId);
    if (!acc) {
      acc = { bounces: 0, clicks: 0, complaints: 0, opens: 0, sent: 0 };
      map.set(ev.campaignId, acc);
    }
    if (ev.eventType === 'sent') acc.sent += 1;
    else if (ev.eventType === 'open') acc.opens += 1;
    else if (ev.eventType === 'click') acc.clicks += 1;
    else if (ev.eventType === 'bounce') acc.bounces += 1;
    else if (ev.eventType === 'complaint') acc.complaints += 1;
  }

  const result: CampaignStats[] = [];
  for (const [campaignId, acc] of map) {
    const { bounces, clicks, complaints, opens, sent } = acc;
    result.push({
      bounceRate: rate(bounces, sent),
      campaignId,
      clickRate: rate(clicks, sent),
      clicks,
      complaintRate: rate(complaints, sent),
      openRate: rate(opens, sent),
      opens,
      sent,
    });
  }
  return result;
}

/**
 * Select the top-N campaigns by a given rate metric.
 *
 * Ties are broken by higher absolute sent count (more data = more stable rate).
 * When `topN` exceeds the number of campaigns available, returns all of them.
 *
 * @param stats - The full set of campaign stats (readonly, not mutated).
 * @param metric - Which rate field to rank by (`'openRate'` or `'clickRate'`).
 * @param topN - How many to return (default 10, minimum 1).
 * @returns A new array sorted descending by `metric` (ties by `sent`), length
 *   `Math.min(topN, stats.length)`.
 *
 * @example
 * topPerformers(allStats, 'openRate', 5)
 * // → top-5 campaigns by open rate
 */
export function topPerformers(
  stats: readonly CampaignStats[],
  metric: 'openRate' | 'clickRate',
  topN: number = 10,
): CampaignStats[] {
  const slice = [...stats];
  slice.sort((a, b) => {
    const diff = b[metric] - a[metric];
    return diff !== 0 ? Math.sign(diff) : b.sent - a.sent;
  });
  const count = Math.max(1, Math.min(topN, slice.length));
  return slice.slice(0, count);
}
