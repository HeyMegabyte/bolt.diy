/**
 * auth_anomaly — new-IP / new-device login-anomaly detection (#44).
 * Locks the pure `assess` verdict logic + the KV-backed `recordAndAssess` wrapper
 * (read prior → verdict → write merged history), including its fail-soft behavior.
 */
import { assess, recordAndAssess, HISTORY_CAP } from '../services/auth_anomaly.js';

const sig = (ip: string, ua: string, ts = 0) => ({ ip, ua, ts });

describe('assess (pure)', () => {
  it('does not flag the first-ever login (no history to deviate from)', () => {
    const v = assess({ ips: [], uas: [], last: null }, sig('1.1.1.1', 'A'));
    expect(v.anomalous).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it('flags a new IP against known history', () => {
    const v = assess({ ips: ['1.1.1.1'], uas: ['A'], last: null }, sig('2.2.2.2', 'A'));
    expect(v.newIp).toBe(true);
    expect(v.newDevice).toBe(false);
    expect(v.reasons).toEqual(['new_ip']);
  });

  it('flags a new device (user-agent) against known history', () => {
    const v = assess({ ips: ['1.1.1.1'], uas: ['A'], last: null }, sig('1.1.1.1', 'B'));
    expect(v.newDevice).toBe(true);
    expect(v.reasons).toEqual(['new_device']);
  });

  it('flags both when IP and device are new', () => {
    const v = assess({ ips: ['1.1.1.1'], uas: ['A'], last: null }, sig('9.9.9.9', 'Z'));
    expect(v.reasons).toEqual(['new_ip', 'new_device']);
    expect(v.anomalous).toBe(true);
  });

  it('does not flag a returning IP+device', () => {
    const v = assess({ ips: ['1.1.1.1', '2.2.2.2'], uas: ['A'], last: null }, sig('2.2.2.2', 'A'));
    expect(v.anomalous).toBe(false);
  });

  it('never flags when the current login carries no IP and no UA', () => {
    const v = assess({ ips: ['1.1.1.1'], uas: ['A'], last: null }, sig('', ''));
    expect(v.anomalous).toBe(false);
  });
});

describe('recordAndAssess (KV-backed)', () => {
  function kvOf(initial: string | null) {
    const store: Record<string, string> = {};
    if (initial) store['auth:lastlogin:u'] = initial;
    return {
      get: jest.fn(async (k: string) => store[k] ?? null),
      put: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      delete: jest.fn(),
      _store: store,
    };
  }

  it('first login: no flag, writes history', async () => {
    const CACHE_KV = kvOf(null);
    const v = await recordAndAssess({ CACHE_KV } as never, 'u', sig('1.1.1.1', 'A', 1));
    expect(v.anomalous).toBe(false);
    expect(CACHE_KV.put).toHaveBeenCalled();
    expect(JSON.parse(CACHE_KV._store['auth:lastlogin:u']).ips).toEqual(['1.1.1.1']);
  });

  it('second login from a new IP flags new_ip and appends to history', async () => {
    const prior = JSON.stringify({ ips: ['1.1.1.1'], uas: ['A'], last: sig('1.1.1.1', 'A', 1) });
    const CACHE_KV = kvOf(prior);
    const v = await recordAndAssess({ CACHE_KV } as never, 'u', sig('2.2.2.2', 'A', 2));
    expect(v.reasons).toEqual(['new_ip']);
    expect(JSON.parse(CACHE_KV._store['auth:lastlogin:u']).ips).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('caps retained IPs at HISTORY_CAP (oldest evicted)', async () => {
    const ips = Array.from({ length: HISTORY_CAP }, (_, i) => `10.0.0.${i}`);
    const CACHE_KV = kvOf(JSON.stringify({ ips, uas: ['A'], last: null }));
    await recordAndAssess({ CACHE_KV } as never, 'u', sig('203.0.113.9', 'A', 3));
    const stored = JSON.parse(CACHE_KV._store['auth:lastlogin:u']).ips;
    expect(stored).toHaveLength(HISTORY_CAP);
    expect(stored[stored.length - 1]).toBe('203.0.113.9');
    expect(stored).not.toContain('10.0.0.0');
  });

  it('fail-soft: KV read failure yields a non-anomalous verdict', async () => {
    const CACHE_KV = {
      get: jest.fn(async () => {
        throw new Error('kv down');
      }),
      put: jest.fn(),
      delete: jest.fn(),
    };
    const v = await recordAndAssess({ CACHE_KV } as never, 'u', sig('2.2.2.2', 'A', 4));
    expect(v.anomalous).toBe(false);
  });
});
