/**
 * @module libs/features/status_page_live/__tests__/status_page_live
 * @description Unit tests for the status_page_live feature module.
 */

// Mock dependencies BEFORE importing the module under test

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQuery = jest.fn();
const mockDbInsert = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: jest.fn(),
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbExecute: jest.fn(),
}));

// Import AFTER mocking
import { Hono } from 'hono';
import { statusPageLive } from '../handlers.js';

// Minimal env stub
function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {},
    SITES_BUCKET: {},
    ...overrides,
  } as never;
}

// Minimal context helper — mounts the router and fires a request
async function request(
  method: string,
  path: string,
  opts: { userId?: string; body?: unknown; env?: Record<string, unknown> } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.userId) c.set('userId', opts.userId);
    c.env = makeEnv(opts.env ?? {}) as never;
    await next();
  });
  app.route('/', statusPageLive);

  const headers: Record<string, string> = {};
  if (opts.body) headers['Content-Type'] = 'application/json';

  return app.request(path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

describe('status_page_live', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({ data: [], error: null });
    mockDbInsert.mockResolvedValue({ error: null });
  });

  // ─── GET /api/status/feed ────────────────────────────────────────────────

  it('GET /api/status/feed returns 404 when flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await request('GET', '/api/status/feed');
    expect(res.status).toBe(404);
  });

  it('GET /api/status/feed returns { status: operational, incidents: [] } when no incidents', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({ data: [], error: null });

    const res = await request('GET', '/api/status/feed');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; status: string; incidents: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.status).toBe('operational');
    expect(json.incidents).toEqual([]);
  });

  it('GET /api/status/feed returns outage when a critical incident exists', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({
      data: [
        {
          id: 'inc-1',
          title: 'DB Down',
          severity: 'critical',
          message: 'Database is unreachable',
          status: 'open',
          created_at: '2026-06-17T10:00:00.000Z',
        },
      ],
      error: null,
    });

    const res = await request('GET', '/api/status/feed');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; incidents: { id: string }[] };
    expect(json.status).toBe('outage');
    expect(json.incidents).toHaveLength(1);
    expect(json.incidents[0].id).toBe('inc-1');
  });

  // ─── POST /api/status/incident ───────────────────────────────────────────

  it('POST /api/status/incident returns 401 when unauthenticated', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await request('POST', '/api/status/incident', {
      body: { title: 'Test incident', severity: 'minor', message: 'Something is off' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/status/incident returns 400 when title is too short', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await request('POST', '/api/status/incident', {
      userId: 'user-1',
      body: { title: 'Hi', severity: 'minor', message: 'msg' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/status/incident creates and returns an incident', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const res = await request('POST', '/api/status/incident', {
      userId: 'user-1',
      body: {
        title: 'Elevated error rates',
        severity: 'major',
        message: 'Error rates are above threshold',
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; incident: { title: string; severity: string } };
    expect(json.ok).toBe(true);
    expect(json.incident.title).toBe('Elevated error rates');
    expect(json.incident.severity).toBe('major');
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it('POST /api/status/incident returns 404 when flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await request('POST', '/api/status/incident', {
      userId: 'user-1',
      body: { title: 'Some incident', severity: 'minor', message: 'msg' },
    });
    expect(res.status).toBe(404);
  });
});
