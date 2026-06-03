/**
 * Unit coverage for services/vanity_generator (convergence r5).
 *
 * Covers: KV cache hit (no AI cost), AI happy-path JSON parse, code-fence
 * stripping, word-length + theme validation/normalization, heuristic
 * fallback when AI throws or returns empty, the 12-item cap, cache
 * write-through, and resilience to KV read/write failures.
 *
 * All boundaries (Workers AI, CACHE_KV) are mocked — no real APIs.
 */

import { suggestVanityWords } from '../services/vanity_generator.js';
import type { VanityBusinessProfile } from '../services/vanity_generator.js';

// ── helpers ──────────────────────────────────────────────────────

function makeKv(opts: {
  get?: jest.Mock;
  put?: jest.Mock;
} = {}) {
  return {
    get: opts.get ?? jest.fn().mockResolvedValue(null),
    put: opts.put ?? jest.fn().mockResolvedValue(undefined),
  };
}

function makeAi(run: jest.Mock) {
  return { run };
}

function makeEnv(ai: { run: jest.Mock }, kv: { get: jest.Mock; put: jest.Mock }) {
  return { AI: ai, CACHE_KV: kv } as any;
}

const PROFILE: VanityBusinessProfile = {
  businessName: "Capurso's Salon",
  services: ['Haircuts', 'Color'],
  location: 'Lake Hiawatha, NJ',
  usps: ['Family-owned since 1980'],
  industry: 'Salon',
};

function aiResponse(words: Array<Record<string, unknown>>) {
  return { response: JSON.stringify({ words }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── cache hit ────────────────────────────────────────────────────

describe('suggestVanityWords – cache hit', () => {
  it('returns cached words without invoking Workers AI', async () => {
    const cachedWords = [{ word: 'CURLS', rationale: 'cached', theme: 'service' }];
    const kv = makeKv({ get: jest.fn().mockResolvedValue({ words: cachedWords }) });
    const aiRun = jest.fn();
    const env = makeEnv(makeAi(aiRun), kv);

    const result = await suggestVanityWords(env, { siteId: 'site-1', businessProfile: PROFILE });

    expect(result.cached).toBe(true);
    expect(result.words).toEqual(cachedWords);
    expect(aiRun).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('keys the cache on siteId + profile hash', async () => {
    const kv = makeKv({ get: jest.fn().mockResolvedValue({ words: [] }) });
    const env = makeEnv(makeAi(jest.fn()), kv);

    await suggestVanityWords(env, { siteId: 'abc', businessProfile: PROFILE });

    const key = kv.get.mock.calls[0][0] as string;
    expect(key).toMatch(/^vanity:abc:[0-9a-f]{16}$/);
    // KV.get reads as 'json'
    expect(kv.get.mock.calls[0][1]).toBe('json');
  });

  it('treats a non-array cached payload as a miss and calls AI', async () => {
    const kv = makeKv({ get: jest.fn().mockResolvedValue({ words: 'not-an-array' }) });
    const aiRun = jest.fn().mockResolvedValue(aiResponse([{ word: 'CUTZ', theme: 'service' }]));
    const env = makeEnv(makeAi(aiRun), kv);

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.cached).toBe(false);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(result.words).toEqual([{ word: 'CUTZ', rationale: '', theme: 'service' }]);
  });
});

// ── AI happy path + parsing ──────────────────────────────────────

describe('suggestVanityWords – AI happy path', () => {
  it('parses valid JSON, normalizes word casing, and writes through to KV', async () => {
    const aiRun = jest.fn().mockResolvedValue(
      aiResponse([
        { word: 'curls', rationale: 'from the salon vibe', theme: 'service' },
        { word: 'STYLE', rationale: 'memorable', theme: 'memorable' },
      ]),
    );
    const kv = makeKv();
    const env = makeEnv(makeAi(aiRun), kv);

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.cached).toBe(false);
    expect(result.words[0]).toEqual({
      word: 'CURLS',
      rationale: 'from the salon vibe',
      theme: 'service',
    });
    // write-through to KV with TTL
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [, body, opts] = kv.put.mock.calls[0];
    expect(JSON.parse(body as string)).toEqual({ words: result.words });
    expect((opts as { expirationTtl: number }).expirationTtl).toBe(60 * 60 * 24 * 7);
  });

  it('strips ```json code fences before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify({ words: [{ word: 'FADE', theme: 'service' }] }) + '\n```';
    const aiRun = jest.fn().mockResolvedValue({ response: fenced });
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words).toEqual([{ word: 'FADE', rationale: '', theme: 'service' }]);
  });

  it('accepts a raw string AI response', async () => {
    const aiRun = jest.fn().mockResolvedValue(
      JSON.stringify({ words: [{ word: 'TRIM', theme: 'service' }] }),
    );
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words).toEqual([{ word: 'TRIM', rationale: '', theme: 'service' }]);
  });

  it('strips non-alpha characters and drops words outside 4-7 letters', async () => {
    const aiRun = jest.fn().mockResolvedValue(
      aiResponse([
        { word: 'C4LL', theme: 'memorable' }, // -> CLL (3 chars) dropped
        { word: 'TOOLONGWORD', theme: 'memorable' }, // 11 chars dropped
        { word: 'sa-ve', theme: 'usp' }, // -> SAVE (4 chars) kept
        { word: 'HI', theme: 'memorable' }, // 2 chars dropped
      ]),
    );
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words).toEqual([{ word: 'SAVE', rationale: '', theme: 'usp' }]);
  });

  it('coerces an unknown theme to "memorable" and truncates long rationale', async () => {
    const longRationale = 'x'.repeat(400);
    const aiRun = jest.fn().mockResolvedValue(
      aiResponse([{ word: 'GLOW', theme: 'banana', rationale: longRationale }]),
    );
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words[0].theme).toBe('memorable');
    expect(result.words[0].rationale.length).toBe(240);
  });

  it('caps results at 12 words', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      word: `WORD${String.fromCharCode(65 + (i % 3))}`, // WORDA/WORDB/WORDC (5 chars)
      theme: 'memorable',
    }));
    const aiRun = jest.fn().mockResolvedValue(aiResponse(many));
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words.length).toBe(12);
  });
});

// ── fallback paths ───────────────────────────────────────────────

describe('suggestVanityWords – heuristic fallback', () => {
  it('falls back to deterministic suggestions when Workers AI throws', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('model retired'));
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.cached).toBe(false);
    expect(result.words.length).toBeGreaterThan(0);
    expect(result.words.length).toBeLessThanOrEqual(12);
    // every fallback word is 4-7 letters all-caps
    for (const s of result.words) {
      expect(s.word).toMatch(/^[A-Z]{4,7}$/);
    }
    // universal fallback seeds are always present
    const words = result.words.map((w) => w.word);
    expect(words).toEqual(expect.arrayContaining(['HELP', 'CALL', 'FAST']));
  });

  it('falls back when AI returns valid JSON but zero usable words', async () => {
    const aiRun = jest.fn().mockResolvedValue(aiResponse([{ word: 'AB', theme: 'memorable' }]));
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words.length).toBeGreaterThan(0);
    expect(result.words.map((w) => w.word)).toEqual(expect.arrayContaining(['HELP']));
  });

  it('falls back when AI returns malformed JSON', async () => {
    const aiRun = jest.fn().mockResolvedValue({ response: 'not json at all {' });
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words.length).toBeGreaterThan(0);
    expect(result.words.every((w) => w.theme === 'memorable')).toBe(true);
  });

  it('derives tokens from the business profile in the fallback seed', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('down'));
    const profile: VanityBusinessProfile = { businessName: 'TIGER Plumbing Pros' };
    const env = makeEnv(makeAi(aiRun), makeKv());

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: profile });

    // "TIGER" (5) is a derived token; "PLUMBING" (8) is too long and excluded
    const words = result.words.map((w) => w.word);
    expect(words).toContain('TIGER');
    expect(words).not.toContain('PLUMBING');
  });
});

// ── KV resilience ────────────────────────────────────────────────

describe('suggestVanityWords – KV resilience', () => {
  it('continues to AI when the KV read throws', async () => {
    const kv = makeKv({ get: jest.fn().mockRejectedValue(new Error('kv down')) });
    const aiRun = jest.fn().mockResolvedValue(aiResponse([{ word: 'BOOK', theme: 'service' }]));
    const env = makeEnv(makeAi(aiRun), kv);

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.cached).toBe(false);
    expect(result.words).toEqual([{ word: 'BOOK', rationale: '', theme: 'service' }]);
  });

  it('still returns words when the KV write throws', async () => {
    const kv = makeKv({ put: jest.fn().mockRejectedValue(new Error('kv write failed')) });
    const aiRun = jest.fn().mockResolvedValue(aiResponse([{ word: 'SHOP', theme: 'service' }]));
    const env = makeEnv(makeAi(aiRun), kv);

    const result = await suggestVanityWords(env, { siteId: 's', businessProfile: PROFILE });

    expect(result.words).toEqual([{ word: 'SHOP', rationale: '', theme: 'service' }]);
  });
});
