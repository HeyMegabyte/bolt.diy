/**
 * Route coverage for `src/routes/forms.ts` (convergence r45).
 *
 * Two surfaces exercised through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (D1 helpers, the
 * newsletter-dispatch fan-out, the form-router improver, the audit log, the
 * feature-flag gate, and contacts-core):
 *
 * 1. **Public ingest** — `POST /api/v1/forms/submit`: missing-slug 400,
 *    unknown-site 404, disallowed-Origin 403, Zod 400, the no-integrations
 *    "received" path, and the all-success "forwarded" / partial fan-out paths
 *    (contact record + audit dispatch).
 * 2. **Auth-gated CRUD** — list submissions (401 unauthenticated, org-scoping
 *    404 non-leak, 200 success), list/create/patch/delete integrations,
 *    draft/send-reply, and form-router improve.
 *
 * The submit handler schedules a fire-and-forget AI-router block via
 * `executionCtx.waitUntil`; the test ExecutionContext swallows that promise so
 * its dynamic imports (mcp_client / ai_logger / credits) never run.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/newsletter_dispatch.js', () => ({
  dispatchToIntegrations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/form_router.js', () => ({
  improveRouterPrompt: jest.fn().mockResolvedValue({ mode: 'seed', text: 'seed prompt' }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../libs/features/contacts_core/service.js', () => ({
  recordContact: jest.fn().mockResolvedValue({ id: 'contact-1' }),
}));

jest.mock('../../libs/features/contacts_core/mappers.js', () => ({
  formSubmissionToContactInput: jest.fn(() => ({ orgId: 'org-1', email: 'v@x.com', metadata: {} })),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { forms } from '../routes/forms.js';
import { dbQuery, dbQueryOne, dbInsert, dbExecute } from '../services/db.js';
import { dispatchToIntegrations } from '../services/newsletter_dispatch.js';
import { improveRouterPrompt } from '../services/form_router.js';
import { writeAuditLog } from '../services/audit.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { recordContact } from '../../libs/features/contacts_core/service.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockDbInsert = dbInsert as unknown as jest.Mock;
const mockDbExecute = dbExecute as unknown as jest.Mock;
const mockDispatch = dispatchToIntegrations as unknown as jest.Mock;
const mockImprove = improveRouterPrompt as unknown as jest.Mock;
const mockAudit = writeAuditLog as unknown as jest.Mock;
const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockRecordContact = recordContact as unknown as jest.Mock;

// ─── Env + AI mock ───────────────────────────────────────────────────────────

/**
 * Chainable D1 stub. The submit handler's *fire-and-forget* AI-router block
 * (scheduled via `waitUntil`, swallowed by {@link makeCtx}) still EXECUTES
 * asynchronously and touches `c.env.DB` directly (credits → getBalance →
 * `prepare().bind().first()`). `first()` resolving to `null` makes
 * `getBalance` return 0, so the block short-circuits to a `writeAiLog`
 * (rate-limited) + early return before any AI call — preventing an unhandled
 * rejection from crashing the worker. The handler's OWN D1 reads go through
 * the *mocked* `db.js` helpers, not this stub.
 */
function makeDbStub(): D1Database {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    run: async () => ({ success: true, meta: { changes: 0 } }),
    all: async () => ({ results: [] }),
  };
  return {
    prepare: () => stmt,
    batch: async () => [],
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDbStub(),
    // The AI-router waitUntil block reads c.env.AI/.DB; never awaited by the test.
    AI: { run: jest.fn(async () => ({ response: '{}' })) },
    RESEND_API_KEY: 'test-resend-key',
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', forms);
  return app;
}

/** ExecutionContext that swallows the fire-and-forget AI-router waitUntil. */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

function request(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown },
  env: Env,
) {
  const headers = { ...JSON_HEADERS, ...(init.headers ?? {}) };
  return app.request(
    path,
    {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const SITE_ROW = { id: 'site-1', org_id: 'org-1', slug: 'acme' };
const OWNED_SITE = { id: 'site-1', slug: 'acme' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue({ error: null });
  mockDbExecute.mockResolvedValue({ error: null, changes: 1 });
  mockDispatch.mockResolvedValue([]);
  mockIsFlagOn.mockResolvedValue(false);
});

// ════════════════════════════════════════════════════════════════════════════
// Public ingest — POST /api/v1/forms/submit
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/forms/submit', () => {
  it('returns 400 when the X-Site-Slug header (and slug query) is missing', async () => {
    const env = makeEnv();
    const res = await request(makeApp(), '/api/v1/forms/submit', { method: 'POST', body: {} }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the site slug resolves to no row', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'ghost' }, body: {} },
      env,
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('returns 403 when the Origin is not in the site allow-list', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery.mockResolvedValueOnce({ data: [], error: null }); // hostnames
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      {
        method: 'POST',
        headers: { 'X-Site-Slug': 'acme', Origin: 'https://evil.example' },
        body: { form_name: 'contact' },
      },
      env,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('FORBIDDEN');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails Zod validation (bad form_name)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery.mockResolvedValueOnce({ data: [], error: null }); // hostnames
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'acme' }, body: { form_name: 'has spaces!' } },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('VALIDATION_ERROR');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('captures the submission with status "received" when no integrations exist (no-origin)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery
      .mockResolvedValueOnce({ data: [], error: null }) // hostnames
      .mockResolvedValueOnce({ data: [], error: null }); // active integrations
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      {
        method: 'POST',
        headers: { 'X-Site-Slug': 'acme' }, // no Origin → allowed
        body: { form_name: 'contact', email: 'v@x.com', fields: { msg: 'hi' } },
      },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { status: string; forwarded: number; id: string } };
    expect(json.data.status).toBe('received');
    expect(json.data.forwarded).toBe(0);
    expect(typeof json.data.id).toBe('string');

    // Persisted exactly one form_submissions row with the right status.
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockDbInsert.mock.calls[0];
    expect(table).toBe('form_submissions');
    expect((record as { status: string }).status).toBe('received');
    expect((record as { org_id: string }).org_id).toBe('org-1');
  });

  it('returns status "forwarded" and updates integration health when dispatch succeeds', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery
      .mockResolvedValueOnce({ data: [], error: null }) // hostnames
      .mockResolvedValueOnce({
        data: [{ id: 'int-1', site_id: 'site-1', provider: 'mailchimp' }],
        error: null,
      }); // active integrations
    mockDispatch.mockResolvedValueOnce([
      { integration_id: 'int-1', provider: 'mailchimp', ok: true, error: null },
    ]);
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'acme' }, body: { form_name: 'newsletter' } },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { status: string; forwarded: number } };
    expect(json.data.status).toBe('forwarded');
    expect(json.data.forwarded).toBe(1);
    // Health metadata update on success (UPDATE newsletter_integrations).
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('returns status "partial" when some integrations fail', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery
      .mockResolvedValueOnce({ data: [], error: null }) // hostnames
      .mockResolvedValueOnce({
        data: [
          { id: 'int-1', site_id: 'site-1', provider: 'mailchimp' },
          { id: 'int-2', site_id: 'site-1', provider: 'webhook' },
        ],
        error: null,
      });
    mockDispatch.mockResolvedValueOnce([
      { integration_id: 'int-1', provider: 'mailchimp', ok: true, error: null },
      { integration_id: 'int-2', provider: 'webhook', ok: false, error: 'timeout' },
    ]);
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'acme' }, body: { form_name: 'signup' } },
      env,
    );
    const json = (await res.json()) as { data: { status: string; failed: number } };
    expect(json.data.status).toBe('partial');
    expect(json.data.failed).toBe(1);
  });

  it('does NOT call recordContact when the contacts_core flag is off (default)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const env = makeEnv();
    await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'acme' }, body: { form_name: 'contact' } },
      env,
    );
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'contacts_core', expect.anything());
    expect(mockRecordContact).not.toHaveBeenCalled();
  });

  it('records a contact when the contacts_core flag is ON, and survives a CRM failure', async () => {
    mockDbQueryOne.mockResolvedValueOnce(SITE_ROW);
    mockDbQuery
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    mockIsFlagOn.mockResolvedValueOnce(true);
    mockRecordContact.mockRejectedValueOnce(new Error('CRM down'));
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/v1/forms/submit',
      { method: 'POST', headers: { 'X-Site-Slug': 'acme' }, body: { form_name: 'contact', email: 'v@x.com' } },
      env,
    );
    // CRM failure is caught + non-fatal → submission still 200.
    expect(res.status).toBe(200);
    expect(mockRecordContact).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth-gated: list submissions — GET /api/sites/:siteId/forms
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/sites/:siteId/forms', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await request(makeApp(), '/api/sites/site-1/forms', {}, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned by the caller org', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null); // loadOwnedSite → not found
    const env = makeEnv();
    const res = await request(makeApp(AUTH), '/api/sites/other-site/forms', {}, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('returns 200 with parsed submissions for an owned site', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE); // loadOwnedSite
    mockDbQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'sub-1',
          site_id: 'site-1',
          form_name: 'contact',
          email: 'v@x.com',
          payload: '{"msg":"hi"}',
          ip_address: null,
          user_agent: null,
          origin_url: null,
          forwarded_to: '["mailchimp:int-1"]',
          status: 'forwarded',
          created_at: '2026-01-01T00:00:00Z',
          replied_at: null,
          reply_subject: null,
        },
      ],
      error: null,
    });
    const env = makeEnv();
    const res = await request(makeApp(AUTH), '/api/sites/site-1/forms', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]['payload']).toEqual({ msg: 'hi' }); // safeJson parsed
    expect(json.data[0]['forwarded_to']).toEqual(['mailchimp:int-1']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth-gated: integrations CRUD — GET/POST/PATCH/DELETE
// ════════════════════════════════════════════════════════════════════════════

describe('integrations CRUD', () => {
  it('GET integrations returns 401 unauthenticated', async () => {
    const env = makeEnv();
    const res = await request(makeApp(), '/api/sites/site-1/integrations', {}, env);
    expect(res.status).toBe(401);
  });

  it('GET integrations returns 200 with masked rows (active coerced to boolean)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE);
    mockDbQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'int-1',
          site_id: 'site-1',
          provider: 'mailchimp',
          list_id: 'l1',
          webhook_url: null,
          api_key_preview: 'ab…yz',
          active: 1,
          last_dispatch_at: null,
          last_error: null,
          config: null,
          created_at: 'c',
          updated_at: 'u',
        },
      ],
      error: null,
    });
    const env = makeEnv();
    const res = await request(makeApp(AUTH), '/api/sites/site-1/integrations', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]['active']).toBe(true);
    expect(json.data[0]['api_key_preview']).toBe('ab…yz');
  });

  it('POST integrations returns 400 when the body fails the Zod refine (webhook without url)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE);
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations',
      { method: 'POST', body: { provider: 'webhook' } }, // missing webhook_url
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('VALIDATION_ERROR');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('POST integrations creates a mailchimp integration and writes an audit log', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE);
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations',
      { method: 'POST', body: { provider: 'mailchimp', api_key: 'mc-secret-key', list_id: 'l1' } },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { provider: string; api_key_preview: string | null } };
    expect(json.data.provider).toBe('mailchimp');
    // Preview masks the raw key — never echoed in full.
    expect(json.data.api_key_preview).not.toBe('mc-secret-key');
    expect(json.data.api_key_preview).toContain('…');

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockDbInsert.mock.calls[0];
    expect(table).toBe('newsletter_integrations');
    expect((record as { provider: string }).provider).toBe('mailchimp');
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it('PATCH integration returns 404 when the integration is not found for the site', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE) // loadOwnedSite
      .mockResolvedValueOnce(null); // existing integration lookup → none
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations/int-x',
      { method: 'PATCH', body: { active: false } },
      env,
    );
    expect(res.status).toBe(404);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('PATCH integration toggles active and returns { updated: true }', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE)
      .mockResolvedValueOnce({ id: 'int-1' }); // existing
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations/int-1',
      { method: 'PATCH', body: { active: false } },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { updated: boolean } };
    expect(json.data.updated).toBe(true);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it('DELETE integration returns 404 when nothing was soft-deleted', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE)
      .mockResolvedValueOnce({ provider: 'mailchimp' }); // lookup row
    mockDbExecute.mockResolvedValueOnce({ error: null, changes: 0 }); // nothing deleted
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations/int-x',
      { method: 'DELETE' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('DELETE integration soft-deletes and writes an audit log', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE)
      .mockResolvedValueOnce({ provider: 'mailchimp' });
    mockDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/integrations/int-1',
      { method: 'DELETE' },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth-gated: AI auto-reply — draft-reply / send-reply
// ════════════════════════════════════════════════════════════════════════════

const SUBMISSION_ROW = {
  id: 'sub-1',
  site_id: 'site-1',
  form_name: 'contact',
  email: 'visitor@example.com',
  payload: '{"message":"I need a quote"}',
  origin_url: null,
  created_at: '2026-01-01T00:00:00Z',
  replied_at: null,
};

describe('POST /api/sites/:siteId/form-submissions/:submissionId/draft-reply', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/sites/site-1/form-submissions/sub-1/draft-reply',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the submission is not found for the owned site', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE) // loadOwnedSite
      .mockResolvedValueOnce(null); // submission lookup → none
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/ghost/draft-reply',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with a drafted subject + body from Workers AI', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    const aiJson = JSON.stringify({ subject: 'Re: your quote', body: '<p>Happy to help!</p>' });
    const env = makeEnv({ AI: { run: jest.fn(async () => ({ response: aiJson })) } });
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/draft-reply',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { subject: string; body: string; cost_usd: number };
    };
    expect(json.data.subject).toBe('Re: your quote');
    expect(json.data.body).toContain('Happy to help');
    expect(typeof json.data.cost_usd).toBe('number');
  });

  it('returns 400 when the AI call throws (drafting failed)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    const env = makeEnv({
      AI: {
        run: jest.fn(async () => {
          throw new Error('AI gateway 503');
        }),
      },
    });
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/draft-reply',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
  });
});

describe('POST /api/sites/:siteId/form-submissions/:submissionId/send-reply', () => {
  let fetchSpy: jest.SpyInstance;
  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { subject: 's', body: 'b' } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when the body fails Zod validation (missing subject)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { body: 'hi' } },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when RESEND_API_KEY is not configured', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    const env = makeEnv({ RESEND_API_KEY: undefined });
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { subject: 'Hi', body: '<p>Hi</p>' } },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/not configured/i);
  });

  it('sends via Resend, marks replied_at, and writes an audit log on success', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"id":"email-1"}', {
        status: 200,
        headers: { 'x-resend-request-id': 'resend-req-1' },
      }),
    );
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { subject: 'Re: quote', body: '<p>Thanks!</p>' } },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { sent: boolean; to: string } };
    expect(json.data.sent).toBe(true);
    expect(json.data.to).toBe('visitor@example.com');
    expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
    // form_submissions UPDATE (replied_at) + audit log.
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when Resend rejects the send (non-2xx)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE).mockResolvedValueOnce(SUBMISSION_ROW);
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { subject: 'Re: quote', body: '<p>Thanks!</p>' } },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/Resend rejected/i);
    // Submission must NOT be marked replied when the send failed.
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when the submission has no email and no override_to', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce(OWNED_SITE)
      .mockResolvedValueOnce({ ...SUBMISSION_ROW, email: null });
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-submissions/sub-1/send-reply',
      { method: 'POST', body: { subject: 'Hi', body: '<p>Hi</p>' } },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/no email/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth-gated: form-router improve
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sites/:siteId/form-router/improve', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await request(
      makeApp(),
      '/api/sites/site-1/form-router/improve',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(401);
    expect(mockImprove).not.toHaveBeenCalled();
  });

  it('returns 404 when the site is not owned', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/other/form-router/improve',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(404);
    expect(mockImprove).not.toHaveBeenCalled();
  });

  it('returns 200 with the improver output (empty body → seed)', async () => {
    mockDbQueryOne.mockResolvedValueOnce(OWNED_SITE);
    const env = makeEnv();
    const res = await request(
      makeApp(AUTH),
      '/api/sites/site-1/form-router/improve',
      { method: 'POST', body: {} },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { mode: string; text: string } };
    expect(json.data.mode).toBe('seed');
    expect(mockImprove).toHaveBeenCalledTimes(1);
    // value defaults to '' when body has no string value.
    expect(mockImprove.mock.calls[0][1]).toBe('');
  });
});
