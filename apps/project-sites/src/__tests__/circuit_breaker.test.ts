import { CircuitBreaker } from '../services/circuit_breaker';

const T0 = 1_000_000; // arbitrary fixed epoch ms — deterministic, no real clock

describe('CircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe('closed');
    expect(cb.allowRequest(T0)).toBe(true);
    expect(cb.isOpen()).toBe(false);
  });

  it('stays closed below the failure threshold, opens AT the threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure(T0 + i);
    expect(cb.state).toBe('closed'); // 4 < 5
    expect(cb.allowRequest(T0)).toBe(true);
    cb.recordFailure(T0 + 4); // 5th consecutive failure
    expect(cb.state).toBe('open');
  });

  it('an open breaker denies requests before the reset timeout elapses', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0);
    expect(cb.state).toBe('open');
    expect(cb.allowRequest(T0 + 59_999)).toBe(false); // still within the open window
  });

  it('transitions open → half_open once the reset timeout elapses, allowing one trial', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0);
    expect(cb.allowRequest(T0 + 60_000)).toBe(true);
    expect(cb.state).toBe('half_open');
  });

  it('half_open success closes the breaker and resets the failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0);
    cb.allowRequest(T0 + 60_000); // → half_open
    cb.recordSuccess(T0 + 60_100);
    expect(cb.state).toBe('closed');
    expect(cb.snapshot().failCount).toBe(0);
    expect(cb.snapshot().lastSuccessAt).toBe(T0 + 60_100);
  });

  it('half_open failure re-opens immediately and restarts the timer', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0); // 1 failure, still closed
    // force open by reaching threshold
    for (let i = 1; i < 5; i++) cb.recordFailure(T0 + i);
    expect(cb.state).toBe('open');
    expect(cb.allowRequest(T0 + 60_010)).toBe(true); // → half_open
    cb.recordFailure(T0 + 60_020); // single half-open failure re-opens
    expect(cb.state).toBe('open');
    expect(cb.allowRequest(T0 + 60_021)).toBe(false); // timer restarted from the new failure
    expect(cb.allowRequest(T0 + 60_020 + 60_000)).toBe(true); // elapsed again → half_open
  });

  it('a success in the closed state resets an accumulating failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    cb.recordFailure(T0);
    cb.recordFailure(T0 + 1);
    expect(cb.snapshot().failCount).toBe(2);
    cb.recordSuccess(T0 + 2);
    expect(cb.snapshot().failCount).toBe(0);
    // now it takes a full 5 fresh failures to open again
    for (let i = 0; i < 4; i++) cb.recordFailure(T0 + 3 + i);
    expect(cb.state).toBe('closed');
  });

  it('peek() reflects the would-be half_open without consuming the trial', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0);
    expect(cb.peek(T0 + 30_000)).toBe('open'); // not yet elapsed
    expect(cb.peek(T0 + 60_000)).toBe('half_open'); // elapsed
    expect(cb.state).toBe('open'); // peek did not mutate
  });

  it('snapshot round-trips through fromSnapshot, preserving state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
    cb.recordFailure(T0);
    cb.recordFailure(T0 + 1);
    cb.recordFailure(T0 + 2); // opens
    const snap = cb.snapshot();
    const restored = CircuitBreaker.fromSnapshot(snap, {
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
    });
    expect(restored.state).toBe('open');
    expect(restored.snapshot()).toEqual(snap);
    expect(restored.allowRequest(T0 + 2 + 60_000)).toBe(true); // honors the persisted timer
  });

  it('clamps a zero/negative threshold to 1 (one failure opens it)', () => {
    const cb = new CircuitBreaker({ failureThreshold: 0 });
    cb.recordFailure(T0);
    expect(cb.state).toBe('open');
  });
});
