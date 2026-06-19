import { DedupWindow, DEFAULT_DEDUP_WINDOW_MS } from '../services/event_dedup';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('DedupWindow', () => {
  it('markIfNew returns true the first time and false within the window', () => {
    const d = new DedupWindow();
    expect(d.markIfNew('e1', T0)).toBe(true);
    expect(d.markIfNew('e1', T0 + HOUR)).toBe(false); // duplicate, still inside 48h
  });

  it('treats an id as new again once the window has elapsed', () => {
    const d = new DedupWindow();
    d.markIfNew('e1', T0);
    expect(d.markIfNew('e1', T0 + DEFAULT_DEDUP_WINDOW_MS)).toBe(true); // expired exactly at boundary
  });

  it('has() is read-only and respects expiry', () => {
    const d = new DedupWindow();
    d.add('e1', T0);
    expect(d.has('e1', T0 + HOUR)).toBe(true);
    expect(d.has('e1', T0 + DEFAULT_DEDUP_WINDOW_MS + 1)).toBe(false);
    expect(d.has('missing', T0)).toBe(false);
  });

  it('prune drops expired entries and reports the count', () => {
    const d = new DedupWindow(2 * HOUR);
    d.add('a', T0);
    d.add('b', T0 + HOUR); // expires later
    expect(d.size).toBe(2);
    const pruned = d.prune(T0 + 2 * HOUR + 1); // 'a' expired (T0+2h), 'b' not (T0+3h)
    expect(pruned).toBe(1);
    expect(d.size).toBe(1);
    expect(d.has('b', T0 + 2 * HOUR + 1)).toBe(true);
  });

  it('snapshot round-trips through fromSnapshot preserving dedup state', () => {
    const d = new DedupWindow();
    d.markIfNew('e1', T0);
    d.markIfNew('e2', T0);
    const snap = d.snapshot();
    expect(snap).toHaveLength(2);
    const restored = DedupWindow.fromSnapshot(snap);
    expect(restored.markIfNew('e1', T0 + HOUR)).toBe(false); // still a duplicate after restore
    expect(restored.markIfNew('e3', T0 + HOUR)).toBe(true);
  });

  it('a zero-length window dedups nothing (every id is always new)', () => {
    const d = new DedupWindow(0);
    expect(d.markIfNew('e1', T0)).toBe(true);
    expect(d.markIfNew('e1', T0)).toBe(true); // expiresAt == now → not live
  });
});
