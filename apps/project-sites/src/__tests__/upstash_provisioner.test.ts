/**
 * Unit coverage for services/upstash_provisioner — thin Upstash Redis REST
 * wrapper (create/delete per-instance DBs). `global.fetch` mocked; no real APIs.
 */
import { createDatabase, deleteDatabase, MissingUpstashKeyError } from '../services/upstash_provisioner.js';
import type { Env } from '../types/env.js';

const env = { UPSTASH_EMAIL: 'me@x.com', UPSTASH_API_KEY: 'key-123' } as unknown as Env;

function mockFetch(impl: (url: string, init: RequestInit) => unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string, init: RequestInit) =>
    Promise.resolve(impl(url, init)),
  );
}

beforeEach(() => jest.clearAllMocks());

describe('auth guard', () => {
  it('throws MissingUpstashKeyError (code/service/deeplink) when email is absent', async () => {
    await expect(createDatabase({ UPSTASH_API_KEY: 'k' } as unknown as Env, 'db')).rejects.toBeInstanceOf(MissingUpstashKeyError);
    try {
      await createDatabase({ UPSTASH_API_KEY: 'k' } as unknown as Env, 'db');
    } catch (e) {
      const err = e as MissingUpstashKeyError;
      expect(err.code).toBe('missing_env');
      expect(err.service).toBe('upstash');
      expect(err.deeplink).toContain('console.upstash.com');
    }
  });

  it('throws when key is absent (deleteDatabase too)', async () => {
    await expect(deleteDatabase({ UPSTASH_EMAIL: 'a@b.com' } as unknown as Env, 'db-1')).rejects.toBeInstanceOf(MissingUpstashKeyError);
  });
});

describe('createDatabase', () => {
  it('POSTs with Basic auth + tls body and maps the response', async () => {
    let seenUrl = ''; let seenInit: RequestInit = {};
    mockFetch((url, init) => { seenUrl = url; seenInit = init; return {
      ok: true, status: 200,
      json: () => Promise.resolve({ database_id: 'db-9', endpoint: 'eu1.upstash.io', port: 6380, password: 'p@ss', rest_token: 'rt-1' }),
    }; });
    const r = await createDatabase(env, 'my-db', 'eu-west-1');
    expect(seenUrl).toBe('https://api.upstash.com/v2/redis/database');
    expect(seenInit.method).toBe('POST');
    const headers = seenInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('me@x.com:key-123')}`);
    expect(JSON.parse(seenInit.body as string)).toEqual({ name: 'my-db', region: 'eu-west-1', tls: true });
    expect(r).toEqual({
      databaseId: 'db-9',
      restUrl: 'https://eu1.upstash.io',
      restToken: 'rt-1',
      redisUrl: `rediss://default:${encodeURIComponent('p@ss')}@eu1.upstash.io:6380`,
    });
  });

  it('falls back to password when rest_token is absent + defaults port/region', async () => {
    let body = '';
    mockFetch((_u, init) => { body = init.body as string; return {
      ok: true, status: 200,
      json: () => Promise.resolve({ database_id: 'db-2', endpoint: 'e', password: 'pw' }),
    }; });
    const r = await createDatabase(env, 'db');
    expect(JSON.parse(body).region).toBe('us-east-1'); // default
    expect(r.restToken).toBe('pw');                     // rest_token → password fallback
    expect(r.redisUrl).toContain(':6379');              // default port
  });

  it('truncates the database name to 32 chars', async () => {
    let body = '';
    mockFetch((_u, init) => { body = init.body as string; return {
      ok: true, status: 200, json: () => Promise.resolve({ database_id: 'd', endpoint: 'e', password: 'p' }),
    }; });
    await createDatabase(env, 'x'.repeat(50));
    expect(JSON.parse(body).name).toHaveLength(32);
  });

  it('throws on a non-ok response with status + message', async () => {
    mockFetch(() => ({ ok: false, status: 402, json: () => Promise.resolve({ message: 'quota exceeded' }) }));
    await expect(createDatabase(env, 'db')).rejects.toThrow(/402 quota exceeded/);
  });

  it('throws when a 200 response lacks database_id', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ endpoint: 'e' }) }));
    await expect(createDatabase(env, 'db')).rejects.toThrow(/createDatabase failed/);
  });

  it('survives a json() rejection (→ {} → throws no-id)', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }));
    await expect(createDatabase(env, 'db')).rejects.toThrow(/createDatabase failed/);
  });
});

describe('deleteDatabase', () => {
  it('DELETEs with the URL-encoded id and Basic auth', async () => {
    let seenUrl = ''; let method = '';
    mockFetch((url, init) => { seenUrl = url; method = init.method as string; return { ok: true, status: 200 }; });
    await deleteDatabase(env, 'db/weird id');
    expect(method).toBe('DELETE');
    expect(seenUrl).toBe(`https://api.upstash.com/v2/redis/database/${encodeURIComponent('db/weird id')}`);
  });

  it('treats a 404 as idempotent success (no throw)', async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    await expect(deleteDatabase(env, 'gone')).resolves.toBeUndefined();
  });

  it('throws on a non-404 error with status + body', async () => {
    mockFetch(() => ({ ok: false, status: 500, text: () => Promise.resolve('boom') }));
    await expect(deleteDatabase(env, 'db-1')).rejects.toThrow(/deleteDatabase failed: 500 boom/);
  });
});
