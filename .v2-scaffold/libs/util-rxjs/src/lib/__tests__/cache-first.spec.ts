import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { cacheFirst } from '../cache-first.js';

describe('cacheFirst', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes factory once within TTL', async () => {
    const factory = vi.fn(() => of({ n: Math.random() }));
    const obs$ = cacheFirst(factory, 1_000);

    const first = await firstValueFrom(obs$);
    const second = await firstValueFrom(obs$);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-invokes factory after TTL expires', async () => {
    let counter = 0;
    const factory = vi.fn(() => of({ n: ++counter }));
    const obs$ = cacheFirst(factory, 100);

    const first = await firstValueFrom(obs$);
    vi.setSystemTime(Date.now() + 250);
    const second = await firstValueFrom(obs$);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.n).toBe(1);
    expect(second.n).toBe(2);
  });
});
