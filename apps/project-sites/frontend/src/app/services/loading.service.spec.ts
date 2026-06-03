import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LoadingService } from './loading.service';

/**
 * Coverage for LoadingService — the global + per-key loading-state primitive behind
 * every admin spinner/skeleton. Reliability contract: a stuck loading key can't leave a
 * permanent spinner — it auto-cleans after the 60s stale timeout; start/stop drive both the
 * global signal and stable per-key signals.
 */
function svc(): LoadingService {
  TestBed.configureTestingModule({ providers: [LoadingService] });
  return TestBed.inject(LoadingService);
}

describe('LoadingService (global + per-key + stale cleanup)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('startLoading sets global + per-key true; stopLoading clears both', () => {
    const s = svc();
    const key = s.isLoading('sites');
    expect(s.loading()).toBe(false);
    s.startLoading('sites');
    expect(s.loading()).toBe(true);
    expect(key()).toBe(true);
    s.stopLoading('sites');
    expect(s.loading()).toBe(false);
    expect(key()).toBe(false);
  });

  it('global stays true while ANY key is active', () => {
    const s = svc();
    s.startLoading('a');
    s.startLoading('b');
    s.stopLoading('a');
    expect(s.loading()).toBe(true); // b still active
    s.stopLoading('b');
    expect(s.loading()).toBe(false);
  });

  it('isLoading returns a STABLE signal per key (same reference)', () => {
    const s = svc();
    expect(s.isLoading('x')).toBe(s.isLoading('x'));
  });

  it('a stale loading key auto-cleans after the 60s timeout (no stuck spinner)', fakeAsync(() => {
    const s = svc();
    s.startLoading('hung');
    expect(s.loading()).toBe(true);
    tick(60_000);
    expect(s.loading()).toBe(false); // auto-cleaned
  }));

  it('re-starting a key resets its stale timer (does not double-fire)', fakeAsync(() => {
    const s = svc();
    s.startLoading('k');
    tick(40_000);
    s.startLoading('k'); // reset the 60s clock
    tick(40_000); // 80s since first start, but only 40s since reset → still loading
    expect(s.loading()).toBe(true);
    tick(20_000); // now 60s since reset
    expect(s.loading()).toBe(false);
  }));

  it('stopLoading clears the stale timer (no late auto-stop side effect)', fakeAsync(() => {
    const s = svc();
    s.startLoading('k');
    s.stopLoading('k');
    s.startLoading('k'); // fresh start; the FIRST timer must not fire and stop this one early
    tick(59_000);
    expect(s.loading()).toBe(true);
  }));
});
