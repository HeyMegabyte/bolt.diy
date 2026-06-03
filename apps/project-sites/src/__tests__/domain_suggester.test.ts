/**
 * domain_suggester service — unit coverage (convergence r8).
 *
 * Exercises the real branches of `suggestDomains`: context-miss short circuit,
 * candidate generation → normalization → RDAP availability filter → dedup vs
 * excludeDomains → enrichment + anti-slop re-roll → deterministic fallback,
 * plus pricing / inline-register / Porkbun-fallback wiring and edge inputs.
 *
 * Collaborators are mocked: `profile_context` (business signals),
 * `rdap_availability` (availability probes), `cf_registrar` (price + TLD
 * support). `env.AI.run` and the KV/R2 bindings are stubbed on the Env. No
 * real network/AI calls.
 */

jest.mock('../services/profile_context.js', () => ({
  gatherProfileContext: jest.fn(),
}));
jest.mock('../services/rdap_availability.js', () => ({
  checkBatch: jest.fn(),
}));
jest.mock('../services/cf_registrar.js', () => ({
  isKnownUnsupportedTld: jest.fn(),
  porkbunFallback: jest.fn((d: string) => `https://porkbun.com/checkout/search?q=${d}`),
  staticTldPriceUsd: jest.fn(),
}));

import { suggestDomains, ANTI_SLOP_BANNED } from '../services/domain_suggester.js';
import { gatherProfileContext, type ProfileContext } from '../services/profile_context.js';
import { checkBatch, type RdapResult } from '../services/rdap_availability.js';
import {
  isKnownUnsupportedTld,
  staticTldPriceUsd,
  porkbunFallback,
} from '../services/cf_registrar.js';
import type { Env } from '../types/env.js';

const mockGather = gatherProfileContext as unknown as jest.Mock;
const mockCheckBatch = checkBatch as unknown as jest.Mock;
const mockUnsupportedTld = isKnownUnsupportedTld as unknown as jest.Mock;
const mockPrice = staticTldPriceUsd as unknown as jest.Mock;
const mockPorkbun = porkbunFallback as unknown as jest.Mock;

/** AI.run mock — set per-test to script candidate + enrichment responses. */
let aiRun: jest.Mock;

/** Build a ProfileContext stub with sensible defaults. */
function makeCtx(over: Partial<ProfileContext> = {}): ProfileContext {
  return {
    site_id: 'site-1',
    slug: 'acme-salon',
    business_name: 'Acme Salon',
    business_type: 'salon',
    recent_keywords: ['haircut', 'color'],
    generated_at: new Date().toISOString(),
    ...over,
  } as ProfileContext;
}

/** Minimally-typed Env stub — only what suggestDomains touches. */
function makeEnv(): Env {
  return {
    AI: { run: aiRun },
    CACHE_KV: {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    },
    SITES_BUCKET: {
      // No homepage HTML — summarizeHomepage short-circuits to undefined.
      get: jest.fn().mockResolvedValue(null),
    },
  } as unknown as Env;
}

/** RDAP result helper. */
function rdap(domain: string, available: boolean): RdapResult {
  return {
    domain,
    available,
    status: available ? 'available' : 'taken',
    source: 'rdap',
  } as RdapResult;
}

/** Wrap a JSON object as the `{ response }` envelope env.AI.run returns. */
function aiJson(obj: unknown): { response: string } {
  return { response: JSON.stringify(obj) };
}

beforeEach(() => {
  jest.clearAllMocks();
  aiRun = jest.fn();
  // Default pricing + TLD support: every TLD supported, $12/yr.
  mockUnsupportedTld.mockReturnValue(false);
  mockPrice.mockReturnValue(12);
  mockPorkbun.mockImplementation(
    (d: string) => `https://porkbun.com/checkout/search?q=${d}`,
  );
});

// ────────────────────────────────────────────────────────────
// Context short-circuit
// ────────────────────────────────────────────────────────────
describe('suggestDomains — context gate', () => {
  it('returns [] when profile context cannot be gathered', async () => {
    mockGather.mockResolvedValue(null);
    const out = await suggestDomains(makeEnv(), { siteId: 'site-x' });
    expect(out).toEqual([]);
    // Never reaches candidate generation when ctx is missing.
    expect(aiRun).not.toHaveBeenCalled();
    expect(mockCheckBatch).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// Happy path — generate, filter, enrich
// ────────────────────────────────────────────────────────────
describe('suggestDomains — happy path', () => {
  it('returns N available, enriched suggestions in AI preference order', async () => {
    mockGather.mockResolvedValue(makeCtx());

    // candidate round 1: two domains; both available.
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acmecut.com', 'acmehair.app'] }))
      // enrichment for both rows.
      .mockResolvedValueOnce(
        aiJson({
          rows: [
            { domain: 'acmecut.com', reason: 'Sharp brand match.', pitch: 'Lock it before a rival does.' },
            { domain: 'acmehair.app', reason: 'Mobile-first cue.', pitch: 'Premium app TLD signals craft.' },
          ],
        }),
      );

    mockCheckBatch.mockResolvedValue([rdap('acmecut.com', true), rdap('acmehair.app', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 2 });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      domain: 'acmecut.com',
      available: true,
      status: 'available',
      reason: 'Sharp brand match.',
      price_usd_yr: 12,
      can_register_inline: true,
    });
    expect(out[0].fallback_url).toBeUndefined();
    expect(out[1].domain).toBe('acmehair.app');
  });

  it('truncates over-long AI reason/pitch to the 60/90 char contract', async () => {
    mockGather.mockResolvedValue(makeCtx());
    const longReason = 'x'.repeat(120);
    const longPitch = 'y'.repeat(120);
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acmecut.com'] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acmecut.com', reason: longReason, pitch: longPitch }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('acmecut.com', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 1 });
    expect(out[0].reason.length).toBeLessThanOrEqual(60);
    expect(out[0].pitch.length).toBeLessThanOrEqual(90);
  });
});

// ────────────────────────────────────────────────────────────
// Availability filtering + dedup + exclusion
// ────────────────────────────────────────────────────────────
describe('suggestDomains — availability filter & dedup', () => {
  it('drops taken/unknown candidates, keeps only strictly-available', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(
        aiJson({ domains: ['takenone.com', 'freeone.io', 'unknownone.dev'] }),
      )
      // round 2 (need refill) — no fresh domains, breaks the loop.
      .mockResolvedValueOnce(aiJson({ domains: [] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'freeone.io', reason: 'Tight tech cue.', pitch: 'Grab it now.' }] }),
      );

    mockCheckBatch.mockResolvedValueOnce([
      rdap('takenone.com', false),
      rdap('freeone.io', true),
      { domain: 'unknownone.dev', available: false, status: 'unknown', source: 'rdap-error' } as RdapResult,
    ]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 3 });
    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe('freeone.io');
  });

  it('never re-emits a domain passed in excludeDomains (case-insensitive)', async () => {
    mockGather.mockResolvedValue(makeCtx());
    // AI returns one excluded + one fresh; excluded must be dropped before RDAP.
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['SkipMe.com', 'newpick.co'] }))
      .mockResolvedValueOnce(aiJson({ domains: [] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'newpick.co', reason: 'Modern shorthand.', pitch: 'Claim it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('newpick.co', true)]);

    const out = await suggestDomains(makeEnv(), {
      siteId: 'site-1',
      count: 5,
      excludeDomains: ['skipme.com'],
    });

    // RDAP only ever saw the non-excluded fresh domain.
    const probed = mockCheckBatch.mock.calls.flatMap((c) => c[1] as string[]);
    expect(probed).not.toContain('skipme.com');
    expect(out.map((s) => s.domain)).toEqual(['newpick.co']);
  });

  it('dedups already-shown domains across rounds via the seen set', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      // round 1: one fresh available domain (need > 1, so round 2 fires).
      .mockResolvedValueOnce(aiJson({ domains: ['firstpick.com'] }))
      // round 2: re-emits the round-1 pick (must be filtered) + one new domain.
      .mockResolvedValueOnce(aiJson({ domains: ['firstpick.com', 'secondpick.io'] }))
      .mockResolvedValueOnce(
        aiJson({
          rows: [
            { domain: 'firstpick.com', reason: 'Anchor.', pitch: 'Lock it.' },
            { domain: 'secondpick.io', reason: 'Tech cue.', pitch: 'Grab it.' },
          ],
        }),
      );
    mockCheckBatch.mockImplementation((_e: Env, list: string[]) =>
      Promise.resolve(list.map((d) => rdap(d, true))),
    );

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 3 });
    // Round 2 only probes the domain not already seen in round 1.
    expect(mockCheckBatch.mock.calls[1][1]).toEqual(['secondpick.io']);
    expect(out.map((s) => s.domain)).toEqual(['firstpick.com', 'secondpick.io']);
  });
});

// ────────────────────────────────────────────────────────────
// Normalization / sanitization of candidate strings
// ────────────────────────────────────────────────────────────
describe('suggestDomains — candidate normalization', () => {
  it('strips protocol+path, lowercases, and rejects malformed/over-long names', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(
        aiJson({
          domains: [
            'https://Acme.com/pricing', // → acme.com (valid)
            'no-tld-here', // no dot → rejected
            'a.b', // < 5 chars → rejected
            'this-is-a-really-long-domain.com', // > 22 chars → rejected
            42, // non-string → filtered before normalize
          ],
        }),
      )
      .mockResolvedValueOnce(aiJson({ domains: [] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acme.com', reason: 'Clean root.', pitch: 'Anchor brand.' }] }),
      );
    mockCheckBatch.mockImplementation((_e: Env, list: string[]) =>
      Promise.resolve(list.map((d) => rdap(d, true))),
    );

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 5 });
    // Only the normalized 'acme.com' survives.
    expect(mockCheckBatch.mock.calls[0][1]).toEqual(['acme.com']);
    expect(out.map((s) => s.domain)).toEqual(['acme.com']);
  });
});

// ────────────────────────────────────────────────────────────
// Pricing / inline-register / Porkbun fallback
// ────────────────────────────────────────────────────────────
describe('suggestDomains — pricing & registrar routing', () => {
  it('marks unsupported TLDs as non-inline with a Porkbun fallback URL', async () => {
    mockGather.mockResolvedValue(makeCtx());
    mockUnsupportedTld.mockImplementation((tld: string) => tld === 'studio');
    mockPrice.mockImplementation((tld: string) => (tld === 'studio' ? null : 12));

    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acme.com', 'acme.studio'] }))
      .mockResolvedValueOnce(
        aiJson({
          rows: [
            { domain: 'acme.com', reason: 'Trust root.', pitch: 'Own it.' },
            { domain: 'acme.studio', reason: 'Creative cue.', pitch: 'Stand out.' },
          ],
        }),
      );
    mockCheckBatch.mockResolvedValue([rdap('acme.com', true), rdap('acme.studio', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 2 });
    const com = out.find((s) => s.domain === 'acme.com')!;
    const studio = out.find((s) => s.domain === 'acme.studio')!;

    expect(com.can_register_inline).toBe(true);
    expect(com.fallback_url).toBeUndefined();
    expect(com.price_usd_yr).toBe(12);

    expect(studio.can_register_inline).toBe(false);
    expect(studio.fallback_url).toContain('porkbun.com');
    expect(studio.price_usd_yr).toBeNull();
    expect(mockPorkbun).toHaveBeenCalledWith('acme.studio');
  });
});

// ────────────────────────────────────────────────────────────
// Enrichment anti-slop re-roll + deterministic fallback
// ────────────────────────────────────────────────────────────
describe('suggestDomains — enrichment & anti-slop', () => {
  it('re-rolls a slop-containing row then accepts the clean retry', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acme.com'] }))
      // first enrichment: contains a banned word ('perfect') → re-roll.
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acme.com', reason: 'perfect brand fit.', pitch: 'Grab it.' }] }),
      )
      // retry enrichment: clean copy.
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acme.com', reason: 'Sharp brand fit.', pitch: 'Grab it now.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('acme.com', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 1 });
    expect(out[0].reason).toBe('Sharp brand fit.');
    expect(ANTI_SLOP_BANNED).toContain('perfect');
    // 1 candidate call + 2 enrichment calls.
    expect(aiRun).toHaveBeenCalledTimes(3);
  });

  it('falls back to deterministic copy when enrichment never returns the row', async () => {
    mockGather.mockResolvedValue(makeCtx({ business_name: 'Acme Salon' }));
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acme.io'] }))
      // every enrichment attempt omits the row → exhausts re-rolls.
      .mockResolvedValue(aiJson({ rows: [] }));
    mockCheckBatch.mockResolvedValue([rdap('acme.io', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 1 });
    expect(out).toHaveLength(1);
    // Deterministic fallback names the business + a per-TLD note.
    expect(out[0].reason).toContain('Acme');
    expect(out[0].pitch.length).toBeGreaterThan(0);
    // Fallback never contains a banned phrase.
    const blob = `${out[0].reason} ${out[0].pitch}`.toLowerCase();
    for (const banned of ANTI_SLOP_BANNED) {
      if (!banned.includes(' ')) {
        expect(new RegExp(`\\b${banned}\\b`).test(blob)).toBe(false);
      }
    }
  });

  it('uses deterministic fallback when the enrichment AI call throws', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acme.dev'] }))
      .mockRejectedValue(new Error('AI down'));
    mockCheckBatch.mockResolvedValue([rdap('acme.dev', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe('acme.dev');
    expect(out[0].reason.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────
// AI / parse failure resilience
// ────────────────────────────────────────────────────────────
describe('suggestDomains — failure resilience', () => {
  it('returns [] when candidate generation yields nothing across all rounds', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun.mockResolvedValue(aiJson({ domains: [] }));
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 5 });
    expect(out).toEqual([]);
    // Empty first round breaks the candidate loop early (one AI call), and
    // no enrichment call fires when there are no survivors.
    expect(aiRun).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the candidate AI call throws', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun.mockRejectedValue(new Error('boom'));
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1' });
    expect(out).toEqual([]);
  });

  it('tolerates malformed (non-JSON) candidate output', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun.mockResolvedValue({ response: 'not json at all' });
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1' });
    expect(out).toEqual([]);
  });

  it('recovers candidate JSON wrapped in preamble via substring extraction', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce({
        response: 'Here you go: {"domains": ["acme.com"]} — enjoy!',
      })
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acme.com', reason: 'Root brand.', pitch: 'Claim it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('acme.com', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 1 });
    expect(out.map((s) => s.domain)).toEqual(['acme.com']);
  });
});

// ────────────────────────────────────────────────────────────
// Edge inputs — count clamping
// ────────────────────────────────────────────────────────────
describe('suggestDomains — count clamping', () => {
  it('clamps count to a minimum of 1 when given 0 or negative', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['acme.com', 'acme.io'] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'acme.com', reason: 'Root.', pitch: 'Go.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('acme.com', true), rdap('acme.io', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 0 });
    expect(out).toHaveLength(1);
  });

  it('clamps count to a maximum of 20', async () => {
    mockGather.mockResolvedValue(makeCtx());
    // 30 available candidates; only 20 should survive.
    const many = Array.from({ length: 30 }, (_, i) => `acmebr${i}.com`);
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: many }))
      .mockResolvedValueOnce(aiJson({ rows: [] })); // all fall back deterministically
    mockCheckBatch.mockImplementation((_e: Env, list: string[]) =>
      Promise.resolve(list.map((d) => rdap(d, true))),
    );

    const out = await suggestDomains(makeEnv(), { siteId: 'site-1', count: 99 });
    expect(out.length).toBeLessThanOrEqual(20);
  });
});
