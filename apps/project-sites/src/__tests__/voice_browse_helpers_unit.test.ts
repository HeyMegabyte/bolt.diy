import {
  sanitisePII,
  chunkNarration,
  dispatchAction,
  shouldRestart,
  narrateAction,
  RESTART_MAX_PER_WINDOW,
  RESTART_WINDOW_MS,
} from '../durable_objects/voice_browse_helpers.js';

describe('sanitisePII', () => {
  it('masks a credit-card number to the last 4 (full PAN never survives)', () => {
    const out = sanitisePII('pay with 4111 1111 1111 1111 now');
    expect(out).toContain('[card ending 1111]');
    expect(out).not.toMatch(/4111[ -]?1111/); // the PAN is gone
  });
  it('redacts SSN, password-shaped pairs, and CVV', () => {
    expect(sanitisePII('ssn 123-45-6789')).toContain('[ssn]');
    expect(sanitisePII('password=hunter2')).toBe('password=[redacted]');
    expect(sanitisePII('api_key: sk-abc123')).toBe('api_key=[redacted]');
    expect(sanitisePII('cvv 123')).toBe('cvv [redacted]');
  });
  it('leaves clean text untouched', () => {
    expect(sanitisePII('Opening the homepage.')).toBe('Opening the homepage.');
  });
});

describe('chunkNarration', () => {
  it('splits on word boundaries and rejoins to the original', () => {
    const text = 'Hello there, world!';
    const chunks = chunkNarration(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });
  it('returns [] for empty input', () => {
    expect(chunkNarration('')).toEqual([]);
  });
  it('keeps a trailing word with no terminal punctuation', () => {
    expect(chunkNarration('hi').join('')).toBe('hi');
  });
});

describe('dispatchAction', () => {
  it('normalises each valid action type', () => {
    expect(dispatchAction({ type: 'goto', url: 'https://x.com' })).toEqual({
      type: 'goto',
      url: 'https://x.com',
    });
    expect(dispatchAction({ type: 'click', selector: '#b' })).toEqual({
      type: 'click',
      selector: '#b',
    });
    expect(dispatchAction({ type: 'type', selector: '#i', text: 'hi' })).toEqual({
      type: 'type',
      selector: '#i',
      text: 'hi',
    });
    expect(dispatchAction({ type: 'extract', selector: '.p' })).toEqual({
      type: 'extract',
      selector: '.p',
    });
    expect(dispatchAction({ type: 'screenshot' })).toEqual({ type: 'screenshot' });
    expect(dispatchAction({ type: 'wait', ms: 500 })).toEqual({
      type: 'wait',
      selector: undefined,
      ms: 500,
    });
  });
  it('rejects bad input', () => {
    expect(() => dispatchAction(null)).toThrow(/must be an object/);
    expect(() => dispatchAction({ type: 'goto', url: 'ftp://x' })).toThrow(/http\(s\) url/);
    expect(() => dispatchAction({ type: 'click' })).toThrow(/selector/);
    expect(() => dispatchAction({ type: 'nope' })).toThrow(/Unknown action/);
  });
});

describe('shouldRestart', () => {
  const now = 1_000_000;
  it('allows restarts under the per-window cap', () => {
    expect(shouldRestart([], now)).toBe(true);
    expect(shouldRestart([now - 1, now - 2], now)).toBe(true); // 2 < 3
  });
  it('blocks once the window is saturated', () => {
    const recent = Array.from({ length: RESTART_MAX_PER_WINDOW }, (_, i) => now - i);
    expect(shouldRestart(recent, now)).toBe(false);
  });
  it('ignores timestamps outside the rolling window', () => {
    const old = Array.from({ length: 5 }, () => now - RESTART_WINDOW_MS - 1);
    expect(shouldRestart(old, now)).toBe(true);
  });
});

describe('narrateAction', () => {
  it('produces human-readable narration per type', () => {
    expect(narrateAction({ type: 'goto', url: 'https://x.com' })).toMatch(
      /Opening https:\/\/x\.com/,
    );
    expect(narrateAction({ type: 'screenshot' })).toMatch(/screenshot/i);
    expect(narrateAction({ type: 'wait', ms: 300 })).toMatch(/300ms/);
    expect(narrateAction({ type: 'wait', selector: '#x' })).toMatch(/Waiting for #x/);
  });
});
