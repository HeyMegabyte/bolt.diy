/**
 * Unit tests for the Lead Scanner orchestrator core. Fully DI — no network/D1.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  candidateToSignals,
  runScan,
  crmSink,
  type ScanCandidate,
  type ScanDeps,
  type ScanProfile,
} from '../services/lead_scan_orchestrator.js';

const profile: ScanProfile = { source: 'osm', addressSource: 'places', maxLeads: 10 };

const okSink = jest.fn(async () => ({ ok: true, skipped: false, id: 'co_1' }));

describe('lead_scan_orchestrator — candidateToSignals', () => {
  it('marks hasWebsite false and derives address/email source', () => {
    const s = candidateToSignals(
      { businessName: 'A', address: '1 Main', email: 'a@a.com', category: 'plumber' },
      profile,
    );
    expect(s.hasWebsite).toBe(false);
    expect(s.addressSource).toBe('places'); // from profile default
    expect(s.emailSource).toBe('listing'); // candidate had an email
    expect(s.category).toBe('plumber');
  });

  it('enriched email source overrides the default', () => {
    const s = candidateToSignals({ businessName: 'A' }, profile, 'guessed_mx');
    expect(s.emailSource).toBe('guessed_mx');
  });

  it('merges provider signal hints (incorporation age, source count)', () => {
    const c: ScanCandidate = {
      businessName: 'New Co',
      signalHints: { incorporationAgeMonths: 2, sourceCount: 3, addressSource: 'sos' },
    };
    const s = candidateToSignals(c, profile);
    expect(s.incorporationAgeMonths).toBe(2);
    expect(s.sourceCount).toBe(3);
    expect(s.addressSource).toBe('sos'); // hint wins over profile default
  });

  it('null sources when nothing is known', () => {
    const s = candidateToSignals({ businessName: 'Bare' }, profile);
    expect(s.addressSource).toBeNull();
    expect(s.emailSource).toBeNull();
  });
});

describe('lead_scan_orchestrator — runScan', () => {
  it('discovers, scores, ranks, and sinks; tallies by tier', async () => {
    const candidates: ScanCandidate[] = [
      {
        businessName: 'Dream',
        address: '1 St',
        email: 'd@d.com',
        category: 'dentist',
        signalHints: {
          reviewCount: 30,
          rating: 4.8,
          incorporationAgeMonths: 3,
          claimedListing: true,
        },
      },
      { businessName: 'Bare' }, // unreachable
    ];
    const sink = jest.fn(async () => ({ ok: true, skipped: false, id: 'x' }));
    const summary = await runScan({ discover: async () => candidates, sink }, profile);
    expect(summary.discovered).toBe(2);
    expect(summary.considered).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.byTier.A).toBeGreaterThanOrEqual(1);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('respects maxLeads (sinks only the top N ranked)', async () => {
    const candidates: ScanCandidate[] = [
      { businessName: 'Reachable', email: 'r@r.com', category: 'plumber' },
      { businessName: 'Bare1' },
      { businessName: 'Bare2' },
    ];
    const sink = jest.fn(async () => ({ ok: true, skipped: false, id: 'x' }));
    const summary = await runScan(
      { discover: async () => candidates, sink },
      { source: 'osm', maxLeads: 1 },
    );
    expect(summary.discovered).toBe(3);
    expect(summary.considered).toBe(1);
    expect(summary.upserted).toBe(1);
    // The reachable (higher-propensity) lead is the one sunk.
    expect(sink.mock.calls[0][0]).toMatchObject({ businessName: 'Reachable' });
  });

  it('tallies skipped (CRM dark) and errors separately', async () => {
    const candidates: ScanCandidate[] = [
      { businessName: 'A', email: 'a@a.com' },
      { businessName: 'B', email: 'b@b.com' },
    ];
    let call = 0;
    const sink = jest.fn(async () => {
      call++;
      return call === 1
        ? { ok: false, skipped: true }
        : { ok: false, skipped: false, status: 500, error: 'HTTP 500' };
    });
    const summary = await runScan({ discover: async () => candidates, sink }, { source: 'osm' });
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.upserted).toBe(0);
  });

  it('discovery failure → empty summary, never throws', async () => {
    const summary = await runScan(
      {
        discover: async () => {
          throw new Error('overpass down');
        },
        sink: okSink,
      },
      profile,
    );
    expect(summary).toMatchObject({ discovered: 0, considered: 0, upserted: 0 });
  });

  it('runs enrichment and carries the resolved email into the sink', async () => {
    const candidates: ScanCandidate[] = [{ businessName: 'NeedsEmail' }];
    const enrich = jest.fn(async () => ({
      email: 'info@needsemail.com',
      emailSource: 'guessed_mx' as const,
    }));
    const sink = jest.fn(async (c: ScanCandidate) => {
      expect(c.email).toBe('info@needsemail.com');
      return { ok: true, skipped: false, id: 'x' };
    });
    const summary = await runScan(
      { discover: async () => candidates, enrich, sink },
      { source: 'osm' },
    );
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(summary.upserted).toBe(1);
  });
});

describe('lead_scan_orchestrator — crmSink', () => {
  it('maps candidate+signals to a payload and calls upsert', async () => {
    const upsert = jest.fn(async () => ({ ok: true, skipped: false, id: 'co_9' }));
    const sink = crmSink('osm', upsert as never);
    const res = await sink(
      { businessName: 'Z', category: 'salon' },
      candidateToSignals({ businessName: 'Z', category: 'salon' }, profile),
    );
    expect(res.ok).toBe(true);
    const payload = upsert.mock.calls[0][0] as { name: string; source: string };
    expect(payload.name).toBe('Z');
    expect(payload.source).toBe('osm');
  });
});
