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
  it('escapes injected markup in the outgoing email body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;

    const res = await submit(makeEnv(), {
      name: '<a href="https://evil.com">click me</a>',
      email: 'visitor@example.com',
      message: 'hello <script>alert(1)</script> world',
    });
    expect(res.status).toBe(200);

    // The email was sent…
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const html: string = sentBody.html;

    // …with the injected markup neutralised — no raw tags, entity-escaped instead.
    expect(html).not.toContain('<a href="https://evil.com">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;a href=&quot;https://evil.com&quot;&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still requires name, email, and message (400 otherwise)', async () => {
    const res = await submit(makeEnv(), { name: 'A', email: 'a@b.c' }); // no message
    expect(res.status).toBe(400);
  });

  it('preserves message line breaks as <br> (after escaping)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;
    await submit(makeEnv(), { name: 'A', email: 'a@b.c', message: 'line1\nline2' });
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.html).toContain('line1<br>line2');
  });
});
