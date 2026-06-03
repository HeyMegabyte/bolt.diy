/**
 * anthropic_memory — server-side persistent Memory tool backing the Anthropic SDK.
 *
 * The service is a scoped key/value store (D1 `anthropic_memory`) the model can
 * read/write/list/delete via a single `tool_use` block. This suite locks the
 * contract directly by mocking the `db.js` helper layer (`dbQueryOne`, `dbQuery`,
 * `dbExecute`) — never a real D1 — plus `crypto.randomUUID` + `Date.now` for
 * determinism:
 *   1. getMemory — SQL shape + scope/key params, value return, missing → null,
 *      expired (expires_at <= now) → null, non-expired & null-expiry pass through,
 *   2. setMemory — INSERT…ON CONFLICT upsert, positional bind order, TTL→expires_at
 *      math, metadata JSON.stringify vs null, fresh UUID id, error → throw + warn,
 *   3. listMemory — ORDER BY updated_at DESC SQL, expired-row filtering in-memory,
 *      rowToEntry mapping (metadata parse, null metadata, empty list),
 *   4. deleteMemory — DELETE SQL + params, no-throw on error (logs warn),
 *   5. buildMemoryToolDef — name/schema shape, scope-aware description (voice_agent
 *      → "call"), required:['action'], no scope leaked into the def,
 *   6. executeMemoryTool — every action branch (read/write/delete/list), missing_key,
 *      missing_value, unknown_action, JSON envelope shape, exception → execution_failed.
 *
 * ts-jest: GLOBAL `jest` (no @jest/globals import). All D1 I/O mocked; no real APIs.
 */
import {
  getMemory,
  setMemory,
  listMemory,
  deleteMemory,
  buildMemoryToolDef,
  executeMemoryTool,
  type MemoryScope,
} from '../services/anthropic_memory.js';
import { dbExecute, dbQuery, dbQueryOne } from '../services/db.js';
import type { Env } from '../types/env.js';

// ─── db.js helper layer mock ─────────────────────────────────────
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
}));

const dbQueryMock = dbQuery as unknown as jest.Mock;
const dbQueryOneMock = dbQueryOne as unknown as jest.Mock;
const dbExecuteMock = dbExecute as unknown as jest.Mock;

const makeEnv = (): Env => ({ DB: {} } as unknown as Env);

const FIXED_NOW = 1_700_000_000_000;
const FIXED_UUID = '11111111-2222-4333-8444-555555555555';

const orgScope: MemoryScope = { kind: 'org', id: 'org-1' };

/** Build a raw MemoryRow as returned from D1. */
const makeRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'row-1',
  scope_kind: 'org',
  scope_id: 'org-1',
  key: 'timezone',
  value: 'America/New_York',
  metadata_json: null,
  created_at: FIXED_NOW - 1000,
  updated_at: FIXED_NOW - 500,
  expires_at: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  // crypto.randomUUID is global in the workerd / jsdom env; pin it.
  jest
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValue(FIXED_UUID as `${string}-${string}-${string}-${string}-${string}`);
  dbExecuteMock.mockResolvedValue({ error: null, changes: 1 });
  dbQueryMock.mockResolvedValue({ data: [], error: null });
  dbQueryOneMock.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── getMemory ───────────────────────────────────────────────────

describe('getMemory', () => {
  it('queries anthropic_memory by scope_kind + scope_id + key', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow());
    await getMemory(makeEnv(), orgScope, 'timezone');

    expect(dbQueryOneMock).toHaveBeenCalledTimes(1);
    const [, sql, params] = dbQueryOneMock.mock.calls[0]!;
    expect(sql).toContain('SELECT * FROM anthropic_memory');
    expect(sql).toContain('scope_kind = ?');
    expect(sql).toContain('scope_id = ?');
    expect(sql).toContain('key = ?');
    expect(params).toEqual(['org', 'org-1', 'timezone']);
  });

  it('returns the stored value for a present, non-expired row', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow({ value: 'UTC' }));
    expect(await getMemory(makeEnv(), orgScope, 'timezone')).toBe('UTC');
  });

  it('returns null when the key does not exist', async () => {
    dbQueryOneMock.mockResolvedValueOnce(null);
    expect(await getMemory(makeEnv(), orgScope, 'missing')).toBeNull();
  });

  it('returns null for an expired row (expires_at <= now)', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow({ expires_at: FIXED_NOW - 1 }));
    expect(await getMemory(makeEnv(), orgScope, 'stale')).toBeNull();
  });

  it('returns null exactly at the expiry boundary (expires_at === now)', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow({ expires_at: FIXED_NOW }));
    expect(await getMemory(makeEnv(), orgScope, 'edge')).toBeNull();
  });

  it('returns the value for a future expiry (expires_at > now)', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow({ value: 'live', expires_at: FIXED_NOW + 1000 }));
    expect(await getMemory(makeEnv(), orgScope, 'fresh')).toBe('live');
  });
});

// ─── setMemory ───────────────────────────────────────────────────

describe('setMemory', () => {
  it('issues an INSERT … ON CONFLICT upsert against anthropic_memory', async () => {
    await setMemory(makeEnv(), orgScope, 'timezone', 'UTC');
    const [, sql] = dbExecuteMock.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO anthropic_memory');
    expect(sql).toContain('ON CONFLICT(scope_kind, scope_id, key) DO UPDATE');
  });

  it('binds positional args in column order with a fresh UUID id first', async () => {
    await setMemory(makeEnv(), orgScope, 'timezone', 'UTC');
    const [, , params] = dbExecuteMock.mock.calls[0]!;
    expect(params[0]).toBe(FIXED_UUID); // id
    expect(params[1]).toBe('org'); // scope_kind
    expect(params[2]).toBe('org-1'); // scope_id
    expect(params[3]).toBe('timezone'); // key
    expect(params[4]).toBe('UTC'); // value
    expect(params[5]).toBeNull(); // metadata_json (none)
    expect(params[6]).toBe(FIXED_NOW); // created_at
    expect(params[7]).toBe(FIXED_NOW); // updated_at
    expect(params[8]).toBeNull(); // expires_at (no TTL)
  });

  it('computes expires_at = now + ttlSeconds*1000 when ttlSeconds supplied', async () => {
    await setMemory(makeEnv(), orgScope, 'k', 'v', { ttlSeconds: 3600 });
    const [, , params] = dbExecuteMock.mock.calls[0]!;
    expect(params[8]).toBe(FIXED_NOW + 3600 * 1000);
  });

  it('leaves expires_at null when ttlSeconds is 0 (falsy → no expiry)', async () => {
    await setMemory(makeEnv(), orgScope, 'k', 'v', { ttlSeconds: 0 });
    expect(dbExecuteMock.mock.calls[0]![2][8]).toBeNull();
  });

  it('stringifies metadata to JSON when provided', async () => {
    await setMemory(makeEnv(), orgScope, 'k', 'v', { metadata: { src: 'voice' } });
    expect(dbExecuteMock.mock.calls[0]![2][5]).toBe(JSON.stringify({ src: 'voice' }));
  });

  it('binds metadata_json null when metadata is omitted', async () => {
    await setMemory(makeEnv(), orgScope, 'k', 'v');
    expect(dbExecuteMock.mock.calls[0]![2][5]).toBeNull();
  });

  it('throws and warns when the DB returns an error', async () => {
    dbExecuteMock.mockResolvedValueOnce({ error: 'disk full', changes: 0 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(setMemory(makeEnv(), orgScope, 'k', 'v')).rejects.toThrow(
      'anthropic_memory.set failed: disk full',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(logged.message).toBe('set_memory_failed');
    expect(logged.error).toBe('disk full');
  });

  it('resolves without throwing on success', async () => {
    await expect(setMemory(makeEnv(), orgScope, 'k', 'v')).resolves.toBeUndefined();
  });
});

// ─── listMemory ──────────────────────────────────────────────────

describe('listMemory', () => {
  it('selects all keys for the scope ordered by updated_at DESC', async () => {
    await listMemory(makeEnv(), orgScope);
    const [, sql, params] = dbQueryMock.mock.calls[0]!;
    expect(sql).toContain('SELECT * FROM anthropic_memory');
    expect(sql).toContain('ORDER BY updated_at DESC');
    expect(params).toEqual(['org', 'org-1']);
  });

  it('returns an empty array when no rows exist', async () => {
    dbQueryMock.mockResolvedValueOnce({ data: [], error: null });
    expect(await listMemory(makeEnv(), orgScope)).toEqual([]);
  });

  it('maps rows to MemoryEntry shape (parsing metadata_json)', async () => {
    dbQueryMock.mockResolvedValueOnce({
      data: [makeRow({ key: 'a', value: 'x', metadata_json: JSON.stringify({ tag: 1 }) })],
      error: null,
    });
    const [entry] = await listMemory(makeEnv(), orgScope);
    expect(entry).toEqual({
      key: 'a',
      value: 'x',
      metadata: { tag: 1 },
      created_at: FIXED_NOW - 1000,
      updated_at: FIXED_NOW - 500,
      expires_at: null,
    });
  });

  it('maps null metadata_json to a null metadata field', async () => {
    dbQueryMock.mockResolvedValueOnce({ data: [makeRow({ metadata_json: null })], error: null });
    expect((await listMemory(makeEnv(), orgScope))[0]!.metadata).toBeNull();
  });

  it('maps malformed metadata_json to null (safeJsonParse)', async () => {
    dbQueryMock.mockResolvedValueOnce({ data: [makeRow({ metadata_json: '{not json' })], error: null });
    expect((await listMemory(makeEnv(), orgScope))[0]!.metadata).toBeNull();
  });

  it('filters out expired rows but keeps live + null-expiry ones', async () => {
    dbQueryMock.mockResolvedValueOnce({
      data: [
        makeRow({ key: 'live', expires_at: FIXED_NOW + 1000 }),
        makeRow({ key: 'dead', expires_at: FIXED_NOW - 1 }),
        makeRow({ key: 'forever', expires_at: null }),
      ],
      error: null,
    });
    const keys = (await listMemory(makeEnv(), orgScope)).map((e) => e.key);
    expect(keys).toEqual(['live', 'forever']);
  });
});

// ─── deleteMemory ────────────────────────────────────────────────

describe('deleteMemory', () => {
  it('issues a scoped DELETE by scope_kind + scope_id + key', async () => {
    await deleteMemory(makeEnv(), orgScope, 'timezone');
    const [, sql, params] = dbExecuteMock.mock.calls[0]!;
    expect(sql).toContain('DELETE FROM anthropic_memory');
    expect(params).toEqual(['org', 'org-1', 'timezone']);
  });

  it('does not throw when the DB returns an error (logs warn, no-op)', async () => {
    dbExecuteMock.mockResolvedValueOnce({ error: 'locked', changes: 0 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(deleteMemory(makeEnv(), orgScope, 'k')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]![0] as string).message).toBe('delete_memory_failed');
  });

  it('does not log on a successful delete', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await deleteMemory(makeEnv(), orgScope, 'k');
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── buildMemoryToolDef ──────────────────────────────────────────

describe('buildMemoryToolDef', () => {
  it('returns a tool named "memory" with the standard input_schema shape', () => {
    const def = buildMemoryToolDef(orgScope);
    expect(def.name).toBe('memory');
    const schema = def.input_schema as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['action']);
    expect(schema.additionalProperties).toBe(false);
    const props = schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['action', 'key', 'metadata', 'ttl_seconds', 'value']);
    expect((props.action as { enum: string[] }).enum).toEqual(['read', 'write', 'delete', 'list']);
  });

  it('renders voice_agent scope as "call" in the description', () => {
    const def = buildMemoryToolDef({ kind: 'voice_agent', id: 'call-9' });
    expect(def.description).toContain('call');
    expect(def.description).not.toContain('voice_agent');
  });

  it('uses the raw scope kind in the description for non-voice scopes', () => {
    expect(buildMemoryToolDef({ kind: 'user', id: 'u1' }).description).toContain('user');
  });

  it('never serializes the scope id into the tool definition', () => {
    const def = buildMemoryToolDef({ kind: 'site', id: 'secret-site-id' });
    expect(JSON.stringify(def)).not.toContain('secret-site-id');
  });
});

// ─── executeMemoryTool ───────────────────────────────────────────

describe('executeMemoryTool', () => {
  it('read → returns ok + key + value', async () => {
    dbQueryOneMock.mockResolvedValueOnce(makeRow({ value: 'UTC' }));
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'read', key: 'timezone' },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, key: 'timezone', value: 'UTC' });
  });

  it('read → value null when the key is absent', async () => {
    dbQueryOneMock.mockResolvedValueOnce(null);
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'read', key: 'nope' },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, key: 'nope', value: null });
  });

  it('read → missing_key when key omitted', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, { input: { action: 'read' } });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'missing_key' });
    expect(dbQueryOneMock).not.toHaveBeenCalled();
  });

  it('write → persists value and returns wrote', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'write', key: 'k', value: 'v', ttl_seconds: 60, metadata: { a: 1 } },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, key: 'k', action: 'wrote' });
    const [, , params] = dbExecuteMock.mock.calls[0]!;
    expect(params[3]).toBe('k');
    expect(params[4]).toBe('v');
    expect(params[5]).toBe(JSON.stringify({ a: 1 }));
    expect(params[8]).toBe(FIXED_NOW + 60 * 1000);
  });

  it('write → missing_key when key omitted', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'write', value: 'v' },
    });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'missing_key' });
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it('write → missing_value when value is not a string', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'write', key: 'k' } as { action: 'write'; key: string },
    });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'missing_value' });
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it('write → accepts an empty-string value (typeof === "string")', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'write', key: 'k', value: '' },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, key: 'k', action: 'wrote' });
    expect(dbExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('delete → returns deleted and issues the DELETE', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'delete', key: 'k' },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, key: 'k', action: 'deleted' });
    expect(dbExecuteMock.mock.calls[0]![1]).toContain('DELETE FROM anthropic_memory');
  });

  it('delete → missing_key when key omitted', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, { input: { action: 'delete' } });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'missing_key' });
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it('list → returns count + slimmed entries (key/value/updated_at only)', async () => {
    dbQueryMock.mockResolvedValueOnce({
      data: [makeRow({ key: 'a', value: 'x', updated_at: 42 })],
      error: null,
    });
    const out = await executeMemoryTool(makeEnv(), orgScope, { input: { action: 'list' } });
    expect(JSON.parse(out)).toEqual({
      ok: true,
      count: 1,
      entries: [{ key: 'a', value: 'x', updated_at: 42 }],
    });
  });

  it('list → empty array when scope has no entries', async () => {
    dbQueryMock.mockResolvedValueOnce({ data: [], error: null });
    const out = await executeMemoryTool(makeEnv(), orgScope, { input: { action: 'list' } });
    expect(JSON.parse(out)).toEqual({ ok: true, count: 0, entries: [] });
  });

  it('unknown action → unknown_action with the echoed action', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'purge' } as unknown as { action: 'read' },
    });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'unknown_action', action: 'purge' });
  });

  it('missing action → unknown_action with null action', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, { input: {} });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'unknown_action', action: null });
  });

  it('defaults to empty input when toolUse.input is undefined', async () => {
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: undefined as unknown as Record<string, unknown>,
    });
    expect(JSON.parse(out)).toEqual({ ok: false, error: 'unknown_action', action: null });
  });

  it('catches a thrown DB error and returns execution_failed with the message', async () => {
    dbExecuteMock.mockResolvedValueOnce({ error: 'boom', changes: 0 }); // makes setMemory throw
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await executeMemoryTool(makeEnv(), orgScope, {
      input: { action: 'write', key: 'k', value: 'v' },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('execution_failed');
    expect(parsed.detail).toContain('boom');
    // both setMemory's warn and executeMemoryTool's warn fire
    expect(warn).toHaveBeenCalled();
  });
});
