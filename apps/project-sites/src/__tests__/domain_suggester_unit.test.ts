/**
 * domain_suggester — additional unit coverage for pure-logic branches.
 *
 * The primary integration test lives in domain_suggester.test.ts (happy path,
 * RDAP filter, enrichment re-roll, pricing, failure paths). This file targets
 * the pure helpers and edge-cases that that suite doesn't exercise:
 *
 *   • ANTI_SLOP_BANNED — content correctness & structure invariants
 *   • count=undefined default behaviour (→10)
 *   • normalizeDomain edge cases: leading/trailing hyphens, uppercase stripping,
 *     hyphen in brand name, path with query string, exactly 5 / exactly 22 chars
 *   • safeJsonParse fallback (substring extraction) with nested braces
 *   • query + feedback params forwarded into the AI prompt
 *   • KV cache hit path for homepage summarization (short-circuits AI call)
 *   • All-taken second round still returns [] gracefully
 */

jest.mock('../services/profile_context.js', () => ({
  gatherProfileContext: jest.fn(),
}));
jest.mock('../services/rdap_availability.js', () => ({
  checkBatch: jest.fn(),
}));
jest.mock('../services/cf_registrar.js', () => ({
  isKnownUnsupportedTld: jest.fn().mockReturnValue(false),
  porkbunFallback: jest.fn((d: string) => `https://porkbun.com/checkout/search?q=${d}`),
  staticTldPriceUsd: jest.fn().mockReturnValue(12),
}));

import {
  suggestDomains,
  ANTI_SLOP_BANNED,
  type DomainSuggestion,
} from '../services/domain_suggester.js';
import { gatherProfileContext, type ProfileContext } from '../services/profile_context.js';
import { checkBatch, type RdapResult } from '../services/rdap_availability.js';
import { isKnownUnsupportedTld, staticTldPriceUsd } from '../services/cf_registrar.js';
import type { Env } from '../types/env.js';

const mockGather = gatherProfileContext as unknown as jest.Mock;
const mockCheckBatch = checkBatch as unknown as jest.Mock;
const mockUnsupportedTld = isKnownUnsupportedTld as unknown as jest.Mock;
const mockPrice = staticTldPriceUsd as unknown as jest.Mock;

let aiRun: jest.Mock;

function makeCtx(over: Partial<ProfileContext> = {}): ProfileContext {
  return {
    site_id: 'site-unit',
    slug: 'test-biz',
    business_name: 'Test Biz',
    business_type: 'retail',
    recent_keywords: ['widget', 'shop'],
    generated_at: new Date().toISOString(),
    ...over,
  } as ProfileContext;
}

function makeEnv(kvOverrides: Record<string, unknown> = {}): Env {
  return {
    AI: { run: aiRun },
    CACHE_KV: {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
      ...kvOverrides,
    },
    SITES_BUCKET: {
      get: jest.fn().mockResolvedValue(null),
    },
  } as unknown as Env;
}

function rdap(domain: string, available: boolean): RdapResult {
  return {
    domain,
    available,
    status: available ? 'available' : 'taken',
    source: 'rdap',
  } as RdapResult;
}

function aiJson(obj: unknown): { response: string } {
  return { response: JSON.stringify(obj) };
}

/** Wire up the minimal two-call sequence: candidates → enrichment. */
function stubHappyPath(domain: string, reason = 'Good fit.', pitch = 'Act now.'): void {
  aiRun
    .mockResolvedValueOnce(aiJson({ domains: [domain] }))
    .mockResolvedValueOnce(aiJson({ rows: [{ domain, reason, pitch }] }));
  mockCheckBatch.mockResolvedValue([rdap(domain, true)]);
}

beforeEach(() => {
  jest.clearAllMocks();
  aiRun = jest.fn();
  mockUnsupportedTld.mockReturnValue(false);
  mockPrice.mockReturnValue(12);
});

// ──────────────────────────────────────────────────────────────────────────────
// ANTI_SLOP_BANNED — structure & content invariants
// ──────────────────────────────────────────────────────────────────────────────

describe('ANTI_SLOP_BANNED', () => {
  it('is a non-empty readonly array of lowercase strings', () => {
    expect(Array.isArray(ANTI_SLOP_BANNED)).toBe(true);
    expect(ANTI_SLOP_BANNED.length).toBeGreaterThan(0);
    for (const phrase of ANTI_SLOP_BANNED) {
      expect(typeof phrase).toBe('string');
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  it('is frozen (immutable at runtime)', () => {
    expect(Object.isFrozen(ANTI_SLOP_BANNED)).toBe(true);
  });

  it('contains the canonical AI-slop offenders from the project docs', () => {
    const required = [
      'perfect',
      'amazing',
      'unlock',
      'elevate',
      'transform',
      'leverage',
      'seamless',
      'revolutionary',
      'world-class',
      'cutting-edge',
    ];
    for (const word of required) {
      expect(ANTI_SLOP_BANNED).toContain(word);
    }
  });

  it('contains no duplicates', () => {
    const unique = new Set(ANTI_SLOP_BANNED);
    expect(unique.size).toBe(ANTI_SLOP_BANNED.length);
  });

  it('every phrase is non-empty (no blank entries)', () => {
    for (const phrase of ANTI_SLOP_BANNED) {
      expect(phrase.trim().length).toBeGreaterThan(0);
    }
  });

  it('has at least one multi-word phrase (guards the substring branch in scanForSlop)', () => {
    const multiWord = ANTI_SLOP_BANNED.filter((p) => p.includes(' '));
    expect(multiWord.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Default count behaviour
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — default count', () => {
  it('defaults count to 10 when not supplied', async () => {
    mockGather.mockResolvedValue(makeCtx());
    // Supply 12 available domains; only 10 should come back.
    const domains = Array.from({ length: 12 }, (_, i) => `testbiz${i}.com`);
    aiRun.mockResolvedValueOnce(aiJson({ domains })).mockResolvedValueOnce(aiJson({ rows: [] })); // deterministic fallback
    mockCheckBatch.mockImplementation((_e: Env, list: string[]) =>
      Promise.resolve(list.map((d) => rdap(d, true))),
    );

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit' });
    expect(out.length).toBe(10);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// normalizeDomain — edge cases exercised via the suggestion pipeline
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — normalizeDomain edge cases', () => {
  it('accepts a domain that is exactly 5 characters', async () => {
    // 'a.com' = 5 chars — should pass the length gate.
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('a.com');
    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toContain('a.com');
  });

  it('accepts a domain that is exactly 22 characters', async () => {
    const d22 = 'superlongbrandname.com'; // 22 chars exactly
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath(d22);
    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toContain(d22);
  });

  it('rejects a domain that is 23 characters (one over the 22-char ceiling)', async () => {
    // '12345678901234567890.co' = 23 chars → rejected, nothing reaches RDAP
    const tooLong = '12345678901234567890.co'; // 23 chars
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: [tooLong] }))
      .mockResolvedValueOnce(aiJson({ domains: [] })); // second round — empty
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
    // RDAP should never have been called because the domain was rejected before probe.
    expect(mockCheckBatch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([tooLong]),
    );
  });

  it('strips https:// and trailing path before validation', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['https://testbiz.io/pricing?ref=x'] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'testbiz.io', reason: 'Tech cue.', pitch: 'Lock it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('testbiz.io', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toEqual(['testbiz.io']);
  });

  it('lowercases uppercase domain strings from the AI', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['TestBiz.COM'] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'testbiz.com', reason: 'Clean brand.', pitch: 'Claim it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('testbiz.com', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toEqual(['testbiz.com']);
  });

  it('rejects a domain with a leading hyphen', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['-badstart.com'] }))
      .mockResolvedValueOnce(aiJson({ domains: [] }));
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
    expect(mockCheckBatch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['-badstart.com']),
    );
  });

  it('rejects a domain with a trailing hyphen before the TLD separator', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['badend-.com'] }))
      .mockResolvedValueOnce(aiJson({ domains: [] }));
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
  });

  it('rejects a domain with no dot (no TLD)', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['nodomain'] }))
      .mockResolvedValueOnce(aiJson({ domains: [] }));
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
  });

  it('filters out non-string entries from the AI domains array', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce(aiJson({ domains: [null, 42, true, 'valid.io'] }))
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'valid.io', reason: 'Clean.', pitch: 'Grab it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('valid.io', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 3 });
    expect(out.map((s) => s.domain)).toEqual(['valid.io']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// safeJsonParse — substring extraction with nested braces
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — safeJsonParse via AI preamble', () => {
  it('returns empty when a bare-key brace preamble precedes the JSON (parser does not recover)', async () => {
    // AI wraps the JSON after a `{count: 3}` bare-key (invalid-JSON) preamble; the
    // extractor does NOT salvage the trailing valid object → suggestDomains yields [].
    mockGather.mockResolvedValue(makeCtx());
    aiRun
      .mockResolvedValueOnce({
        response: 'Options {count: 3}: {"domains": ["nested.io"]} — that is all.',
      })
      .mockResolvedValueOnce(
        aiJson({ rows: [{ domain: 'nested.io', reason: 'Niche cue.', pitch: 'Take it.' }] }),
      );
    mockCheckBatch.mockResolvedValue([rdap('nested.io', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toEqual([]);
  });

  it('returns empty when response is an empty string', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun.mockResolvedValue({ response: '' });
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
  });

  it('returns empty when response has no braces at all', async () => {
    mockGather.mockResolvedValue(makeCtx());
    aiRun.mockResolvedValue({ response: 'just plain text no json here' });
    mockCheckBatch.mockResolvedValue([]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// query and feedback params — forwarded to the AI prompt
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — query and feedback params', () => {
  it('includes query in the AI candidate prompt when supplied', async () => {
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('myshop.io');

    await suggestDomains(makeEnv(), {
      siteId: 'site-unit',
      count: 1,
      query: 'boutique',
    });

    // The first AI call (candidate generation) should contain the query prefix.
    const firstCallArgs = aiRun.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const promptText = firstCallArgs.messages.map((m) => m.content).join('\n');
    expect(promptText).toMatch(/boutique/i);
  });

  it('includes feedback in the AI candidate prompt when supplied', async () => {
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('myshop.io');

    await suggestDomains(makeEnv(), {
      siteId: 'site-unit',
      count: 1,
      feedback: 'more creative names please',
    });

    const firstCallArgs = aiRun.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const promptText = firstCallArgs.messages.map((m) => m.content).join('\n');
    expect(promptText).toMatch(/more creative names please/i);
  });

  it('does not include query or feedback markers when they are not supplied', async () => {
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('myshop.io');

    await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });

    const firstCallArgs = aiRun.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const promptText = firstCallArgs.messages.map((m) => m.content).join('\n');
    expect(promptText).not.toMatch(/User query prefix:/i);
    expect(promptText).not.toMatch(/User feedback:/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Homepage KV cache hit — skips AI summarization call
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — homepage KV cache', () => {
  it('uses cached homepage summary without calling AI a second time for summarisation', async () => {
    mockGather.mockResolvedValue(makeCtx({ site_id: 'cached-site', current_build_version: 'v1' }));

    const env = makeEnv({
      // KV returns a cached summary immediately.
      get: jest
        .fn()
        .mockResolvedValue('Serves small businesses. Value: fast delivery. Tone: bold.'),
    });

    stubHappyPath('cached.io');

    await suggestDomains(env, { siteId: 'cached-site', count: 1 });

    // Only two AI calls should have happened (candidates + enrichment).
    // The KV cache was hit so no homepage summarization AI call fires.
    expect(aiRun).toHaveBeenCalledTimes(2);
    // The SITES_BUCKET.get should NOT have been called — KV short-circuited.
    const bucketGet = (env.SITES_BUCKET as unknown as { get: jest.Mock }).get;
    expect(bucketGet).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// All candidates taken in both rounds → graceful empty
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — all-taken multi-round', () => {
  it('returns [] gracefully when every domain across both rounds is taken', async () => {
    mockGather.mockResolvedValue(makeCtx());

    aiRun
      .mockResolvedValueOnce(aiJson({ domains: ['taken1.com', 'taken2.io'] }))
      .mockResolvedValueOnce(aiJson({ domains: ['taken3.dev', 'taken4.app'] }));
    mockCheckBatch.mockImplementation((_e: Env, list: string[]) =>
      Promise.resolve(list.map((d) => rdap(d, false))),
    );

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 3 });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Output shape invariants
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — output shape', () => {
  it('every returned suggestion has the required DomainSuggestion shape', async () => {
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('shapebiz.com');

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out).toHaveLength(1);

    const s: DomainSuggestion = out[0];
    expect(typeof s.domain).toBe('string');
    expect(s.available).toBe(true);
    expect(s.status).toBe('available');
    expect(typeof s.reason).toBe('string');
    expect(typeof s.pitch).toBe('string');
    // reason <= 60, pitch <= 90 per truncation contract.
    expect(s.reason.length).toBeLessThanOrEqual(60);
    expect(s.pitch.length).toBeLessThanOrEqual(90);
    expect(typeof s.can_register_inline).toBe('boolean');
  });

  it('returns suggestions in the order the AI generated them (preference order preserved)', async () => {
    mockGather.mockResolvedValue(makeCtx());

    const orderedDomains = ['first.com', 'second.io', 'third.app'];
    aiRun.mockResolvedValueOnce(aiJson({ domains: orderedDomains })).mockResolvedValueOnce(
      aiJson({
        rows: orderedDomains.map((d) => ({
          domain: d,
          reason: `Reason for ${d}.`,
          pitch: `Pitch for ${d}.`,
        })),
      }),
    );
    mockCheckBatch.mockResolvedValue(orderedDomains.map((d) => rdap(d, true)));

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 3 });
    expect(out.map((s) => s.domain)).toEqual(orderedDomains);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Candidate-generation system prompt — AL-167 regression
// The domain-NAME generator must enforce the {"domains":[]} JSON contract, NOT the
// conversational dashboard chat persona ("ONE line, never an essay, HBO-executive
// voice"). That persona broke JSON generation in prod → the model emitted prose →
// safeJsonParse/Array.isArray failed → silent `return []` → an EMPTY domain picker
// for every site (suggest returned 200 + suggestions:[] while RDAP was healthy).
// The persona belongs ONLY on the human-facing pitch/reason enrichment call.
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — candidate-gen system prompt (AL-167 regression)', () => {
  it('does NOT feed the conversational chat persona to the JSON domain-name generator', async () => {
    mockGather.mockResolvedValue(makeCtx());
    stubHappyPath('regressbiz.com');

    await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });

    const firstCall = aiRun.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemText = firstCall.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n')
      .toLowerCase();
    // The chat persona's hallmark phrases MUST NOT appear on the JSON-gen call.
    expect(systemText).not.toContain('never an essay');
    expect(systemText).not.toContain('hbo');
    expect(systemText).not.toContain('executive');
    // The JSON contract MUST be reinforced by the system prompt itself.
    expect(systemText).toContain('json');
    expect(systemText).toContain('{"domains"');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Workers AI object-response — AL-167 ROOT-CAUSE regression
// `env.AI.run(..., { response_format: { type: 'json_object' } })` returns `.response`
// as an ALREADY-PARSED object, not a JSON string. safeJsonParse ran `raw.indexOf('{')`
// on that object → `TypeError: raw.indexOf is not a function` → propagated to every
// AI-call catch → `return []` → an EMPTY domain picker for every site on prod. The
// parser must accept a parsed object directly.
// ──────────────────────────────────────────────────────────────────────────────

describe('suggestDomains — Workers AI parsed-object response (AL-167 root cause)', () => {
  it('handles res.response delivered as an OBJECT (not a JSON string)', async () => {
    mockGather.mockResolvedValue(makeCtx());
    // Both AI calls return `.response` as an object (the json_object-mode shape that
    // broke prod), NOT a stringified JSON — the pre-fix string-only parser threw.
    aiRun
      .mockResolvedValueOnce({ response: { domains: ['objshape.com'] } })
      .mockResolvedValueOnce({
        response: { rows: [{ domain: 'objshape.com', reason: 'Clean brand.', pitch: 'Claim it.' }] },
      });
    mockCheckBatch.mockResolvedValue([rdap('objshape.com', true)]);

    const out = await suggestDomains(makeEnv(), { siteId: 'site-unit', count: 1 });
    expect(out.map((s) => s.domain)).toEqual(['objshape.com']);
  });
});
