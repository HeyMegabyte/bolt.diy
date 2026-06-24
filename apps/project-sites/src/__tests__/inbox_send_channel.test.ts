/**
 * Unit coverage for `sendViaChannel` (services/inbox.ts) — the email channel
 * wraps an owner-authored reply in HTML (`<p>…</p>`) and sends it to the
 * visitor via Resend. The reply is plain text, so it MUST be HTML-escaped
 * before interpolation (a literal `<`/`&` would otherwise render broken, and
 * any markup would be injected into the visitor's inbox).
 */
import { sendViaChannel } from '../services/inbox.js';
import type { Env } from '../types/env.js';
import type { ConversationRow } from '../services/inbox.js';
import type { VisitorIdentityRow } from '../services/visitor_identity.js';

const emailConv = { id: 'c1', org_id: 'o1', site_id: 's1', channel: 'email' } as ConversationRow;
const visitor = { email: 'visitor@example.com' } as VisitorIdentityRow;

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', RESEND_API_KEY: 're_x' } as unknown as Env;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('sendViaChannel — email HTML escaping', () => {
  it('escapes an owner reply containing markup before sending', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;

    const result = await sendViaChannel(
      makeEnv(),
      emailConv,
      visitor,
      'See <a href="https://evil.com">here</a> & save 5 < 10',
    );
    expect(result.sent).toBe(true);

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.html).not.toContain('<a href="https://evil.com">');
    expect(sent.html).toContain('&lt;a href=&quot;https://evil.com&quot;&gt;');
    expect(sent.html).toContain('&amp; save 5 &lt; 10');
  });

  it('converts reply newlines to <br>', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;
    await sendViaChannel(makeEnv(), emailConv, visitor, 'line1\nline2');
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.html).toBe('<p>line1<br>line2</p>');
  });
});

describe('sendViaChannel — SES-primary cutover (ADR-0019)', () => {
  function makeSesEnv(): Env {
    return {
      ENVIRONMENT: 'test',
      RESEND_API_KEY: 're_x',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
      AWS_DEFAULT_REGION: 'us-east-1',
      SES_FROM_EMAIL: 'noreply@projectsites.dev',
    } as unknown as Env;
  }

  it('routes the email reply through Amazon SES, not Resend, when SES is configured', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response('{"MessageId":"ses-1"}', { status: 200 }));
    global.fetch = fetchMock;
    const result = await sendViaChannel(makeSesEnv(), emailConv, visitor, 'hello');
    expect(result.sent).toBe(true);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('amazonaws.com'))).toBe(true);
    expect(urls.some((u) => u.includes('api.resend.com'))).toBe(false);
  });
});
