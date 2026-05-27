import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { fromEventSource } from '../from-event-source.js';

interface MockEventSource {
  readyState: number;
  url: string | URL;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _listeners: Map<string, Set<EventListener>>;
  dispatch(event: string, payload: { data: string } | Event): void;
}

function createMockEventSource(): {
  EventSourceCtor: ReturnType<typeof vi.fn>;
  lastInstance: () => MockEventSource;
} {
  let last: MockEventSource | null = null;
  const ctor = vi.fn((url: string | URL) => {
    const listeners = new Map<string, Set<EventListener>>();
    const inst: MockEventSource = {
      readyState: 1,
      url,
      addEventListener: vi.fn((name: string, fn: EventListener) => {
        let set = listeners.get(name);
        if (!set) {
          set = new Set();
          listeners.set(name, set);
        }
        set.add(fn);
      }),
      removeEventListener: vi.fn((name: string, fn: EventListener) => {
        listeners.get(name)?.delete(fn);
      }),
      close: vi.fn(() => {
        inst.readyState = 2;
      }),
      _listeners: listeners,
      dispatch(name, payload) {
        listeners.get(name)?.forEach((fn) => fn(payload as Event));
      },
    };
    last = inst;
    return inst;
  });
  return {
    EventSourceCtor: ctor,
    lastInstance: (): MockEventSource => {
      if (!last) throw new Error('EventSource has not been constructed yet');
      return last;
    },
  };
}

describe('fromEventSource', () => {
  let restore: () => void;

  beforeEach(() => {
    const original = (globalThis as { EventSource?: unknown }).EventSource;
    restore = () => {
      (globalThis as { EventSource?: unknown }).EventSource = original;
    };
  });

  afterEach(() => {
    restore();
  });

  it('emits parsed JSON values from `message` events', async () => {
    const { EventSourceCtor, lastInstance } = createMockEventSource();
    (globalThis as { EventSource: unknown; CLOSED?: number }).EventSource =
      EventSourceCtor as unknown as typeof EventSource;
    (EventSourceCtor as unknown as { CLOSED: number }).CLOSED = 2;

    const stream$ = fromEventSource<{ n: number }>('/sse').pipe(take(2), toArray());
    const collected = firstValueFrom(stream$);
    queueMicrotask(() => {
      lastInstance().dispatch('message', { data: JSON.stringify({ n: 1 }) });
      lastInstance().dispatch('message', { data: JSON.stringify({ n: 2 }) });
    });

    await expect(collected).resolves.toEqual([{ n: 1 }, { n: 2 }]);
    expect(lastInstance().close).toHaveBeenCalled();
  });

  it('errors when EventSource is unavailable', async () => {
    (globalThis as { EventSource?: unknown }).EventSource = undefined;
    await expect(firstValueFrom(fromEventSource('/sse'))).rejects.toThrow(/EventSource/);
  });
});
