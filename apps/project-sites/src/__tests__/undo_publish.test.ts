import {
  computeUndoWindow,
  formatUndoCountdown,
  UNDO_WINDOW_MS,
} from '../services/undo_publish.js';

describe('computeUndoWindow (S17 undo-publish)', () => {
  it('reports the window open with seconds remaining mid-window', () => {
    const s = computeUndoWindow(1000, 1000 + 60_000);
    expect(s.withinWindow).toBe(true);
    expect(s.expired).toBe(false);
    expect(s.secondsRemaining).toBe(240); // 5min - 1min
    expect(s.expiresAtMs).toBe(1000 + UNDO_WINDOW_MS);
  });

  it('reports expired once the window has passed', () => {
    const s = computeUndoWindow(1000, 1000 + UNDO_WINDOW_MS + 1);
    expect(s.withinWindow).toBe(false);
    expect(s.expired).toBe(true);
    expect(s.secondsRemaining).toBe(0);
  });

  it('gives the full window when now precedes publish (clock skew)', () => {
    const s = computeUndoWindow(10_000, 5_000);
    expect(s.withinWindow).toBe(true);
    expect(s.secondsRemaining).toBe(UNDO_WINDOW_MS / 1000);
  });

  it('accepts ISO-string timestamps', () => {
    const pub = '2026-06-29T00:00:00.000Z';
    const now = '2026-06-29T00:02:00.000Z';
    const s = computeUndoWindow(pub, now);
    expect(s.withinWindow).toBe(true);
    expect(s.secondsRemaining).toBe(180);
  });

  it('honors a custom window length', () => {
    const s = computeUndoWindow(0, 30_000, 60_000);
    expect(s.secondsRemaining).toBe(30);
  });

  it('treats a non-positive window as immediately expired', () => {
    expect(computeUndoWindow(0, 0, 0).expired).toBe(true);
    expect(computeUndoWindow(0, 0, -5).expired).toBe(true);
  });

  it('returns an expired window for unparseable inputs (never throws)', () => {
    expect(computeUndoWindow(null, 1000).expired).toBe(true);
    expect(computeUndoWindow(1000, 'not-a-date').expired).toBe(true);
    expect(computeUndoWindow(undefined, undefined).withinWindow).toBe(false);
  });
});

describe('formatUndoCountdown (S17)', () => {
  it('formats m:ss with zero-padding', () => {
    expect(formatUndoCountdown(272)).toBe('4:32');
    expect(formatUndoCountdown(9)).toBe('0:09');
    expect(formatUndoCountdown(60)).toBe('1:00');
  });

  it('clamps negatives / non-finite to 0:00', () => {
    expect(formatUndoCountdown(-5)).toBe('0:00');
    expect(formatUndoCountdown(NaN)).toBe('0:00');
  });
});
