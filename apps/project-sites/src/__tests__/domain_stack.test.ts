/**
 * @module __tests__/domain_stack
 * @description Unit coverage for the Domain Stack One-Click Wizard service
 * (`src/services/domain_stack.ts`) — the 7-step idempotent state machine behind
 * the backend wizard. Tests the service layer in isolation: D1 (`db.js`
 * helpers), the Cloudflare API (`global.fetch`), and R2 (`SITES_BUCKET`) are all
 * mocked — no real network or storage calls.
 *
 * Branch surface covered:
 *  - createStackRun: new bootstrap (INSERT) + idempotent return of an existing
 *    row + deserialization of a string `step_results` column
 *  - getStackRun / getStackStatus: found + not-found
 *  - advanceStackRun: not-found throw, terminal short-circuit (done/error),
 *    already-ok step → transition to next, max-retries → error, success path
 *    that advances + persists, failure path that increments retries
 *  - per-step provisioning: register (no-op success), dns (missing config /
 *    success / already-exists idempotent / hard error), ssl (missing config /
 *    existing active / create pending / create active / not-active retry),
 *    email_auth (missing config / all-records success / partial failure /
 *    already-exists idempotent), discovery (R2 success / R2 throw), gsc
 *    (missing config / no-token graceful skip / success / already-exists)
 *  - transitionNext to terminal `done` (done_at set) + markError
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  createStackRun,
  getStackRun,
  getStackStatus,
  advanceStackRun,
  type StackRun,
  type StackState,
  type StepResult,
} from '../services/domain_stack.js';
import type { Env } from '../types/env.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;

const originalFetch = global.fetch;

// ─── Test fixtures ──────────────────────────────────────────────────────────

const CF_TOKEN = 'cf-token-abc';
const CF_ZONE = 'zone-123';
const GSC_TOKEN = 'gsc-verify-xyz';

interface EnvOverrides {
  zone?: string;
  token?: string;
  gsc?: string;
  bucketPut?: jest.Mock;
}

function makeEnv(o: EnvOverrides = {}): Env {
  const put = o.bucketPut ?? jest.fn().mockResolvedValue(undefined);
  return {
    DB: {} as unknown,
    SITES_BUCKET: { put } as unknown,
    CF_ZONE_ID: o.zone ?? CF_ZONE,
    CLOUDFLARE_API_TOKEN: o.token ?? CF_TOKEN,
    GOOGLE_SEARCH_CONSOLE_VERIFY_TOKEN: o.gsc ?? '',
  } as unknown as Env;
}

function makeRun(state: StackState, stepResults: Record<string, StepResult> = {}): StackRun {
  return {
    id: 'run-1',
    org_id: 'org-1',
    hostname_id: 'host-1',
    hostname: 'example.com',
    state,
    step_results: stepResults,
    retries: 0,
    last_error: null,
    started_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    done_at: null,
  };
}

/** Build a fetch Response-ish mock returning the given JSON body. */
function fetchJson(body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({ json: async () => body } as unknown as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── createStackRun ───────────────────────────────────────────────────────

describe('createStackRun', () => {
  it('bootstraps a new run via dbInsert when none exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const run = await createStackRun(env, {
      runId: 'run-1',
      orgId: 'org-1',
      hostnameId: 'host-1',
      hostname: 'example.com',
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('domain_stack_runs');
    expect(record).toMatchObject({
      id: 'run-1',
      org_id: 'org-1',
      hostname_id: 'host-1',
      hostname: 'example.com',
      state: 'register',
      step_results: '{}',
      retries: 0,
      last_error: null,
    });
    expect(run.state).toBe('register');
    expect(run.step_results).toEqual({});
    expect(run.done_at).toBeNull();
  });

  it('is idempotent — returns the existing run without inserting', async () => {
    mockQueryOne.mockResolvedValue({
      ...makeRun('dns'),
      step_results: JSON.stringify({ register: { ok: true, attempts: 1 } }),
    });
    const env = makeEnv();
    const run = await createStackRun(env, {
      runId: 'run-1',
      orgId: 'org-1',
      hostnameId: 'host-1',
      hostname: 'example.com',
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(run.state).toBe('dns');
    // deserialize parsed the string column into an object
    expect(run.step_results).toEqual({ register: { ok: true, attempts: 1 } });
  });
});

// ─── getStackRun / getStackStatus ─────────────────────────────────────────

describe('getStackRun', () => {
  it('returns null when no row found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getStackRun(makeEnv(), 'missing')).toBeNull();
  });

  it('returns a deserialized run when found', async () => {
    mockQueryOne.mockResolvedValue({
      ...makeRun('ssl'),
      step_results: JSON.stringify({ dns: { ok: true, attempts: 1 } }),
    });
    const run = await getStackRun(makeEnv(), 'run-1');
    expect(run?.state).toBe('ssl');
    expect(run?.step_results).toEqual({ dns: { ok: true, attempts: 1 } });
  });

  it('handles an already-object step_results column', async () => {
    mockQueryOne.mockResolvedValue(makeRun('dns', { register: { ok: true, attempts: 1 } }));
    const run = await getStackRun(makeEnv(), 'run-1');
    expect(run?.step_results).toEqual({ register: { ok: true, attempts: 1 } });
  });
});

describe('getStackStatus', () => {
  it('returns null when no run for the hostname', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getStackStatus(makeEnv(), 'nope.com')).toBeNull();
  });

  it('returns the latest run for a hostname', async () => {
    mockQueryOne.mockResolvedValue({ ...makeRun('done'), step_results: '{}' });
    const run = await getStackStatus(makeEnv(), 'example.com');
    expect(run?.state).toBe('done');
    // hostname is the query param
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['example.com']);
  });
});

// ─── advanceStackRun: control flow ─────────────────────────────────────────

describe('advanceStackRun — control flow', () => {
  it('throws when the run is not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(advanceStackRun(makeEnv(), 'ghost')).rejects.toThrow('Stack run ghost not found');
  });

  it('short-circuits a terminal done run', async () => {
    mockQueryOne.mockResolvedValue({ ...makeRun('done'), step_results: '{}' });
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('done');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('short-circuits a terminal error run', async () => {
    mockQueryOne.mockResolvedValue({ ...makeRun('error'), step_results: '{}' });
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('error');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('transitions to the next state when the current step is already ok', async () => {
    mockQueryOne.mockResolvedValue(
      makeRun('register', { register: { ok: true, attempts: 1 } }),
    );
    const run = await advanceStackRun(makeEnv(), 'run-1');
    // register already ok → advance to dns, persisted via dbUpdate
    expect(run.state).toBe('dns');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('marks error when a step exhausted max retries', async () => {
    mockQueryOne.mockResolvedValue(
      makeRun('dns', { dns: { ok: false, attempts: 3, error: 'boom' } }),
    );
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('error');
    expect(run.last_error).toContain('exceeded max retries');
    const update = mockUpdate.mock.calls[0][2];
    expect(update.state).toBe('error');
  });

  it('runs a fresh step, succeeds, persists, and advances', async () => {
    global.fetch = fetchJson({ success: true });
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    // dns succeeds → transition to ssl
    expect(run.state).toBe('ssl');
    // first update writes the step result, transitionNext writes the new state
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('runs a fresh step that fails and increments retries (stays on step)', async () => {
    // missing CF config makes the dns step fail without hitting fetch
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const env = makeEnv({ zone: '', token: '' });
    const run = await advanceStackRun(env, 'run-1');
    expect(run.state).toBe('dns');
    expect(run.retries).toBe(1);
    expect(run.last_error).toContain('not configured');
    const update = mockUpdate.mock.calls[0][2];
    expect(update.retries).toBe(1);
  });

  it('captures a thrown step error as a failed result', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('dns');
    expect(run.last_error).toContain('network down');
  });
});

// ─── Step: dns ──────────────────────────────────────────────────────────────

describe('step dns', () => {
  it('fails when CF config missing', async () => {
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv({ token: '' }), 'run-1');
    expect(run.state).toBe('dns');
    expect(run.last_error).toContain('not configured');
  });

  it('succeeds on CNAME creation', async () => {
    global.fetch = fetchJson({ success: true });
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('ssl');
  });

  it('treats an already-exists CF error as idempotent success', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'record already exists' }] });
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('ssl');
  });

  it('fails on a hard CF error', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'zone suspended' }] });
    mockQueryOne.mockResolvedValue(makeRun('dns', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('dns');
    expect(run.last_error).toContain('zone suspended');
  });
});

// ─── Step: ssl ────────────────────────────────────────────────────────────

describe('step ssl', () => {
  it('fails when CF config missing', async () => {
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv({ zone: '' }), 'run-1');
    expect(run.state).toBe('ssl');
    expect(run.last_error).toContain('not configured');
  });

  it('succeeds when an existing custom hostname is already active', async () => {
    global.fetch = fetchJson({ success: true, result: [{ ssl: { status: 'active' } }] });
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('email_auth');
  });

  it('creates a custom hostname and succeeds when SSL is immediately active', async () => {
    // first call: lookup returns no existing; second: create returns active
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, result: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, result: { ssl: { status: 'active' } } }) });
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('email_auth');
  });

  it('stays on ssl when a newly-created hostname is still pending', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, result: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, result: { ssl: { status: 'pending_validation' } } }) });
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('ssl');
    expect(run.last_error).toContain('SSL pending');
  });

  it('fails when custom hostname creation is rejected', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, result: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: false, errors: [{ message: 'limit reached' }] }) });
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('ssl');
    expect(run.last_error).toContain('limit reached');
  });

  it('retries when an existing hostname SSL is not yet active', async () => {
    global.fetch = fetchJson({ success: true, result: [{ ssl: { status: 'pending_validation' } }] });
    mockQueryOne.mockResolvedValue(makeRun('ssl', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('ssl');
    expect(run.last_error).toContain('SSL status');
  });
});

// ─── Step: email_auth ──────────────────────────────────────────────────────

describe('step email_auth', () => {
  it('fails when CF config missing', async () => {
    mockQueryOne.mockResolvedValue(makeRun('email_auth', {}));
    const run = await advanceStackRun(makeEnv({ token: '' }), 'run-1');
    expect(run.state).toBe('email_auth');
    expect(run.last_error).toContain('not configured');
  });

  it('succeeds when all DNS records are created', async () => {
    global.fetch = fetchJson({ success: true });
    mockQueryOne.mockResolvedValue(makeRun('email_auth', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('discovery');
    // 4 records: SPF, DMARC, DKIM, MX
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(4);
  });

  it('treats already-exists records as idempotent and still succeeds', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'record already exists' }] });
    mockQueryOne.mockResolvedValue(makeRun('email_auth', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('discovery');
  });

  it('fails when a record errors hard', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'bad TXT value' }] });
    mockQueryOne.mockResolvedValue(makeRun('email_auth', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('email_auth');
    expect(run.last_error).toContain('bad TXT value');
  });
});

// ─── Step: discovery ─────────────────────────────────────────────────────────

describe('step discovery', () => {
  it('writes security.txt to R2 and succeeds', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    mockQueryOne.mockResolvedValue(makeRun('discovery', {}));
    const run = await advanceStackRun(makeEnv({ bucketPut: put }), 'run-1');
    expect(run.state).toBe('gsc');
    expect(put).toHaveBeenCalledTimes(1);
    const [key, body] = put.mock.calls[0];
    expect(key).toBe('sites/example.com/.well-known/security.txt');
    expect(String(body)).toContain('Contact: mailto:security@projectsites.dev');
  });

  it('fails when the R2 put throws', async () => {
    const put = jest.fn().mockRejectedValue(new Error('R2 quota exceeded'));
    mockQueryOne.mockResolvedValue(makeRun('discovery', {}));
    const run = await advanceStackRun(makeEnv({ bucketPut: put }), 'run-1');
    expect(run.state).toBe('discovery');
    expect(run.last_error).toContain('R2 quota exceeded');
  });
});

// ─── Step: gsc (terminal transition to done) ─────────────────────────────────

describe('step gsc', () => {
  it('fails when CF config missing', async () => {
    mockQueryOne.mockResolvedValue(makeRun('gsc', {}));
    const run = await advanceStackRun(makeEnv({ zone: '' }), 'run-1');
    expect(run.state).toBe('gsc');
    expect(run.last_error).toContain('not configured');
  });

  it('skips gracefully (still completes the wizard) when no GSC token configured', async () => {
    // no fetch needed for the skip branch
    global.fetch = jest.fn();
    mockQueryOne.mockResolvedValue(makeRun('gsc', {}));
    const run = await advanceStackRun(makeEnv({ gsc: '' }), 'run-1');
    expect(run.state).toBe('done');
    expect(run.done_at).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates the GSC TXT record and reaches done', async () => {
    global.fetch = fetchJson({ success: true });
    mockQueryOne.mockResolvedValue(makeRun('gsc', {}));
    const run = await advanceStackRun(makeEnv({ gsc: GSC_TOKEN }), 'run-1');
    expect(run.state).toBe('done');
    expect(run.done_at).not.toBeNull();
    // done_at written in transitionNext update
    const lastUpdate = mockUpdate.mock.calls.at(-1)?.[2];
    expect(lastUpdate.state).toBe('done');
    expect(lastUpdate.done_at).not.toBeNull();
  });

  it('treats an already-exists GSC record as idempotent success', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'record already exists' }] });
    mockQueryOne.mockResolvedValue(makeRun('gsc', {}));
    const run = await advanceStackRun(makeEnv({ gsc: GSC_TOKEN }), 'run-1');
    expect(run.state).toBe('done');
  });

  it('fails on a hard GSC record error', async () => {
    global.fetch = fetchJson({ success: false, errors: [{ message: 'invalid content' }] });
    mockQueryOne.mockResolvedValue(makeRun('gsc', {}));
    const run = await advanceStackRun(makeEnv({ gsc: GSC_TOKEN }), 'run-1');
    expect(run.state).toBe('gsc');
    expect(run.last_error).toContain('invalid content');
  });
});

// ─── Step: register (no-op success) ──────────────────────────────────────────

describe('step register', () => {
  it('is a no-op success that advances to dns', async () => {
    mockQueryOne.mockResolvedValue(makeRun('register', {}));
    const run = await advanceStackRun(makeEnv(), 'run-1');
    expect(run.state).toBe('dns');
    expect(run.step_results.register?.ok).toBe(true);
  });
});
