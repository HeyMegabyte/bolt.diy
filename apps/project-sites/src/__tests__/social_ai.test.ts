/**
 * Unit tests for the Pulse Social AI surface (`services/social_ai`).
 *
 * Covers every branch:
 *   - generatePost: default platform fallback, hashtag count clamp, # stripping,
 *     JSON parse + fenced-block strip, malformed-AI fallback, overrides/mentions defaults
 *   - generateHashtags: max clamp, lowercase + #/space normalization, parse fallback
 *   - repurpose: HTML strip + 6000-char cap, fetch-failure fallback, non-ok response,
 *     empty target-platform fallback, per-platform iteration
 *   - translateContent: happy path + parse-failure returns original
 *   - rewriteForTone: passthrough of trimmed AI body
 *   - bestTimeToPost: bucketing by (day,hour), median (odd/even), top-3 + confidence,
 *     account_id narrowing branch, skips null/NaN rows, empty rows
 *
 * Never hits real APIs — env.AI.run, global.fetch, and db.dbQuery are all mocked.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
}));

import { dbQuery } from '../services/db.js';
import {
  generatePost,
  generateHashtags,
  repurpose,
  translateContent,
  rewriteForTone,
  bestTimeToPost,
} from '../services/social_ai.js';

const mockQuery = dbQuery as unknown as jest.Mock;

interface MakeEnvOpts {
  /** A string (raw response) OR a function (model, params) => raw response. */
  aiReply?: string | ((model: string, params: Record<string, unknown>) => string);
  captureCall?: (model: string, params: Record<string, unknown>) => void;
}

function makeEnv(opts: MakeEnvOpts = {}): any {
  const aiRun = jest.fn(async (model: string, params: Record<string, unknown>) => {
    if (opts.captureCall) opts.captureCall(model, params);
    const reply =
      typeof opts.aiReply === 'function' ? opts.aiReply(model, params) : (opts.aiReply ?? '');
    return { response: reply };
  });
  return { AI: { run: aiRun }, DB: {} as unknown };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── generatePost ─────────────────────────────────────────────────────────

describe('generatePost', () => {
  it('parses a clean JSON envelope and strips leading # from hashtags', async () => {
    const env = makeEnv({
      aiReply: JSON.stringify({
        content: 'Ship faster.',
        per_platform_overrides: { twitter: { content: 'Ship faster 🚀' } },
        hashtags: ['#DevTools', 'shipfast'],
        mentions: [{ platform: 'twitter', handle: '@acme' }],
      }),
    });
    const out = await generatePost(env, { topic: 'launch', platforms: ['twitter'] });
    expect(out.content).toBe('Ship faster.');
    expect(out.per_platform_overrides.twitter?.content).toBe('Ship faster 🚀');
    expect(out.hashtags).toEqual(['DevTools', 'shipfast']);
    expect(out.mentions).toEqual([{ platform: 'twitter', handle: '@acme' }]);
  });

  it('falls back to the twitter persona when no platforms are supplied', async () => {
    let seenSystemPrompt = '';
    const env = makeEnv({
      aiReply: JSON.stringify({ content: 'x', per_platform_overrides: {}, hashtags: [], mentions: [] }),
      captureCall: (_m, params) => {
        const msgs = params['messages'] as { role: string; content: string }[];
        seenSystemPrompt = msgs[0]?.content ?? '';
      },
    });
    const out = await generatePost(env, { topic: 't', platforms: [] });
    expect(out.content).toBe('x');
    // system prompt for primary='twitter' must have been built
    expect(seenSystemPrompt.toLowerCase()).toContain('twitter');
  });

  it('clamps hashtag_count to 0..15 and slices the returned hashtags', async () => {
    const env = makeEnv({
      aiReply: JSON.stringify({
        content: 'c',
        per_platform_overrides: {},
        hashtags: ['a', 'b', 'c', 'd', 'e'],
        mentions: [],
      }),
    });
    const out = await generatePost(env, { topic: 't', platforms: ['linkedin'], hashtag_count: 2 });
    expect(out.hashtags).toEqual(['a', 'b']);
  });

  it('treats hashtag_count above 15 as 15 and negative as 0', async () => {
    const big = Array.from({ length: 30 }, (_v, i) => `t${i}`);
    const envHi = makeEnv({
      aiReply: JSON.stringify({ content: 'c', per_platform_overrides: {}, hashtags: big, mentions: [] }),
    });
    const hi = await generatePost(envHi, { topic: 't', platforms: ['x'], hashtag_count: 99 });
    expect(hi.hashtags).toHaveLength(15);

    const envZero = makeEnv({
      aiReply: JSON.stringify({ content: 'c', per_platform_overrides: {}, hashtags: ['a'], mentions: [] }),
    });
    const zero = await generatePost(envZero, { topic: 't', platforms: ['x'], hashtag_count: -5 });
    expect(zero.hashtags).toEqual([]);
  });

  it('drops empty/whitespace hashtags after # strip', async () => {
    const env = makeEnv({
      aiReply: JSON.stringify({
        content: 'c',
        per_platform_overrides: {},
        hashtags: ['#', '  ', 'real'],
        mentions: [],
      }),
    });
    const out = await generatePost(env, { topic: 't', platforms: ['x'] });
    expect(out.hashtags).toEqual(['real']);
  });

  it('strips a fenced ```json block before parsing', async () => {
    const env = makeEnv({
      aiReply:
        'Here you go:\n```json\n{ "content": "ok", "per_platform_overrides": {}, "hashtags": [], "mentions": [] }\n```',
    });
    const out = await generatePost(env, { topic: 't', platforms: ['x'] });
    expect(out.content).toBe('ok');
  });

  it('returns the empty fallback envelope when AI output is unparseable', async () => {
    const env = makeEnv({ aiReply: 'totally not json at all' });
    const out = await generatePost(env, { topic: 't', platforms: ['x'] });
    expect(out).toEqual({ content: '', per_platform_overrides: {}, hashtags: [], mentions: [] });
  });

  it('defaults missing fields (overrides/mentions/hashtags) to safe empties', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ content: 'only-content' }) });
    const out = await generatePost(env, { topic: 't', platforms: ['x'] });
    expect(out.content).toBe('only-content');
    expect(out.per_platform_overrides).toEqual({});
    expect(out.hashtags).toEqual([]);
    expect(out.mentions).toEqual([]);
  });

  it('includes tone, brand_voice, and link in the prompt when provided', async () => {
    let prompt = '';
    const env = makeEnv({
      aiReply: JSON.stringify({ content: 'c', per_platform_overrides: {}, hashtags: [], mentions: [] }),
      captureCall: (_m, params) => {
        const msgs = params['messages'] as { role: string; content: string }[];
        prompt = msgs[1]?.content ?? '';
      },
    });
    await generatePost(env, {
      topic: 'topic',
      platforms: ['x'],
      tone: 'punchy',
      brand_voice: 'warm',
      link: 'https://e.co',
    });
    expect(prompt).toContain('Tone overlay: punchy');
    expect(prompt).toContain('Brand voice context: warm');
    expect(prompt).toContain('https://e.co');
  });
});

// ─── generateHashtags ───────────────────────────────────────────────────────

describe('generateHashtags', () => {
  it('normalizes tags: lowercases, strips #, removes inner spaces', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ tags: ['#DevOps', 'Ship Fast', 'CLEAN'] }) });
    const out = await generateHashtags(env, { content: 'post', platform: 'twitter' });
    expect(out).toEqual(['devops', 'shipfast', 'clean']);
  });

  it('clamps max to 1..15 and slices', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ tags: ['a', 'b', 'c'] }) });
    const out = await generateHashtags(env, { content: 'p', platform: 'x', max: 2 });
    expect(out).toEqual(['a', 'b']);
  });

  it('uses max=1 floor when max is 0 or negative', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ tags: ['a', 'b'] }) });
    const out = await generateHashtags(env, { content: 'p', platform: 'x', max: 0 });
    expect(out).toEqual(['a']);
  });

  it('returns [] when AI output is unparseable', async () => {
    const env = makeEnv({ aiReply: 'nope' });
    const out = await generateHashtags(env, { content: 'p', platform: 'x' });
    expect(out).toEqual([]);
  });

  it('drops empty tags after normalization', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ tags: ['#', '   ', 'keep'] }) });
    const out = await generateHashtags(env, { content: 'p', platform: 'x' });
    expect(out).toEqual(['keep']);
  });

  it('returns [] when tags key is absent', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ other: true }) });
    const out = await generateHashtags(env, { content: 'p', platform: 'x' });
    expect(out).toEqual([]);
  });
});

// ─── repurpose ───────────────────────────────────────────────────────────────

describe('repurpose', () => {
  it('fetches the source, strips tags, and produces one post per platform', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      text: async () =>
        '<html><script>bad()</script><style>x{}</style><h1>Headline</h1><p>Body copy.</p></html>',
    }));
    (global as any).fetch = fetchMock;

    let capturedPrompt = '';
    const env = makeEnv({
      aiReply: (_m, params) => {
        const msgs = params['messages'] as { role: string; content: string }[];
        capturedPrompt = msgs[1]?.content ?? '';
        return JSON.stringify({ content: 'repurposed', hashtags: ['#Tag'] });
      },
    });

    const out = await repurpose(env, {
      source_url: 'https://src.example/post',
      target_platforms: ['twitter', 'linkedin'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.posts).toHaveLength(2);
    expect(out.posts[0]).toEqual({ platform: 'twitter', content: 'repurposed', hashtags: ['Tag'] });
    // tags + scripts/styles stripped from extract
    expect(capturedPrompt).toContain('Headline');
    expect(capturedPrompt).not.toContain('bad()');
    expect(capturedPrompt).not.toContain('<h1>');
  });

  it('caps the extracted source text at 6000 chars', async () => {
    const huge = 'a'.repeat(10000);
    (global as any).fetch = jest.fn(async () => ({ ok: true, text: async () => huge }));
    let capturedPrompt = '';
    const env = makeEnv({
      aiReply: (_m, params) => {
        const msgs = params['messages'] as { role: string; content: string }[];
        capturedPrompt = msgs[1]?.content ?? '';
        return JSON.stringify({ content: 'c', hashtags: [] });
      },
    });
    await repurpose(env, { source_url: 'https://x.co', target_platforms: ['twitter'] });
    // The source extract is a contiguous run of 'a' chars capped at 6000 by .slice(0, 6000).
    const longestRun = (capturedPrompt.match(/a{10,}/g) ?? []).reduce(
      (max, run) => Math.max(max, run.length),
      0,
    );
    expect(longestRun).toBe(6000);
  });

  it('continues with empty source text when fetch throws', async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = makeEnv({ aiReply: JSON.stringify({ content: 'fallback', hashtags: [] }) });

    const out = await repurpose(env, { source_url: 'https://x.co', target_platforms: ['twitter'] });

    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.content).toBe('fallback');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('continues with empty source text when the response is not ok', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, text: async () => 'ignored' }));
    let capturedPrompt = '';
    const env = makeEnv({
      aiReply: (_m, params) => {
        const msgs = params['messages'] as { role: string; content: string }[];
        capturedPrompt = msgs[1]?.content ?? '';
        return JSON.stringify({ content: 'c', hashtags: [] });
      },
    });
    await repurpose(env, { source_url: 'https://x.co', target_platforms: ['twitter'] });
    expect(capturedPrompt).not.toContain('SOURCE EXTRACT:');
  });

  it('defaults to twitter when no target platforms are supplied', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, text: async () => '<p>hi</p>' }));
    const env = makeEnv({ aiReply: JSON.stringify({ content: 'c', hashtags: [] }) });
    const out = await repurpose(env, { source_url: 'https://x.co', target_platforms: [] });
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.platform).toBe('twitter');
  });

  it('uses the fallback shape when AI output is unparseable per platform', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, text: async () => '<p>hi</p>' }));
    const env = makeEnv({ aiReply: 'garbage' });
    const out = await repurpose(env, { source_url: 'https://x.co', target_platforms: ['mastodon'] });
    expect(out.posts[0]).toEqual({ platform: 'mastodon', content: '', hashtags: [] });
  });

  it('caps repurposed hashtags at 8', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, text: async () => '<p>hi</p>' }));
    const many = Array.from({ length: 12 }, (_v, i) => `t${i}`);
    const env = makeEnv({ aiReply: JSON.stringify({ content: 'c', hashtags: many }) });
    const out = await repurpose(env, { source_url: 'https://x.co', target_platforms: ['twitter'] });
    expect(out.posts[0]?.hashtags).toHaveLength(8);
  });
});

// ─── translateContent ─────────────────────────────────────────────────────────

describe('translateContent', () => {
  it('returns the translated body on a clean parse', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ translated: 'Hola mundo' }) });
    const out = await translateContent(env, { content: 'Hello world', target_lang: 'es' });
    expect(out).toBe('Hola mundo');
  });

  it('falls back to the original content when parse fails', async () => {
    const env = makeEnv({ aiReply: 'not json' });
    const out = await translateContent(env, { content: 'Original', target_lang: 'fr' });
    expect(out).toBe('Original');
  });

  it('falls back to original when translated key is missing', async () => {
    const env = makeEnv({ aiReply: JSON.stringify({ wrong: 'x' }) });
    const out = await translateContent(env, { content: 'Keep me', target_lang: 'de' });
    expect(out).toBe('Keep me');
  });
});

// ─── rewriteForTone ───────────────────────────────────────────────────────────

describe('rewriteForTone', () => {
  it('returns the trimmed AI body verbatim', async () => {
    const env = makeEnv({ aiReply: '   Punchier version.   ' });
    const out = await rewriteForTone(env, {
      content: 'Original.',
      tone: 'punchy',
      platform: 'twitter',
    });
    expect(out).toBe('Punchier version.');
  });

  it('returns empty string when AI yields nothing', async () => {
    const env = makeEnv({ aiReply: '' });
    const out = await rewriteForTone(env, { content: 'x', tone: 'warm', platform: 'linkedin' });
    expect(out).toBe('');
  });
});

// ─── bestTimeToPost ─────────────────────────────────────────────────────────

describe('bestTimeToPost', () => {
  it('returns [] when there are no snapshot rows', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });
    const env = makeEnv();
    const out = await bestTimeToPost(env, { platform: 'twitter', org_id: 'org1' });
    expect(out).toEqual([]);
    // no account_id → 2 params bound
    const params = mockQuery.mock.calls[0][2];
    expect(params).toEqual(['twitter', 'org1']);
  });

  it('binds account_id as a third param when supplied', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });
    const env = makeEnv();
    await bestTimeToPost(env, { platform: 'x', org_id: 'o', account_id: 'acct9' });
    const sql = mockQuery.mock.calls[0][1] as string;
    const params = mockQuery.mock.calls[0][2];
    expect(sql).toContain('AND sp.account_id = ?');
    expect(params).toEqual(['x', 'o', 'acct9']);
  });

  it('buckets by (UTC day, hour), computes median, ranks top-3 by median', async () => {
    // Monday 14:00 UTC bucket: two impressions (median 150)
    // Tuesday 09:00 UTC bucket: one impression (median 500) → highest
    // Wednesday 03:00 UTC bucket: one impression (median 50)
    mockQuery.mockResolvedValue({
      data: [
        { published_at: '2026-01-05T14:00:00Z', impressions: 100, account_id: 'a' }, // Mon
        { published_at: '2026-01-05T14:30:00Z', impressions: 200, account_id: 'a' }, // Mon
        { published_at: '2026-01-06T09:00:00Z', impressions: 500, account_id: 'a' }, // Tue
        { published_at: '2026-01-07T03:00:00Z', impressions: 50, account_id: 'a' }, // Wed
      ],
      error: null,
    });
    const env = makeEnv();
    const out = await bestTimeToPost(env, { platform: 'twitter', org_id: 'o' });
    expect(out).toHaveLength(3);
    // Highest median first: Tuesday 09:00
    expect(out[0]).toMatchObject({ day: 2, hour: 9 });
    // Monday bucket has 2 samples → highest confidence (n=2 / maxN=2 = 1)
    const mon = out.find((r) => r.day === 1 && r.hour === 14);
    expect(mon?.confidence).toBe(1);
    // single-sample buckets → confidence 0.5 (1/2)
    const wed = out.find((r) => r.day === 3 && r.hour === 3);
    expect(wed?.confidence).toBe(0.5);
  });

  it('skips rows with null impressions or unparseable dates', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { published_at: '2026-01-05T14:00:00Z', impressions: null, account_id: 'a' },
        { published_at: 'not-a-date', impressions: 100, account_id: 'a' },
        { published_at: null, impressions: 100, account_id: 'a' },
        { published_at: '2026-01-06T09:00:00Z', impressions: 300, account_id: 'a' },
      ],
      error: null,
    });
    const env = makeEnv();
    const out = await bestTimeToPost(env, { platform: 'x', org_id: 'o' });
    // Only the valid row survives → one bucket
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ day: 2, hour: 9, confidence: 1 });
  });

  it('computes an even-count median as the mean of the two middle samples', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { published_at: '2026-01-05T10:00:00Z', impressions: 10, account_id: 'a' },
        { published_at: '2026-01-05T10:15:00Z', impressions: 20, account_id: 'a' },
        { published_at: '2026-01-05T10:30:00Z', impressions: 30, account_id: 'a' },
        { published_at: '2026-01-05T10:45:00Z', impressions: 1000, account_id: 'a' },
      ],
      error: null,
    });
    const env = makeEnv();
    const out = await bestTimeToPost(env, { platform: 'x', org_id: 'o' });
    // Single bucket; median of [10,20,30,1000] = (20+30)/2 = 25 (not skewed by 1000)
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ day: 1, hour: 10, confidence: 1 });
  });
});
