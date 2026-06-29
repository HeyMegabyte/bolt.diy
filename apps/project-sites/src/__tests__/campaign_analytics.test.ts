/**
 * @module __tests__/campaign_analytics
 * @description Coverage for the pure campaign-analytics rollup helpers. Every stat
 *   helper is exercised: happy path, edge cases (empty / single / no-sends), and the
 *   sort+top-N contract for `topPerformers`.
 */

import type { CampaignEvent, CampaignStats } from '../services/campaign_analytics.js';

import { aggregateCampaignStats, topPerformers } from '../services/campaign_analytics.js';

describe('aggregateCampaignStats', () => {
  it('returns an empty array for an empty event list', () => {
    expect(aggregateCampaignStats([])).toEqual([]);
  });

  it('aggregates a single campaign with one of each event type', () => {
    const events: CampaignEvent[] = [
      { campaignId: 'c1', eventType: 'sent', timestampMs: 1 },
      { campaignId: 'c1', eventType: 'open', timestampMs: 2 },
      { campaignId: 'c1', eventType: 'click', timestampMs: 3 },
      { campaignId: 'c1', eventType: 'bounce', timestampMs: 4 },
      { campaignId: 'c1', eventType: 'complaint', timestampMs: 5 },
    ];
    const result = aggregateCampaignStats(events);
    expect(result).toHaveLength(1);
    expect(result[0].campaignId).toBe('c1');
    expect(result[0].sent).toBe(1);
    expect(result[0].opens).toBe(1);
    expect(result[0].clicks).toBe(1);
    expect(result[0].openRate).toBe(1);
    expect(result[0].clickRate).toBe(1);
    expect(result[0].bounceRate).toBe(1);
    expect(result[0].complaintRate).toBe(1);
  });

  it('separates multiple campaigns', () => {
    const events: CampaignEvent[] = [
      { campaignId: 'alpha', eventType: 'sent', timestampMs: 1 },
      { campaignId: 'alpha', eventType: 'open', timestampMs: 2 },
      { campaignId: 'beta', eventType: 'sent', timestampMs: 3 },
      { campaignId: 'beta', eventType: 'bounce', timestampMs: 4 },
    ];
    const result = aggregateCampaignStats(events);

    expect(result).toHaveLength(2);

    const alpha = result.find((s) => s.campaignId === 'alpha')!;
    expect(alpha.sent).toBe(1);
    expect(alpha.opens).toBe(1);
    expect(alpha.openRate).toBe(1);

    const beta = result.find((s) => s.campaignId === 'beta')!;
    expect(beta.sent).toBe(1);
    expect(beta.bounceRate).toBe(1);
    expect(beta.openRate).toBe(0);
    expect(beta.clickRate).toBe(0);
  });

  it('computes partial rates correctly (2 opens / 4 sent = 0.5)', () => {
    const events: CampaignEvent[] = [
      { campaignId: 'c1', eventType: 'sent', timestampMs: 1 },
      { campaignId: 'c1', eventType: 'sent', timestampMs: 2 },
      { campaignId: 'c1', eventType: 'sent', timestampMs: 3 },
      { campaignId: 'c1', eventType: 'sent', timestampMs: 4 },
      { campaignId: 'c1', eventType: 'open', timestampMs: 5 },
      { campaignId: 'c1', eventType: 'open', timestampMs: 6 },
      { campaignId: 'c1', eventType: 'click', timestampMs: 7 },
    ];
    const result = aggregateCampaignStats(events);
    expect(result).toHaveLength(1);
    expect(result[0].sent).toBe(4);
    expect(result[0].opens).toBe(2);
    expect(result[0].clicks).toBe(1);
    expect(result[0].openRate).toBeCloseTo(0.5);
    expect(result[0].clickRate).toBeCloseTo(0.25);
  });

  it('returns rate=0 when no sent events exist (no division by zero)', () => {
    const events: CampaignEvent[] = [
      { campaignId: 'c1', eventType: 'open', timestampMs: 1 },
      { campaignId: 'c1', eventType: 'click', timestampMs: 2 },
    ];
    const result = aggregateCampaignStats(events);
    expect(result[0].sent).toBe(0);
    expect(result[0].openRate).toBe(0);
    expect(result[0].clickRate).toBe(0);
    expect(result[0].bounceRate).toBe(0);
    expect(result[0].complaintRate).toBe(0);
  });

  it('preserves insertion order of distinct campaign IDs', () => {
    const events: CampaignEvent[] = [
      { campaignId: 'z-first', eventType: 'sent', timestampMs: 1 },
      { campaignId: 'a-second', eventType: 'sent', timestampMs: 2 },
      { campaignId: 'm-third', eventType: 'sent', timestampMs: 3 },
    ];
    const result = aggregateCampaignStats(events);
    expect(result.map((s) => s.campaignId)).toEqual(['z-first', 'a-second', 'm-third']);
  });
});

describe('topPerformers', () => {
  const stats: CampaignStats[] = [
    {
      bounceRate: 0.05,
      campaignId: 'high-open',
      clickRate: 0.1,
      clicks: 10,
      complaintRate: 0,
      openRate: 0.9,
      opens: 90,
      sent: 100,
    },
    {
      bounceRate: 0.1,
      campaignId: 'mid-open',
      clickRate: 0.15,
      clicks: 30,
      complaintRate: 0.01,
      openRate: 0.5,
      opens: 100,
      sent: 200,
    },
    {
      bounceRate: 0.2,
      campaignId: 'low-open',
      clickRate: 0.04,
      clicks: 2,
      complaintRate: 0,
      openRate: 0.1,
      opens: 5,
      sent: 50,
    },
  ];

  it('returns top-N by openRate descending', () => {
    const top = topPerformers(stats, 'openRate', 2);
    expect(top).toHaveLength(2);
    expect(top[0].campaignId).toBe('high-open');
    expect(top[1].campaignId).toBe('mid-open');
  });

  it('returns top-N by clickRate descending', () => {
    const top = topPerformers(stats, 'clickRate', 2);
    expect(top).toHaveLength(2);
    expect(top[0].campaignId).toBe('mid-open');
    expect(top[1].campaignId).toBe('high-open');
  });

  it('returns all stats when topN exceeds the array length', () => {
    const top = topPerformers(stats, 'openRate', 999);
    expect(top).toHaveLength(3);
  });

  it('returns at least one result even when topN is less than 1', () => {
    const top = topPerformers(stats, 'openRate', -5);
    expect(top).toHaveLength(1);
    expect(top[0].campaignId).toBe('high-open');
  });

  it('returns empty array when the stats array is empty', () => {
    const top = topPerformers([], 'openRate', 5);
    expect(top).toEqual([]);
  });

  it('breaks ties by higher sent count', () => {
    const tied: CampaignStats[] = [
      {
        bounceRate: 0,
        campaignId: 'few-sends',
        clickRate: 0.1,
        clicks: 1,
        complaintRate: 0,
        openRate: 0.5,
        opens: 5,
        sent: 10,
      },
      {
        bounceRate: 0,
        campaignId: 'many-sends',
        clickRate: 0.1,
        clicks: 10,
        complaintRate: 0,
        openRate: 0.5,
        opens: 50,
        sent: 100,
      },
    ];
    const top = topPerformers(tied, 'openRate', 2);
    expect(top[0].campaignId).toBe('many-sends');
    expect(top[1].campaignId).toBe('few-sends');
  });

  it('defaults topN to 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      bounceRate: 0,
      campaignId: `c${i}`,
      clickRate: 0,
      clicks: 0,
      complaintRate: 0,
      openRate: (i + 1) / 100,
      opens: i + 1,
      sent: 100,
    }));
    expect(topPerformers(many, 'openRate')).toHaveLength(10);
  });
});
