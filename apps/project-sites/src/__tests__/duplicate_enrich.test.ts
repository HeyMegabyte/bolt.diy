/**
 * @module __tests__/duplicate_enrich
 * @description Unit tests for duplicate detection and body enrichment.
 * Tests pure functions: detectDuplicate and enrichBody.
 */

import { detectDuplicate, enrichBody } from '../services/duplicate_enrich.js';
import type { IssueInput } from '../services/duplicate_enrich.js';

// ── Helpers ──────────────────────────────────────────────────────

function issue(overrides: Partial<IssueInput> & { title: string }): IssueInput {
  return { body: '', id: undefined, ...overrides };
}

// ── detectDuplicate ──────────────────────────────────────────────

describe('detectDuplicate', () => {
  it('returns no duplicate when existing is empty', () => {
    const result = detectDuplicate({ title: 'Login broken', body: '' }, []);
    expect(result).toEqual({ isDuplicate: false, similarTo: null, similarity: 0 });
  });

  it('never throws on any input', () => {
    expect(() => detectDuplicate({ title: '', body: '' }, [issue({ title: 'X' })])).not.toThrow();
    expect(() => detectDuplicate({ title: 'A', body: 'B' }, [issue({ title: 'A' })])).not.toThrow();
    expect(() => detectDuplicate({ title: '', body: '' }, [])).not.toThrow();
  });

  it('detects an exact title match as duplicate', () => {
    const existing = [issue({ title: 'Login fails on Safari', id: 'ISS-1' })];
    const result = detectDuplicate({ title: 'Login fails on Safari', body: '…' }, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarTo).toBe('ISS-1');
    expect(result.similarity).toBe(100);
  });

  it('detects a near-identical rephrasing as duplicate', () => {
    const existing = [issue({ title: 'Login fails on Safari browser', id: 'ISS-1' })];
    const result = detectDuplicate({ title: 'Login fails on Safari', body: '…' }, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarTo).toBe('ISS-1');
    // 4 of 5 trigrams match: ~0.8 → 80
    expect(result.similarity).toBeGreaterThanOrEqual(60);
  });

  it('does not flag unrelated titles', () => {
    const existing = [issue({ title: 'Add dark mode support', id: 'ISS-2' })];
    const result = detectDuplicate(
      { title: 'Payment gateway timeout on checkout', body: '…' },
      existing,
    );
    expect(result.isDuplicate).toBe(false);
    expect(result.similarTo).toBeNull();
    expect(result.similarity).toBeLessThan(60);
  });

  it('returns null similarTo when no duplicate found', () => {
    const existing = [issue({ title: 'Fix header alignment', id: 'ISS-3' })];
    const result = detectDuplicate({ title: 'Refactor database layer', body: '' }, existing);
    expect(result.isDuplicate).toBe(false);
    expect(result.similarTo).toBeNull();
  });

  it('matches case-insensitively', () => {
    const existing = [issue({ title: 'LOGIN FAILS ON SAFARI', id: 'ISS-4' })];
    const result = detectDuplicate({ title: 'login fails on safari', body: '' }, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBe(100);
  });

  it('ignores punctuation in punctuation-only difference', () => {
    const existing = [issue({ title: 'Save preferences not working', id: 'ISS-5' })];
    const result = detectDuplicate({ title: 'Save preferences not working!', body: '' }, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBe(100);
  });

  it('returns similarTo as null when matching issue has no id', () => {
    const existing = [issue({ title: 'Page crashes on load' })];
    const result = detectDuplicate({ title: 'Page crashes on load', body: '' }, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarTo).toBeNull();
    expect(result.similarity).toBe(100);
  });

  it('finds the best match among multiple candidates', () => {
    // ISS-8 shares more trigrams with the input than any other
    const existing = [
      issue({ title: 'Fix typo in footer', id: 'ISS-6' }),
      issue({ title: 'Login button not working in Chrome', id: 'ISS-7' }),
      issue({ title: 'Safari login page broken', id: 'ISS-8' }),
    ];
    const result = detectDuplicate(
      { title: 'Safari login page broken on macOS', body: '' },
      existing,
    );
    // ISS-8 'Safari login page broken' should be the best match
    expect(result.similarTo).toBe('ISS-8');
    // ISS-8 shares 2 × 3-word trigrams out of ~4 unique → score ~0.4, below threshold
    expect(result.isDuplicate).toBe(false);
  });

  it('returns 0 similarity for empty incoming title', () => {
    const existing = [issue({ title: 'Some issue', id: 'ISS-9' })];
    const result = detectDuplicate({ title: '', body: '' }, existing);
    expect(result).toEqual({ isDuplicate: false, similarTo: null, similarity: 0 });
  });

  it('returns 0 similarity for very short titles (<3 words)', () => {
    const existing = [issue({ title: 'Fix bug', id: 'ISS-10' })];
    const result = detectDuplicate({ title: 'Fix bug', body: '' }, existing);
    expect(result).toEqual({ isDuplicate: false, similarTo: null, similarity: 0 });
  });

  it('prefers a match with id over an equally similar id-less match', () => {
    const existing = [
      issue({ title: 'Profile avatar not updating on signup' }), // no id — same trigrams as the id'd one
      issue({ title: 'Profile avatar not updating on signup', id: 'ISS-11' }),
    ];
    const result = detectDuplicate(
      { title: 'Profile avatar not updating on signup flow', body: '' },
      existing,
    );
    // Both existing issues share the same trigrams; the one with id wins
    expect(result.similarTo).toBe('ISS-11');
  });
});

// ── enrichBody ───────────────────────────────────────────────────

describe('enrichBody', () => {
  it('counts words in a plain body', () => {
    expect(enrichBody('Hello world')).toEqual({ wordCount: 2, hasCode: false, hasUrl: false });
  });

  it('counts words with extra whitespace', () => {
    expect(enrichBody('   Lots   of   spaces   ')).toEqual({
      wordCount: 3,
      hasCode: false,
      hasUrl: false,
    });
  });

  it('returns zero word count for empty body', () => {
    expect(enrichBody('')).toEqual({ wordCount: 0, hasCode: false, hasUrl: false });
  });

  it('returns zero word count for whitespace-only body', () => {
    expect(enrichBody('   ')).toEqual({ wordCount: 0, hasCode: false, hasUrl: false });
  });

  it('detects inline code with backticks', () => {
    expect(enrichBody('Call `handleClick()` on submit')).toMatchObject({ hasCode: true });
  });

  it('detects fenced code blocks', () => {
    expect(
      enrichBody(`Here is the code:
\`\`\`ts
const x = 1;
\`\`\``),
    ).toMatchObject({ hasCode: true });
  });

  it('detects URLs in body', () => {
    expect(enrichBody('See https://example.com/issue for details')).toMatchObject({
      hasUrl: true,
    });
  });

  it('detects www-style URLs', () => {
    expect(enrichBody('Visit www.example.com for more info')).toMatchObject({ hasUrl: true });
  });

  it('detects both code and URL simultaneously', () => {
    const result = enrichBody('Run `npm test` as shown at https://docs.example.com');
    expect(result).toEqual({ wordCount: 7, hasCode: true, hasUrl: true });
  });

  it('never throws on any input', () => {
    expect(() => enrichBody('')).not.toThrow();
    expect(() => enrichBody(null as unknown as string)).not.toThrow();
    expect(() => enrichBody(undefined as unknown as string)).not.toThrow();
    expect(() => enrichBody('a'.repeat(10000))).not.toThrow();
  });

  it('handles body with only code', () => {
    const result = enrichBody('`some code`');
    expect(result.wordCount).toBe(2);
    expect(result.hasCode).toBe(true);
    expect(result.hasUrl).toBe(false);
  });

  it('handles body with only URL', () => {
    const result = enrichBody('https://example.com');
    expect(result.wordCount).toBe(1);
    expect(result.hasCode).toBe(false);
    expect(result.hasUrl).toBe(true);
  });
});
