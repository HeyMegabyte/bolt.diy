/**
 * @module durable_objects/voice_browse_agent.spec
 * @description Unit specs for the pure helpers exported from
 * `voice_browse_agent.ts`. The DO class itself wraps Cloudflare Containers
 * runtime that cannot be instantiated in Node — these specs cover the
 * deterministic helpers that carry the load-bearing invariants:
 *   - PII redaction
 *   - letter-by-letter narration chunking
 *   - restart 3/min cap
 *   - tool dispatch normalisation
 */

import {
  chunkNarration,
  dispatchAction,
  narrateAction,
  sanitisePII,
  shouldRestart,
} from './voice_browse_helpers.js';

describe('sanitisePII', () => {
  it('masks 16-digit credit card numbers leaving last 4', () => {
    const out = sanitisePII('Charge 4111 1111 1111 1234 to account');
    expect(out).toMatch(/\[card ending 1234\]/);
    expect(out).not.toMatch(/4111\s*1111\s*1111\s*1234/);
  });

  it('masks dashed credit cards', () => {
    const out = sanitisePII('Card: 4111-1111-1111-9876');
    expect(out).toMatch(/\[card ending 9876\]/);
  });

  it('redacts SSN', () => {
    expect(sanitisePII('My ssn is 123-45-6789 please')).toContain('[ssn]');
  });

  it('redacts password=value patterns', () => {
    const out = sanitisePII('login with password=hunter2 and api_key=sk-abc');
    expect(out).toContain('password=[redacted]');
    expect(out).toContain('api_key=[redacted]');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('sk-abc');
  });

  it('redacts CVV', () => {
    const out = sanitisePII('cvv 123 on the back');
    expect(out).toContain('cvv [redacted]');
  });

  it('passes safe text through unchanged', () => {
    expect(sanitisePII('weather in 60201')).toBe('weather in 60201');
  });
});

describe('chunkNarration', () => {
  it('splits at word + sentence boundaries', () => {
    const chunks = chunkNarration('Hello world. How are you?');
    expect(chunks.join('')).toBe('Hello world. How are you?');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0].endsWith(' ')).toBe(true);
  });

  it('handles trailing text without delimiter', () => {
    const chunks = chunkNarration('hello');
    expect(chunks).toEqual(['hello']);
  });

  it('handles empty input', () => {
    expect(chunkNarration('')).toEqual([]);
  });
});

describe('shouldRestart (3-per-rolling-minute cap)', () => {
  const now = 1_000_000;

  it('allows first restart when window empty', () => {
    expect(shouldRestart([], now)).toBe(true);
  });

  it('allows up to 3 restarts inside the rolling minute', () => {
    expect(shouldRestart([now - 1000, now - 2000], now)).toBe(true);
  });

  it('refuses the 4th restart in the 60s window', () => {
    expect(shouldRestart([now - 1000, now - 10_000, now - 25_000], now)).toBe(false);
  });

  it('discounts timestamps outside the 60s window', () => {
    // Three restarts but all >60s old → fresh allowance.
    expect(shouldRestart([now - 70_000, now - 80_000, now - 90_000], now)).toBe(true);
  });
});

describe('dispatchAction', () => {
  it('accepts a valid goto', () => {
    expect(dispatchAction({ type: 'goto', url: 'https://example.com' })).toEqual({
      type: 'goto',
      url: 'https://example.com',
    });
  });

  it('rejects non-http goto urls', () => {
    expect(() => dispatchAction({ type: 'goto', url: 'javascript:alert(1)' })).toThrow();
  });

  it('accepts click + type + extract', () => {
    expect(dispatchAction({ type: 'click', selector: 'button' }).type).toBe('click');
    expect(dispatchAction({ type: 'type', selector: 'input', text: 'hi' }).type).toBe('type');
    expect(dispatchAction({ type: 'extract', selector: 'h1' }).type).toBe('extract');
  });

  it('accepts screenshot with no extra args', () => {
    expect(dispatchAction({ type: 'screenshot' })).toEqual({ type: 'screenshot' });
  });

  it('accepts wait with ms or selector', () => {
    expect(dispatchAction({ type: 'wait', ms: 250 })).toEqual({
      type: 'wait',
      selector: undefined,
      ms: 250,
    });
    expect(dispatchAction({ type: 'wait', selector: '#ready' })).toEqual({
      type: 'wait',
      selector: '#ready',
      ms: undefined,
    });
  });

  it('rejects unknown types', () => {
    expect(() => dispatchAction({ type: 'evil' })).toThrow(/Unknown action/);
  });

  it('rejects non-object input', () => {
    expect(() => dispatchAction(null)).toThrow();
    expect(() => dispatchAction('goto')).toThrow();
  });
});

describe('narrateAction', () => {
  it('produces human-readable narration per action type', () => {
    expect(narrateAction({ type: 'goto', url: 'https://x.com' })).toMatch(/Opening/);
    expect(narrateAction({ type: 'click', selector: '#btn' })).toMatch(/Clicking #btn/);
    expect(narrateAction({ type: 'type', selector: 'input', text: 'hi' })).toMatch(/Typing/);
    expect(narrateAction({ type: 'screenshot' })).toMatch(/screenshot/);
    expect(narrateAction({ type: 'wait', ms: 100 })).toMatch(/Waiting 100ms/);
    expect(narrateAction({ type: 'wait', selector: '#x' })).toMatch(/Waiting for #x/);
  });
});
