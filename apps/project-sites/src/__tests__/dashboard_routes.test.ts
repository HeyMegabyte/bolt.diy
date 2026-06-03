/**
 * Route coverage for the `/api/dashboard/*` + `/api/calendar/*` surface
 * (convergence r45).
 *
 * Exercises every handler in `routes/dashboard.ts` end-to-end through the real
 * Hono app + the shared {@link errorHandler}, mocking only the boundaries:
 * the D1 helpers (`dbQuery`/`dbInsert`/`dbUpdate`) and Workers AI.
 *
 * Covers, per handler: auth (401), Zod validation (400), org scoping (writes
 * carry the caller's org_id; reads filter by user_id), empty/missing data,
 * default-calendar bootstrap, success + error (booking slug conflict → 409).
 *
 * The chat handler streams via Workers AI; we assert it short-circuits on auth
 * and returns an SSE response (with a token + done frame) on the happy path.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { dashboard } from '../routes/dashboard.js';
import { dbQuery, dbInsert, dbUpdate } from '../services/db.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbInsert = dbInsert as unknown as jest.Mock;
const mockDbUpdate = dbUpdate as unknown as jest.Mock;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/**
 * Workers-AI mock returning a streaming SSE body. The dashboard chat reader
 * splits on `\n\n` and parses `data: {...}` lines, so we emit the same shape
 * Workers AI does. `opts.throws` simulates an upstream gateway failure.
 */
function makeAi(chunks: string[] = ['{"response":"hi"}'], opts: { throws?: boolean } = {}) {
  return {
    run: jest.fn(async () => {
      if (opts.throws) throw new Error('AI gateway 503');
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(enc.encode(`data: ${c}\n\n`));
          controller.close();
        },
      });
    }),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    AI: makeAi(),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware seeding the auth-context vars the handlers
 * read (`userId`, `orgId`). Passing no vars simulates an unauthenticated call.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', dashboard);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

type App = Hono<{ Bindings: Env; Variables: Variables }>;

function req(
  app: App,
  path: string,
  method: string,
  env: Env,
  body?: unknown,
): Promise<Response> {
  const hasBody = body !== undefined;
  return app.request(
    path,
    {
      method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      body: hasBody ? JSON.stringify(body) : undefined,
    },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const NOW = '2026-06-01T10:00:00.000Z';
const LATER = '2026-06-01T11:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQuery.mockResolvedValue({ data: [] });
  mockDbInsert.mockResolvedValue(undefined);
  mockDbUpdate.mockResolvedValue(undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/dashboard/chat
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/dashboard/chat', () => {
  it('returns 401 when unauthenticated (does not touch AI)', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/dashboard/chat', 'POST', env, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
  });

  it('returns 400 when messages array is empty (Zod min(1))', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/dashboard/chat', 'POST', env, { messages: [] });
    expect(res.status).toBe(400);
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
  });

  it('returns 400 when a message role is invalid', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/dashboard/chat', 'POST', env, {
      messages: [{ role: 'robot', content: 'hi' }],
    });
    expect(res.status).toBe(400);
  });

  it('streams an SSE response with token + done frames on success', async () => {
    const env = makeEnv({ AI: makeAi(['{"response":"Hello"}', '{"response":" world"}']) });
    const res = await req(makeApp(AUTH), '/api/dashboard/chat', 'POST', env, {
      messages: [{ role: 'user', content: 'status?' }],
      slash_command: '/status',
      context: { site_slug: 'vitos', route: '/admin', time_of_day: 'morning' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: token');
    expect(text).toContain('Hello');
    expect(text).toContain('event: done');
    expect((env.AI as unknown as { run: jest.Mock }).run).toHaveBeenCalledTimes(1);
  });

  it('emits an error frame (still 200 stream) when the AI call throws', async () => {
    const env = makeEnv({ AI: makeAi([], { throws: true }) });
    const res = await req(makeApp(AUTH), '/api/dashboard/chat', 'POST', env, {
      messages: [{ role: 'user', content: 'boom' }],
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('AI gateway 503');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/calendar/events
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/calendar/events', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/events', 'GET', env);
    expect(res.status).toBe(401);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('returns [] when no events exist', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events', 'GET', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });

  it('scopes the query to the caller user_id and coerces all_day + attendees', async () => {
    mockDbQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'e1',
          calendar_id: 'c1',
          title: 'Standup',
          description: null,
          location: null,
          start_utc: NOW,
          end_utc: LATER,
          tz: 'UTC',
          all_day: 1,
          rrule: null,
          attendees: '[{"email":"a@b.com"}]',
          status: 'confirmed',
        },
      ],
    });
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      '/api/calendar/events?from=2026-06-01T00:00:00.000Z&to=2026-06-02T00:00:00.000Z',
      'GET',
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]!['all_day']).toBe(true);
    expect(json.data[0]!['attendees']).toEqual([{ email: 'a@b.com' }]);
    // first bound param is the caller user_id (org scoping)
    const params = mockDbQuery.mock.calls[0]![2] as string[];
    expect(params[0]).toBe('user-1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/calendar/events
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/calendar/events', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/events', 'POST', env, {
      title: 'X',
      start_utc: NOW,
      end_utc: LATER,
    });
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when start_utc is not an ISO datetime', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events', 'POST', env, {
      title: 'X',
      start_utc: 'yesterday',
      end_utc: LATER,
    });
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when title is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events', 'POST', env, {
      start_utc: NOW,
      end_utc: LATER,
    });
    expect(res.status).toBe(400);
  });

  it('creates an event with org_id scoping when a default calendar exists', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [{ id: 'cal-default' }] });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events', 'POST', env, {
      title: 'Launch',
      start_utc: NOW,
      end_utc: LATER,
      all_day: true,
      attendees: [{ email: 'x@y.com', name: 'X' }],
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string } };
    expect(typeof json.data.id).toBe('string');
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockDbInsert.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(table).toBe('calendar_events');
    expect(record['user_id']).toBe('user-1');
    expect(record['org_id']).toBe('org-1');
    expect(record['calendar_id']).toBe('cal-default');
    expect(record['all_day']).toBe(1);
    expect(record['attendees']).toContain('x@y.com');
  });

  it('bootstraps a default "Personal" calendar when the user has none', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [] }); // no existing calendar
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events', 'POST', env, {
      title: 'First',
      start_utc: NOW,
      end_utc: LATER,
    });
    expect(res.status).toBe(201);
    // two inserts: the bootstrapped calendar, then the event
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
    const calInsert = mockDbInsert.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(calInsert[1]).toBe('calendar_calendars');
    expect(calInsert[2]['name']).toBe('Personal');
    expect(calInsert[2]['is_default']).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/calendar/events/:id
// ════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/calendar/events/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/events/e1', 'PATCH', env, { title: 'New' });
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('updates only supplied fields, scoped to id + user_id', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events/e1', 'PATCH', env, {
      title: 'Renamed',
      all_day: true,
      attendees: [{ email: 'z@z.com' }],
    });
    expect(res.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const [, table, updates, where, params] = mockDbUpdate.mock.calls[0]! as [
      unknown,
      string,
      Record<string, unknown>,
      string,
      string[],
    ];
    expect(table).toBe('calendar_events');
    expect(updates['title']).toBe('Renamed');
    expect(updates['all_day']).toBe(1);
    expect(updates['attendees']).toContain('z@z.com');
    expect(where).toContain('user_id');
    expect(params).toEqual(['e1', 'user-1']);
  });

  it('no-ops the DB when the patch body is empty', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events/e1', 'PATCH', env, {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe('e1');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/calendar/events/:id
// ════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/calendar/events/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/events/e1', 'DELETE', env);
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('soft-deletes the event scoped to id + user_id', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/events/e9', 'DELETE', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe('e9');
    const [, table, updates, , params] = mockDbUpdate.mock.calls[0]! as [
      unknown,
      string,
      Record<string, unknown>,
      string,
      string[],
    ];
    expect(table).toBe('calendar_events');
    expect(updates['deleted_at']).toBeTruthy();
    expect(params).toEqual(['e9', 'user-1']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/calendar/calendars
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/calendar/calendars', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/calendars', 'GET', env);
    expect(res.status).toBe(401);
  });

  it('returns calendars with is_default coerced to boolean, scoped to user', async () => {
    mockDbQuery.mockResolvedValueOnce({
      data: [{ id: 'c1', name: 'Personal', color: '#00E5FF', is_default: 1 }],
    });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/calendars', 'GET', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]!['is_default']).toBe(true);
    expect((mockDbQuery.mock.calls[0]![2] as string[])[0]).toBe('user-1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/calendar/calendars
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/calendar/calendars', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/calendars', 'POST', env, { name: 'Work' });
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when color is not a valid hex', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/calendars', 'POST', env, {
      name: 'Work',
      color: 'blue',
    });
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('creates a calendar with org_id scoping', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/calendars', 'POST', env, {
      name: 'Work',
      color: '#112233',
      is_default: true,
    });
    expect(res.status).toBe(201);
    const [, table, record] = mockDbInsert.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(table).toBe('calendar_calendars');
    expect(record['user_id']).toBe('user-1');
    expect(record['org_id']).toBe('org-1');
    expect(record['is_default']).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/calendar/bookings
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/calendar/bookings', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/bookings', 'GET', env);
    expect(res.status).toBe(401);
  });

  it('returns bookings with public_url + is_active boolean, scoped to user', async () => {
    mockDbQuery.mockResolvedValueOnce({
      data: [{ id: 'b1', slug: 'intro-call', title: 'Intro', duration_min: 30, is_active: 1 }],
    });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'GET', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]!['is_active']).toBe(true);
    expect(json.data[0]!['public_url']).toBe('https://projectsites.dev/book/intro-call');
    expect((mockDbQuery.mock.calls[0]![2] as string[])[0]).toBe('user-1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/calendar/bookings
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/calendar/bookings', () => {
  const VALID = {
    slug: 'intro-call',
    title: 'Intro Call',
    duration_min: 30,
    weekdays: [1, 2, 3],
    window_start: '09:00',
    window_end: '17:00',
  };

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/calendar/bookings', 'POST', env, VALID);
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when slug has invalid characters', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'POST', env, {
      ...VALID,
      slug: 'Bad Slug!',
    });
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when window_start is not HH:MM', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'POST', env, {
      ...VALID,
      window_start: '9am',
    });
    expect(res.status).toBe(400);
  });

  it('creates a booking with org scoping + returns the public_url', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'POST', env, VALID);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; public_url: string } };
    expect(json.data.public_url).toBe('https://projectsites.dev/book/intro-call');
    const [, table, record] = mockDbInsert.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(table).toBe('calendar_bookings');
    expect(record['user_id']).toBe('user-1');
    expect(record['org_id']).toBe('org-1');
    expect(record['weekdays']).toBe('[1,2,3]');
    expect(record['is_active']).toBe(1);
  });

  it('returns 409 CONFLICT when the slug is already taken (UNIQUE violation)', async () => {
    mockDbInsert.mockRejectedValueOnce(new Error('D1_ERROR: UNIQUE constraint failed'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'POST', env, VALID);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('CONFLICT');
  });

  it('propagates a non-UNIQUE insert error to the error handler (500)', async () => {
    mockDbInsert.mockRejectedValueOnce(new Error('D1_ERROR: disk full'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/calendar/bookings', 'POST', env, VALID);
    expect(res.status).toBe(500);
  });
});
