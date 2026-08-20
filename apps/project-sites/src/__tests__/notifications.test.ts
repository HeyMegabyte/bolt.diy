/**
 * Unit tests for the transactional-email notifications service
 * ({@link services/notifications.ts}).
 *
 * Covers every real branch:
 *   - sendEmail provider routing: Resend (primary) when RESEND_API_KEY set,
 *     SendGrid fallback when only SENDGRID_API_KEY set, no-provider warn path
 *   - Request build for each provider: URL, method, Bearer auth, Content-Type,
 *     from address, recipient array / personalizations, subject, html body
 *   - request-id header resolution (x-resend-request-id → x-request-id;
 *     x-message-id → x-request-id) with null-header fallback
 *   - Success path: structured `log.info('… sent', ctx)` breadcrumb
 *   - Failure path (!res.ok): structured `log.error('… send failed', ctx)` with
 *     body excerpt (≤400 chars) — sendEmail throws upstream
 *   - Public wrappers (notifyDomainVerified, notifySiteBuilt, sendInviteEmail):
 *     category tagging, payload → HTML embedding (hostname/site/url/version/
 *     pages, primary-vs-default domain, role default, invite accept URL),
 *     subject construction, and send-failure RESILIENCE (never throws — the
 *     wrapper swallows and the structured logger records context)
 *   - Instrumentation resilience: a throwing logger never propagates out of a
 *     fire-and-forget notification wrapper
 *
 * Mocks `global.fetch` + the `../lib/log.js` structured logger — never hits the
 * real API. Sentry was removed in favour of Axiom-bound structured logs +
 * PostHog product analytics (see docs/observability/sentry-removed.md).
 */

import type { Env } from '../types/env.js';

// Mock the structured logger so we can assert the success/failure breadcrumbs
// without emitting real log lines during the test run.
jest.mock('../lib/log.js', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  },
}));

import {
  sendEmail,
  notifyDomainVerified,
  notifySiteBuilt,
  sendInviteEmail,
} from '../services/notifications.js';
import { log } from '../lib/log.js';

const logInfo = log.info as unknown as jest.Mock;
const logError = log.error as unknown as jest.Mock;
const logWarn = log.warn as unknown as jest.Mock;
const originalFetch = global.fetch;

/** Context object of the single breadcrumb emitted (error wins over info). */
function breadcrumbCtx(): Record<string, unknown> {
  const call = logError.mock.calls[0] ?? logInfo.mock.calls[0];
  return (call?.[1] ?? {}) as Record<string, unknown>;
}

interface MockResInit {
  ok?: boolean;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

function mockFetchOnce(init: MockResInit = {}): void {
  const headers = init.headers ?? {};
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string): string | null => headers[name.toLowerCase()] ?? null,
    },
    text: async () => init.body ?? '',
  });
}

const resendEnv = (): Env => ({ RESEND_API_KEY: 'resend-key-xyz' }) as unknown as Env;
const sendgridEnv = (): Env => ({ SENDGRID_API_KEY: 'sg-key-xyz' }) as unknown as Env;
const noProviderEnv = (): Env => ({}) as unknown as Env;

const DOMAIN_OPTS = {
  email: 'owner@example.com',
  hostname: 'shop.example.com',
  primaryDomain: 'shop.example.com',
  defaultDomain: 'shop.projectsites.dev',
  siteName: "Vito's Salon",
};

const SITE_OPTS = {
  email: 'owner@example.com',
  siteName: "Vito's Salon",
  slug: 'vitos',
  siteUrl: 'https://vitos.projectsites.dev',
  version: 'v3',
  pagesGenerated: 7,
};

const INVITE_OPTS = {
  email: 'invitee@example.com',
  orgName: 'Acme Org',
  inviterName: 'Jane Boss',
  acceptUrl: 'https://projectsites.dev/invite/abc123',
};

function lastFetch(): [string, RequestInit] {
  const calls = (global.fetch as jest.Mock).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

function lastFetchBody(): Record<string, unknown> {
  const [, init] = lastFetch();
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  logInfo.mockReset();
  logError.mockReset();
  logWarn.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('notifications — Resend provider (primary)', () => {
  it('posts to the Resend API with bearer auth, from address and recipient array', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'req-1' } });
    await notifyDomainVerified(resendEnv(), DOMAIN_OPTS);

    const [url, init] = lastFetch();
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer resend-key-xyz');
    expect(headers['Content-Type']).toBe('application/json');

    const body = lastFetchBody();
    expect(body.from).toBe('Project Sites <noreply@projectsites.dev>');
    expect(body.to).toEqual(['owner@example.com']);
    expect(typeof body.subject).toBe('string');
    expect(typeof body.html).toBe('string');
  });

  it('logs success via log.info, no error breadcrumb', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'req-ok' } });
    await notifySiteBuilt(resendEnv(), SITE_OPTS);

    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
    expect(logInfo.mock.calls[0][0]).toBe('Resend invite sent');
  });

  it('resolves request id from x-request-id when x-resend-request-id is absent', async () => {
    mockFetchOnce({ headers: { 'x-request-id': 'fallback-id' } });
    await sendInviteEmail(resendEnv(), INVITE_OPTS);

    expect(breadcrumbCtx().request_id).toBe('fallback-id');
  });

  it('tolerates a fully missing request-id header (null)', async () => {
    mockFetchOnce({ headers: {} });
    await sendInviteEmail(resendEnv(), INVITE_OPTS);
    expect(breadcrumbCtx().request_id).toBeNull();
  });
});

describe('notifications — Resend failure resilience', () => {
  it('on !res.ok logs an error with a ≤400-char body excerpt and never throws', async () => {
    const longBody = 'E'.repeat(600);
    mockFetchOnce({
      ok: false,
      status: 422,
      body: longBody,
      headers: { 'x-resend-request-id': 'req-fail' },
    });

    // Public wrapper swallows the throw from sendEmail.
    await expect(notifyDomainVerified(resendEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe('Resend invite send failed');
    const ex = logError.mock.calls[0][1] as Record<string, unknown>;
    expect(ex.status).toBe(422);
    expect((ex.body_excerpt as string).length).toBe(400);
  });

  it('survives a throwing logger without propagating', async () => {
    logInfo.mockImplementationOnce(() => {
      throw new Error('log down');
    });
    mockFetchOnce({ headers: { 'x-resend-request-id': 'req-2' } });
    await expect(notifySiteBuilt(resendEnv(), SITE_OPTS)).resolves.toBeUndefined();
  });

  it('survives a fetch network throw inside sendEmail without propagating', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    await expect(sendInviteEmail(resendEnv(), INVITE_OPTS)).resolves.toBeUndefined();
  });

  it('the terminal failure warn carries category + to (grep-the-tail attribution)', async () => {
    mockFetchOnce({ ok: false, status: 422, body: 'nope', headers: {} });
    await notifyDomainVerified(resendEnv(), DOMAIN_OPTS);

    const warns = (console.warn as jest.Mock).mock.calls
      .map((c) => c[0])
      .filter((a): a is string => typeof a === 'string');
    const terminal = warns
      .map((w) => JSON.parse(w) as Record<string, unknown>)
      .find((w) => w.message === 'Failed to send domain verified email');
    expect(terminal).toBeDefined();
    expect(terminal?.category).toBe('domain_verified');
    expect(terminal?.to).toBe('owner@example.com');
  });

  it('notifySiteBuilt terminal warn also carries category + to', async () => {
    mockFetchOnce({ ok: false, status: 422, body: 'nope', headers: {} });
    await notifySiteBuilt(resendEnv(), SITE_OPTS);

    const warns = (console.warn as jest.Mock).mock.calls
      .map((c) => c[0])
      .filter((a): a is string => typeof a === 'string');
    const terminal = warns
      .map((w) => JSON.parse(w) as Record<string, unknown>)
      .find((w) => w.message === 'Failed to send site built email');
    expect(terminal).toBeDefined();
    expect(terminal?.category).toBe('site_built');
    expect(terminal?.to).toBe('owner@example.com');
  });
});

describe('notifications — SendGrid fallback', () => {
  it('routes to SendGrid when only SENDGRID_API_KEY is set, with personalizations shape', async () => {
    mockFetchOnce({ headers: { 'x-message-id': 'sg-1' } });
    await notifyDomainVerified(sendgridEnv(), DOMAIN_OPTS);

    const [url, init] = lastFetch();
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sg-key-xyz');

    const body = lastFetchBody();
    expect(body.personalizations).toEqual([{ to: [{ email: 'owner@example.com' }] }]);
    expect(body.from).toEqual({ email: 'noreply@projectsites.dev', name: 'Project Sites' });
    expect(Array.isArray(body.content)).toBe(true);
  });

  it('SendGrid success logs a "SendGrid invite sent" breadcrumb', async () => {
    mockFetchOnce({ headers: { 'x-message-id': 'sg-ok' } });
    await notifySiteBuilt(sendgridEnv(), SITE_OPTS);
    expect(logInfo.mock.calls[0][0]).toBe('SendGrid invite sent');
  });

  it('SendGrid !res.ok logs "SendGrid invite send failed" and never throws', async () => {
    mockFetchOnce({ ok: false, status: 401, body: 'unauthorized' });
    await expect(notifyDomainVerified(sendgridEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();
    expect(logError.mock.calls[0][0]).toBe('SendGrid invite send failed');
  });

  it('SendGrid resolves request id from x-request-id fallback', async () => {
    mockFetchOnce({ headers: { 'x-request-id': 'sg-fallback' } });
    await sendInviteEmail(sendgridEnv(), INVITE_OPTS);
    expect(breadcrumbCtx().request_id).toBe('sg-fallback');
  });
});

describe('notifications — no provider configured', () => {
  it('logs a warn and never calls fetch or the breadcrumb loggers', async () => {
    await expect(notifyDomainVerified(noProviderEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('notifyDomainVerified — payload embedding', () => {
  it('embeds hostname, site name and the primary domain in the HTML; tags category domain_verified', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'd-1' } });
    await notifyDomainVerified(resendEnv(), DOMAIN_OPTS);

    const body = lastFetchBody();
    expect(body.subject).toBe('Domain connected: shop.example.com');
    expect(body.html).toContain('shop.example.com');
    expect(body.html).toContain("Vito's Salon");
    expect(body.html).toContain('shop.projectsites.dev');

    expect(breadcrumbCtx().category).toBe('domain_verified');
  });

  it('falls back to hostname when primaryDomain is null', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'd-2' } });
    await notifyDomainVerified(resendEnv(), { ...DOMAIN_OPTS, primaryDomain: null });
    const body = lastFetchBody();
    // primary label shows the hostname (primaryDomain || hostname)
    expect(body.html).toContain('shop.example.com');
  });
});

describe('notifySiteBuilt — payload embedding', () => {
  it('embeds site url, version and the pages-generated line when provided', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 's-1' } });
    await notifySiteBuilt(resendEnv(), SITE_OPTS);

    const body = lastFetchBody();
    expect(body.subject).toBe("Site published: Vito's Salon");
    expect(body.html).toContain('https://vitos.projectsites.dev');
    expect(body.html).toContain('v3');
    expect(body.html).toContain('7 generated');

    expect(breadcrumbCtx().category).toBe('site_built');
  });

  it('omits the pages line when pagesGenerated is absent', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 's-2' } });
    const { pagesGenerated: _omit, ...noPages } = SITE_OPTS;
    await notifySiteBuilt(resendEnv(), noPages);
    const body = lastFetchBody();
    expect(body.html).not.toContain('generated</span>');
  });
});

describe('sendInviteEmail — payload embedding', () => {
  it('embeds org/inviter/accept-url, defaults role to member, tags category invite', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'i-1' } });
    await sendInviteEmail(resendEnv(), INVITE_OPTS);

    const body = lastFetchBody();
    expect(body.subject).toBe('Jane Boss invited you to Acme Org');
    expect(body.html).toContain('Acme Org');
    expect(body.html).toContain('Jane Boss');
    expect(body.html).toContain('https://projectsites.dev/invite/abc123');
    expect(body.html).toContain('member');

    expect(breadcrumbCtx().category).toBe('invite');
  });

  it('honours an explicit role override', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'i-2' } });
    await sendInviteEmail(resendEnv(), { ...INVITE_OPTS, role: 'admin' });
    expect(lastFetchBody().html).toContain('admin');
  });
});

describe('sendEmail — suppression enforcement across ALL rails (§42/ADR-0019)', () => {
  /** A Resend-configured env whose DB.prepare().bind().all() yields the given
   *  suppression lookup result (isSuppressed → dbQueryOne → dbQuery uses `.all()`).
   *  'suppressed' = a matching row, 'clear' = none, 'error' = the query throws
   *  (dbQuery catches internally → null → NOT suppressed → send proceeds = fail-open). */
  function envWithDb(lookup: 'suppressed' | 'clear' | 'error'): Env {
    const all = jest.fn(async () => {
      if (lookup === 'error') throw new Error('d1 down');
      return { results: lookup === 'suppressed' ? [{ email: 'x@y.com' }] : [] };
    });
    const bind = jest.fn().mockReturnValue({ all });
    const prepare = jest.fn().mockReturnValue({ bind });
    return { RESEND_API_KEY: 'resend-key-xyz', DB: { prepare } } as unknown as Env;
  }
  const opts = { to: 'bounced@example.com', subject: 'Hi', html: '<p>hi</p>' };

  it('skips EVERY rail (no fetch) + returns when the recipient is suppressed', async () => {
    // Provide a rail response anyway — if the (RED) unguarded code reaches the Resend
    // fetch, this assertion catches it. GREEN: the seam returns before any rail.
    mockFetchOnce({ ok: true, headers: { 'x-resend-request-id': 'r' } });
    await sendEmail(envWithDb('suppressed'), opts);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('proceeds to send when the recipient is NOT suppressed', async () => {
    mockFetchOnce({ ok: true, headers: { 'x-resend-request-id': 'r' } });
    await sendEmail(envWithDb('clear'), opts);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('FAILS OPEN — a suppression-lookup error proceeds to send (never blocks a legit email)', async () => {
    mockFetchOnce({ ok: true, headers: { 'x-resend-request-id': 'r' } });
    await sendEmail(envWithDb('error'), opts);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('has no DB binding → skips the check + sends (backward compatible)', async () => {
    mockFetchOnce({ ok: true, headers: { 'x-resend-request-id': 'r' } });
    await sendEmail(resendEnv(), opts);
    expect(global.fetch).toHaveBeenCalled();
  });
});
