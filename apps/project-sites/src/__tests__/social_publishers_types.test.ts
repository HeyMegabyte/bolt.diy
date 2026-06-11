/**
 * Unit coverage for `services/social_publishers/types.ts` — the SHARED pure
 * helpers every one of the 11 platform publishers depends on (previously
 * untested). High leverage: a bug here mis-composes every social post or
 * mis-reports missing credentials across all platforms.
 *   - composeContent: per-platform override, hashtag normalization+append,
 *     link append-once.
 *   - requireEnv: collect present creds / throw MissingAppCredsError on any gap.
 *   - emptyAnalytics: the zeroed snapshot for metric-less platforms.
 */
import {
  composeContent,
  requireEnv,
  emptyAnalytics,
  MissingAppCredsError,
  type PostCtx,
} from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello world',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});

describe('composeContent', () => {
  it('returns the bare content when no overrides/hashtags/link', () => {
    expect(composeContent(post(), 'twitter')).toBe('Hello world');
  });

  it('appends hashtags, normalizing a missing leading #', () => {
    expect(composeContent(post({ hashtags: ['foo', '#bar'] }), 'twitter')).toBe(
      'Hello world\n\n#foo #bar',
    );
  });

  it('uses a per-platform override AND skips hashtags for it', () => {
    const out = composeContent(
      post({ per_platform_overrides: { twitter: { content: 'Tweet text' } }, hashtags: ['x'] }),
      'twitter',
    );
    expect(out).toBe('Tweet text');
  });

  it('an override for ANOTHER platform does not apply', () => {
    const out = composeContent(
      post({ per_platform_overrides: { linkedin: { content: 'LI text' } } }),
      'twitter',
    );
    expect(out).toBe('Hello world');
  });

  it('appends the link when not already present', () => {
    expect(composeContent(post({ link: 'https://x.co/a' }), 'twitter')).toBe(
      'Hello world\nhttps://x.co/a',
    );
  });

  it('does NOT double-append a link already in the body', () => {
    expect(
      composeContent(
        post({ content: 'see https://x.co/a now', link: 'https://x.co/a' }),
        'twitter',
      ),
    ).toBe('see https://x.co/a now');
  });

  it('appends both hashtags and link in order', () => {
    expect(composeContent(post({ hashtags: ['go'], link: 'https://x.co/a' }), 'twitter')).toBe(
      'Hello world\n\n#go\nhttps://x.co/a',
    );
  });
});

describe('requireEnv', () => {
  const DEEP = 'https://dev.example/creds';

  it('returns a map of the present vars', () => {
    const env = { A: 'one', B: 'two' } as unknown as Env;
    expect(requireEnv(env, 'twitter', DEEP, 'A', 'B')).toEqual({ A: 'one', B: 'two' });
  });

  it('throws MissingAppCredsError listing the missing vars', () => {
    const env = { A: 'one' } as unknown as Env;
    expect(() => requireEnv(env, 'twitter', DEEP, 'A', 'B')).toThrow(MissingAppCredsError);
    try {
      requireEnv(env, 'twitter', DEEP, 'A', 'B');
    } catch (e) {
      const err = e as MissingAppCredsError;
      expect(err.platform).toBe('twitter');
      expect(err.deeplink).toBe(DEEP);
      expect(err.message).toContain('B');
      expect(err.message).toContain(DEEP);
      expect(err.name).toBe('MissingAppCredsError');
    }
  });

  it('treats an empty-string var as missing', () => {
    const env = { A: '' } as unknown as Env;
    expect(() => requireEnv(env, 'slack', DEEP, 'A')).toThrow(MissingAppCredsError);
  });
});

describe('emptyAnalytics', () => {
  it('returns an all-null snapshot with raw defaulting to null', () => {
    expect(emptyAnalytics()).toEqual({
      impressions: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      clicks: null,
      saves: null,
      raw: null,
    });
  });

  it('passes the raw payload through', () => {
    expect(emptyAnalytics({ status: 429 }).raw).toEqual({ status: 429 });
  });
});
