/**
 * Convergence §42/ADR-0019 — AmazonSesEmailProvider.
 *
 * Locks: SES v2 endpoint + body shape, SigV4-signed Authorization header, 2xx→
 * accepted, non-2xx→throw, missing-config→throw, input validation — via an
 * injected fetch + fixed clock (no network).
 */
import { AmazonSesEmailProvider } from '../services/ses_email_provider.js';
import { EmailInputError } from '../platform/email.js';

const fixedNow = () => new Date('2026-06-20T00:00:00Z');
const goodEnv = {
  AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'secret',
  AWS_DEFAULT_REGION: 'us-east-1',
  SES_FROM_EMAIL: 'noreply@mail.projectsites.dev',
};

function fakeFetch(status = 200, json: unknown = { MessageId: 'msg-1' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const send = { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', kind: 'receipt' as const };

describe('AmazonSesEmailProvider', () => {
  it('posts a signed SES v2 SendEmail and returns the MessageId', async () => {
    const f = fakeFetch();
    const p = new AmazonSesEmailProvider(goodEnv, { fetchImpl: f, now: fixedNow });
    const r = await p.sendTransactional(send);

    expect(r).toEqual({ id: 'msg-1', accepted: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260620\/us-east-1\/ses\/aws4_request/,
    );
    expect(h['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.FromEmailAddress).toBe('noreply@mail.projectsites.dev');
    expect(body.Destination.ToAddresses).toEqual(['a@b.com']);
    expect(body.Content.Simple.Subject.Data).toBe('Hi');
    // No replyTo on the input → SES body omits ReplyToAddresses entirely.
    expect(body.ReplyToAddresses).toBeUndefined();
  });

  it('threads replyTo into SES ReplyToAddresses (contact-form lead reply-to)', async () => {
    const f = fakeFetch();
    const p = new AmazonSesEmailProvider(goodEnv, { fetchImpl: f, now: fixedNow });
    await p.sendTransactional({ ...send, replyTo: 'lead@business.com' });
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.ReplyToAddresses).toEqual(['lead@business.com']);
  });

  it('maps custom headers into SES Content.Simple.Headers (List-Unsubscribe one-click)', async () => {
    const f = fakeFetch();
    const p = new AmazonSesEmailProvider(goodEnv, { fetchImpl: f, now: fixedNow });
    await p.sendTransactional({
      ...send,
      headers: {
        'List-Unsubscribe': '<https://projectsites.dev/u?t=abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.Content.Simple.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://projectsites.dev/u?t=abc>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('omits Content.Simple.Headers entirely when no custom headers are passed', async () => {
    const f = fakeFetch();
    const p = new AmazonSesEmailProvider(goodEnv, { fetchImpl: f, now: fixedNow });
    await p.sendTransactional(send);
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.Content.Simple.Headers).toBeUndefined();
  });

  it('throws on non-2xx with the SES error body', async () => {
    const p = new AmazonSesEmailProvider(goodEnv, {
      fetchImpl: fakeFetch(422, { message: 'bad' }),
      now: fixedNow,
    });
    await expect(p.sendTransactional(send)).rejects.toThrow(/SES send failed \(422\)/);
  });

  it('throws a clear config error when credentials are missing', async () => {
    const p = new AmazonSesEmailProvider(
      { ...goodEnv, AWS_SECRET_ACCESS_KEY: undefined },
      { fetchImpl: fakeFetch(), now: fixedNow },
    );
    await expect(p.sendTransactional(send)).rejects.toThrow(/SES not configured/);
  });

  it('validates recipient/subject/html before signing or sending', async () => {
    const f = fakeFetch();
    const p = new AmazonSesEmailProvider(goodEnv, { fetchImpl: f, now: fixedNow });
    await expect(p.sendTransactional({ ...send, to: 'nope' })).rejects.toBeInstanceOf(
      EmailInputError,
    );
    expect(f.calls).toHaveLength(0);
  });

  it('binds the fallback global fetch to globalThis (no Workers "Illegal invocation")', async () => {
    // The prod fallback is `deps.fetchImpl ?? fetch`. Assigning the BARE global fetch to
    // an instance field and calling it as `this.fetchImpl(...)` invokes fetch with
    // `this === the provider instance` → the Workers runtime throws
    // "Illegal invocation: function called with incorrect `this` reference", so EVERY
    // real SES send (magic-link login, etc.) failed. Binding it to globalThis fixes it.
    let capturedThis: unknown = 'unset';
    const spy = function (this: unknown) {
      capturedThis = this;
      return Promise.resolve(new Response(JSON.stringify({ MessageId: 'ok' }), { status: 200 }));
    };
    const orig = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const p = new AmazonSesEmailProvider(goodEnv, { now: fixedNow }); // NO fetchImpl → global fallback
      await p.sendTransactional(send);
      // The call-site receiver must NOT be the provider instance (native fetch rejects that).
      expect(capturedThis).not.toBe(p);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
