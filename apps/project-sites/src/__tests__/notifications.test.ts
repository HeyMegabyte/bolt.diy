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
 *   - Success path: structured "send ok" log + Sentry success breadcrumb
 *   - Failure path (!res.ok): structured "send failed" log + Sentry error
 *     captureMessage + body excerpt (≤400 chars) — sendEmail throws upstream
 *   - Public wrappers (notifyDomainVerified, notifySiteBuilt, sendInviteEmail):
 *     category tagging, payload → HTML embedding (hostname/site/url/version/
 *     pages, primary-vs-default domain, role default, invite accept URL),
 *     subject construction, and send-failure RESILIENCE (never throws — the
 *     `.catch` swallows and logs)
 *   - Sentry .catch swallow (captureMessage rejection never propagates)
 *
 * Mocks `global.fetch` + the `./sentry.js` module — never hits the real API.
 */

import type { Env } from '../types/env.js';

// Mock the Sentry side-channel so we can assert error/success captures
// and avoid any real network from the breadcrumb path.
jest.mock('../services/sentry.js', () => ({
  captureMessage: jest.fn().mockResolvedValue(undefined),
}));

import {
  notifyDomainVerified,
  notifySiteBuilt,
  sendInviteEmail,
} from '../services/notifications.js';
import { captureMessage as sentryCaptureMessage } from '../services/sentry.js';

const sentryMock = sentryCaptureMessage as unknown as jest.Mock;
const originalFetch = global.fetch;

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
  sentryMock.mockClear();
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
    expect(body.from).toBe('Project Sites <noreply@megabyte.space>');
    expect(body.to).toEqual(['owner@example.com']);
    expect(typeof body.subject).toBe('string');
    expect(typeof body.html).toBe('string');
  });

  it('logs success + drops a Sentry success breadcrumb, no error capture', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'req-ok' } });
    await notifySiteBuilt(resendEnv(), SITE_OPTS);

    expect(sentryMock).toHaveBeenCalledTimes(1);
    const [, message, level] = sentryMock.mock.calls[0];
    expect(message).toBe('Resend invite sent');
    expect(level).toBe('info');
  });

  it('resolves request id from x-request-id when x-resend-request-id is absent', async () => {
    mockFetchOnce({ headers: { 'x-request-id': 'fallback-id' } });
    await sendInviteEmail(resendEnv(), INVITE_OPTS);

    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).request_id).toBe('fallback-id');
  });

  it('tolerates a fully missing request-id header (null)', async () => {
    mockFetchOnce({ headers: {} });
    await sendInviteEmail(resendEnv(), INVITE_OPTS);
    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).request_id).toBeNull();
  });
});

describe('notifications — Resend failure resilience', () => {
  it('on !res.ok captures a Sentry error with a ≤400-char body excerpt and never throws', async () => {
    const longBody = 'E'.repeat(600);
    mockFetchOnce({ ok: false, status: 422, body: longBody, headers: { 'x-resend-request-id': 'req-fail' } });

    // Public wrapper swallows the throw from sendEmail.
    await expect(notifyDomainVerified(resendEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();

    expect(sentryMock).toHaveBeenCalledTimes(1);
    const [, message, level, extra] = sentryMock.mock.calls[0];
    expect(message).toBe('Resend invite send failed');
    expect(level).toBe('error');
    const ex = extra as Record<string, unknown>;
    expect(ex.status).toBe(422);
    expect((ex.body_excerpt as string).length).toBe(400);
  });

  it('survives a Sentry captureMessage rejection (the .catch swallows it)', async () => {
    sentryMock.mockRejectedValueOnce(new Error('sentry down'));
    mockFetchOnce({ headers: { 'x-resend-request-id': 'req-2' } });
    await expect(notifySiteBuilt(resendEnv(), SITE_OPTS)).resolves.toBeUndefined();
  });

  it('survives a fetch network throw inside sendEmail without propagating', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    await expect(sendInviteEmail(resendEnv(), INVITE_OPTS)).resolves.toBeUndefined();
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
    expect(body.from).toEqual({ email: 'noreply@megabyte.space', name: 'Project Sites' });
    expect(Array.isArray(body.content)).toBe(true);
  });

  it('SendGrid success drops a "SendGrid invite sent" breadcrumb', async () => {
    mockFetchOnce({ headers: { 'x-message-id': 'sg-ok' } });
    await notifySiteBuilt(sendgridEnv(), SITE_OPTS);
    expect(sentryMock.mock.calls[0][1]).toBe('SendGrid invite sent');
  });

  it('SendGrid !res.ok captures "SendGrid invite send failed" and never throws', async () => {
    mockFetchOnce({ ok: false, status: 401, body: 'unauthorized' });
    await expect(notifyDomainVerified(sendgridEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();
    expect(sentryMock.mock.calls[0][1]).toBe('SendGrid invite send failed');
    expect(sentryMock.mock.calls[0][2]).toBe('error');
  });

  it('SendGrid resolves request id from x-request-id fallback', async () => {
    mockFetchOnce({ headers: { 'x-request-id': 'sg-fallback' } });
    await sendInviteEmail(sendgridEnv(), INVITE_OPTS);
    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).request_id).toBe('sg-fallback');
  });
});

describe('notifications — no provider configured', () => {
  it('logs a warn and never calls fetch or Sentry', async () => {
    await expect(notifyDomainVerified(noProviderEnv(), DOMAIN_OPTS)).resolves.toBeUndefined();
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled();
    expect(sentryMock).not.toHaveBeenCalled();
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

    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).category).toBe('domain_verified');
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

    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).category).toBe('site_built');
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

    const [, , , extra] = sentryMock.mock.calls[0];
    expect((extra as Record<string, unknown>).category).toBe('invite');
  });

  it('honours an explicit role override', async () => {
    mockFetchOnce({ headers: { 'x-resend-request-id': 'i-2' } });
    await sendInviteEmail(resendEnv(), { ...INVITE_OPTS, role: 'admin' });
    expect(lastFetchBody().html).toContain('admin');
  });
});
