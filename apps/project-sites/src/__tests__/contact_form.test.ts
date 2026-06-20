/**
 * Coverage for the PUBLIC `POST /api/contact-form/:slug` endpoint
 * (`routes/search.ts`). It forwards a visitor's submission to the site owner as
 * an HTML email. Because the visitor is UNAUTHENTICATED and the fields land in
 * an HTML document, every field MUST be HTML-escaped before interpolation —
 * otherwise a submitter injects markup (`<a href>`, `<script>`) into the email
 * the owner receives (phishing-the-owner via their own contact form).
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search } from '../routes/search.js';

/** D1 stub: the contact-form site lookup resolves to a site with a contact email. */
const SITE_ROW = {
  id: 'site-1',
  org_id: 'org-1',
  business_name: 'Newark Soup Kitchen',
  contact_email: 'owner@nsk.org',
};
function makeDb() {
  return {
    prepare: jest.fn(() => ({
      bind: jest.fn(() => ({
        // dbQueryOne → dbQuery uses `.all()` and reads `.results[0]`.
        all: jest.fn().mockResolvedValue({ results: [SITE_ROW] }),
        first: jest.fn().mockResolvedValue(SITE_ROW),
      })),
    })),
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    RESEND_API_KEY: 're_test_x',
    ...overrides,
  } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.route('/', search);

function submit(env: Env, body: unknown) {
  return app.request(
    '/api/contact-form/nsk',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('POST /api/contact-form/:slug — HTML-injection defense', () => {
  it('escapes schema-allowed-but-dangerous markup in the outgoing email body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;

    // `<a href>` passes contactFormSchema (only <script>/javascript: are rejected),
    // so it reaches the email body — escapeHtml must neutralise it.
    const res = await submit(makeEnv(), {
      name: '<a href="https://evil.com">click me</a>',
      email: 'visitor@example.com',
      message: 'hello <a href="https://evil.com">link</a> world, please reply soon',
    });
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const html: string = sentBody.html;
    expect(html).not.toContain('<a href="https://evil.com">');
    expect(html).toContain('&lt;a href=&quot;https://evil.com&quot;&gt;');
  });

  it('still requires name, email, and message (400 otherwise)', async () => {
    const res = await submit(makeEnv(), { name: 'A', email: 'a@b.c', message: 'short' }); // no message? message<10
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email (400) — the raw value flows into reply_to', async () => {
    const res = await submit(makeEnv(), {
      name: 'Visitor',
      email: 'not-an-email',
      message: 'a genuine inquiry message',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a too-short message (400) — basic empty/spam floor', async () => {
    const res = await submit(makeEnv(), { name: 'Visitor', email: 'v@x.test', message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('rejects a <script> in the message at the schema boundary (400, before escaping)', async () => {
    const res = await submit(makeEnv(), {
      name: 'Visitor',
      email: 'v@x.test',
      message: 'hello <script>alert(1)</script> there friend',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an over-length message (400) — abuse / email-cost cap', async () => {
    const res = await submit(makeEnv(), {
      name: 'Visitor',
      email: 'v@x.test',
      message: 'x'.repeat(5001),
    });
    expect(res.status).toBe(400);
  });

  it('logs a structured warning (no silent failure) when no email provider is configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Strip the default RESEND key → neither provider set.
    const res = await submit(makeEnv({ RESEND_API_KEY: undefined }), {
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'a genuine inquiry that should still be accepted',
    });
    expect(res.status).toBe(200); // still accepted (bell is the fallback)
    expect(fetchMock).not.toHaveBeenCalled(); // no email attempted
    // …but the silent drop is now observable in logs.
    const warned = warnSpy.mock.calls.some((args) => String(args[0]).includes('No email provider'));
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('preserves message line breaks as <br> (after escaping)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;
    await submit(makeEnv(), {
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'line1\nline2 — a real note',
    });
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.html).toContain('line1<br>line2');
  });
});
