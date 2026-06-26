import { describe, it, expect } from '@jest/globals';
import { buildPromptKey, parsePromptKey } from '../prompts/types.js';

// ── buildPromptKey ───────────────────────────────────────────────

describe('buildPromptKey', () => {
  it('builds a key without variant', () => {
    expect(buildPromptKey('research_business', 1)).toBe('research_business@1');
  });

  it('builds a key with a variant', () => {
    expect(buildPromptKey('generate_site', 3, 'a')).toBe('generate_site@3:a');
  });

  it('builds a key with version 0', () => {
    expect(buildPromptKey('score_quality', 0)).toBe('score_quality@0');
  });

  it('builds a key with a large version number', () => {
    expect(buildPromptKey('site_copy', 999)).toBe('site_copy@999');
  });

  it('omits the colon separator when variant is undefined', () => {
    const key = buildPromptKey('my_prompt', 2, undefined);
    expect(key).toBe('my_prompt@2');
    expect(key).not.toContain(':');
  });

  it('returns base form when variant is empty string (falsy)', () => {
    // variant='' is falsy — ternary returns the base, no colon appended
    const key = buildPromptKey('my_prompt', 2, '');
    expect(key).toBe('my_prompt@2');
  });

  it('preserves underscores and hyphens in the id', () => {
    expect(buildPromptKey('my-prompt_v2', 1)).toBe('my-prompt_v2@1');
  });

  it('builds a key with a multi-character variant label', () => {
    expect(buildPromptKey('ab_test', 5, 'control')).toBe('ab_test@5:control');
  });
});

// ── parsePromptKey ───────────────────────────────────────────────

describe('parsePromptKey', () => {
  it('parses a key without variant', () => {
    const result = parsePromptKey('research_business@1');
    expect(result.id).toBe('research_business');
    expect(result.version).toBe(1);
    expect(result.variant).toBeUndefined();
  });

  it('parses a key with a single-char variant', () => {
    const result = parsePromptKey('generate_site@3:a');
    expect(result.id).toBe('generate_site');
    expect(result.version).toBe(3);
    expect(result.variant).toBe('a');
  });

  it('parses a key with a multi-char variant', () => {
    const result = parsePromptKey('ab_test@5:control');
    expect(result.id).toBe('ab_test');
    expect(result.version).toBe(5);
    expect(result.variant).toBe('control');
  });

  it('parses version 0', () => {
    const result = parsePromptKey('score_quality@0');
    expect(result.id).toBe('score_quality');
    expect(result.version).toBe(0);
  });

  it('parses a large version number', () => {
    const result = parsePromptKey('site_copy@999');
    expect(result.version).toBe(999);
  });

  it('returns version as a number, not a string', () => {
    const result = parsePromptKey('my_prompt@7');
    expect(typeof result.version).toBe('number');
    expect(result.version).toBe(7);
  });

  it('round-trips buildPromptKey → parsePromptKey without variant', () => {
    const key = buildPromptKey('research_business', 2);
    const parsed = parsePromptKey(key);
    expect(parsed.id).toBe('research_business');
    expect(parsed.version).toBe(2);
    expect(parsed.variant).toBeUndefined();
  });

  it('round-trips buildPromptKey → parsePromptKey with variant', () => {
    const key = buildPromptKey('generate_site', 4, 'b');
    const parsed = parsePromptKey(key);
    expect(parsed.id).toBe('generate_site');
    expect(parsed.version).toBe(4);
    expect(parsed.variant).toBe('b');
  });

  it('handles ids that contain hyphens and underscores', () => {
    const result = parsePromptKey('my-prompt_v2@1');
    expect(result.id).toBe('my-prompt_v2');
    expect(result.version).toBe(1);
  });

  it('handles variant strings that contain hyphens', () => {
    const key = buildPromptKey('promo', 1, 'v2-alt');
    const parsed = parsePromptKey(key);
    expect(parsed.variant).toBe('v2-alt');
  });
});
