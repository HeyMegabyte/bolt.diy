/**
 * Value-domain coverage (TDD Contract #10) for `PUT /api/sites/:siteId/ai-settings`
 * email validation. `contact_email`/`reply_email` are FE-validated (`emailInvalid()`);
 * this locks the raw-API boundary too ([[zod-everywhere]]): a NON-empty value must
 * be a real email (≤254 chars); `''`/`null` clear the field; omitted keys pass
 * (partial saves — e.g. the lone `{allow_web_research}` toggle). Guards against the
 * raw API storing a garbage transactional-email address.
 *
 * Audit is mocked; a single-row D1 stub satisfies `siteOwned()` so requests reach
 * the email gate.
 */
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { aiAdmin } from '../routes/ai_admin.js';

function db(): D1Database {
  const chain: Record<string, unknown> = {
    bind: jest.fn(() => chain),
    first: jest.fn(async () => ({ slug: 'apple', org_id: 'org-1' })),
    all: jest.fn(async () => ({ results: [] })),
    run: jest.fn(async () => ({ success: true })),
  };
  return { prepare: jest.fn(() => chain), batch: jest.fn(async () => []) } as unknown as D1Database;
}
function env(): Env {
  return { ENVIRONMENT: 'test', DB: db() } as unknown as Env;
}
function app(): Hono<{ Bindings: Env; Variables: Variables }> {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    c.set('userId', 'u1');
    c.set('orgId', 'org-1');
    c.set('requestId', 'r1');
    await next();
  });
  a.route('/', aiAdmin);
  return a;
}
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;
const put = (bodyObj: unknown): Promise<Response> =>
  app().request(
    '/api/sites/s1/ai-settings',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    },
    env(),
    ctx,
  );

describe('PUT ai-settings — email value domains (TDD #10)', () => {
  it('VALID: both emails well-formed → 200', async () => {
    expect(
      (await put({ contact_email: 'hello@yourbiz.com', reply_email: 'owner@yourbiz.com' })).status,
    ).toBe(200);
  });
  it('EMPTY string clears the field → 200', async () => {
    expect((await put({ contact_email: '', reply_email: '' })).status).toBe(200);
  });
  it('NULL clears the field → 200', async () => {
    expect((await put({ contact_email: null, reply_email: null })).status).toBe(200);
  });
  it('PARTIAL body (only the web-research toggle) → 200, emails untouched', async () => {
    expect((await put({ allow_web_research: true })).status).toBe(200);
  });
  it('EMPTY body → 200 (no-op save)', async () => {
    expect((await put({})).status).toBe(200);
  });
  it('INVALID contact_email (not an email) → 400', async () => {
    expect((await put({ contact_email: 'not-an-email' })).status).toBe(400);
  });
  it('INVALID reply_email while contact_email is valid → 400', async () => {
    expect((await put({ contact_email: 'a@b.com', reply_email: 'garbage' })).status).toBe(400);
  });
  it('OVERLONG email (>254 chars) → 400', async () => {
    expect((await put({ contact_email: 'x'.repeat(250) + '@b.com' })).status).toBe(400);
  });
  it('INJECTION-shaped non-email → 400', async () => {
    expect((await put({ contact_email: "<script>@x'; DROP" })).status).toBe(400);
  });
});
