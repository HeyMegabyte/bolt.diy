/**
 * Unit coverage for `prompts/social_persona.ts` → `SOCIAL_PERSONA_SYSTEM_PROMPT`.
 * Previously untested. The function maps a (possibly aliased / cased / `reddit:sub`)
 * platform string to a per-platform prompt block, falls back to LinkedIn for
 * anything unknown, and composes [dashboard persona, platform block, output
 * contract]. These branches drive the brand voice on every social AI call.
 */
import { SOCIAL_PERSONA_SYSTEM_PROMPT } from '../prompts/social_persona.js';

describe('SOCIAL_PERSONA_SYSTEM_PROMPT', () => {
  it('maps each canonical platform to its own block', () => {
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('twitter')).toContain('PLATFORM — Twitter / X');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('linkedin')).toContain('PLATFORM — LinkedIn');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('facebook')).toContain('PLATFORM — Facebook');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('instagram')).toContain('PLATFORM — Instagram');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('threads')).toContain('PLATFORM — Threads');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('bluesky')).toContain('PLATFORM — Bluesky');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('mastodon')).toContain('PLATFORM — Mastodon');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('discord')).toContain('PLATFORM — Discord');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('slack')).toContain('PLATFORM — Slack');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('telegram')).toContain('PLATFORM — Telegram');
  });

  it('resolves the short aliases (x/fb/ig/bsky/tg)', () => {
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('x')).toContain('PLATFORM — Twitter / X');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('fb')).toContain('PLATFORM — Facebook');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('ig')).toContain('PLATFORM — Instagram');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('bsky')).toContain('PLATFORM — Bluesky');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('tg')).toContain('PLATFORM — Telegram');
  });

  it('parses the subreddit out of a reddit:sub platform string', () => {
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('reddit:askprogramming')).toContain('r/askprogramming');
    // bare "reddit" → r/all
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('reddit')).toContain('r/all');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('  LinkedIn  ')).toContain('PLATFORM — LinkedIn');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('TWITTER')).toContain('PLATFORM — Twitter / X');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('Reddit:AskProgramming')).toContain('r/askprogramming');
  });

  it('falls back to the LinkedIn block for unknown / empty platforms', () => {
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('myspace')).toContain('PLATFORM — LinkedIn');
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT('')).toContain('PLATFORM — LinkedIn');
    // @ts-expect-error — defensive: the fn guards against a nullish platform
    expect(SOCIAL_PERSONA_SYSTEM_PROMPT(undefined)).toContain('PLATFORM — LinkedIn');
  });

  it('always composes the dashboard persona + the output contract around the platform block', () => {
    const out = SOCIAL_PERSONA_SYSTEM_PROMPT('twitter');
    expect(out).toContain('OUTPUT CONTRACT');
    expect(out).toMatch(/VOICE/); // dashboard persona header
    // platform block sits between persona and contract
    expect(out.indexOf('PLATFORM — Twitter')).toBeLessThan(out.indexOf('OUTPUT CONTRACT'));
  });
});
