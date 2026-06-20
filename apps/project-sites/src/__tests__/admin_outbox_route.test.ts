import { Hono } from 'hono';

import { adminOutbox } from '../routes/admin_outbox';
import { isSuperAdmin } from '../services/sysadmin.js';
import { outboxStats, readFailedOutbox } from '../services/event_bus.js';

/**
 * Super-Admin event-bus observability route — the HTTP guards over the outbox
 * read-layer (outboxStats / readFailedOutbox, unit-proven separately). Locks the
 * route contract: auth-required (401), super-admin-only (403), and the
 * stats+recentFailures shape on the happy path. The read-layer + sysadmin check
 * are mocked so no D1 is touched.
 */
jest.mock('../services/sysadmin.js', () => ({ isSuperAdmin: jest.fn() }));
jest.mock('../services/event_bus.js', () => ({
  outboxStats: jest.fn(),
  readFailedOutbox: jest.fn(),
}));

const mockIsSuperAdmin = isSuperAdmin as jest.MockedFunction<typeof isSuperAdmin>;
const mockStats = outboxStats as jest.Mock;
const mockFailed = readFailedOutbox as jest.Mock;

function makeApp(auth: { userId?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-test');
    if (auth.userId) c.set('userId', auth.userId);
    await next();
  });
  app.route('/', adminOutbox);
  return app;
}

const env = { DB: {} } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockStats.mockResolvedValue({ pending: 2, dispatched: 99, retrying: 1, deadLettered: 3 });
  mockFailed.mockResolvedValue([
    {
      id: 'a',
      type: 'invoice.paid',
      tenantId: 't1',
      attempts: 5,
      lastError: 'x',
      createdAt: 'now',
      deadLettered: true,
    },
  ]);
});

describe('GET /api/admin/outbox', () => {
  it('401s when unauthenticated', async () => {
    const res = await makeApp({}).request('/api/admin/outbox', { method: 'GET' }, env);
    expect(res.status).toBe(401);
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('403s when authed but not a super-admin', async () => {
    mockIsSuperAdmin.mockResolvedValue(false);
    const res = await makeApp({ userId: 'u1' }).request(
      '/api/admin/outbox',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(403);
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('returns stats + recentFailures for a super-admin', async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    const res = await makeApp({ userId: 'admin' }).request(
      '/api/admin/outbox',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: { deadLettered: number };
      recentFailures: unknown[];
      count: number;
    };
    expect(body.stats.deadLettered).toBe(3);
    expect(body.count).toBe(1);
    expect(body.recentFailures).toHaveLength(1);
  });

  it('400s on an invalid limit query', async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    const res = await makeApp({ userId: 'admin' }).request(
      '/api/admin/outbox?limit=abc',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(400);
  });
});
