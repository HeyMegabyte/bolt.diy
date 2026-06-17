import { verifyTurnstileToken } from '../services/turnstile';

/**
 * #6 Turnstile — server-side token verification. Forms across the app
 * (signin/create/claim/lead/newsletter) collect a `cf-turnstile-response`; this
 * is the single primitive that verifies it against Cloudflare's siteverify. The
 * fetch is injected so every branch is unit-provable, and it degrades gracefully
 * (a missing secret reports `not_configured` instead of throwing — the caller
 * decides whether to soft-allow).
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function fetchReturning(body: unknown, ok = true): jest.Mock {
  return jest.fn().mockResolvedValue({ ok, json: async () => body } as Response);
}

describe('verifyTurnstileToken', () => {
  it('reports not_configured (no network) when the secret is missing', async () => {
    const f = fetchReturning({});
    const r = await verifyTurnstileToken({ token: 'tok', secret: '', fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_configured');
    expect(f).not.toHaveBeenCalled();
  });

  it('reports missing_token (no network) when the token is absent', async () => {
    const f = fetchReturning({});
    const r = await verifyTurnstileToken({ token: null, secret: 'sk', fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_token');
    expect(f).not.toHaveBeenCalled();
  });

  it('passes for a successful verification', async () => {
    const f = fetchReturning({ success: true, action: 'signin', hostname: 'projectsites.dev' });
    const r = await verifyTurnstileToken({ token: 'tok', secret: 'sk', fetchImpl: f });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hostname).toBe('projectsites.dev');
    expect(f).toHaveBeenCalledWith(SITEVERIFY, expect.objectContaining({ method: 'POST' }));
  });

  it('sends secret + response + remoteip in the form body', async () => {
    const f = fetchReturning({ success: true });
    await verifyTurnstileToken({
      token: 'tok123',
      secret: 'sk_x',
      remoteIp: '1.2.3.4',
      fetchImpl: f,
    });
    const body = f.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('sk_x');
    expect(body.get('response')).toBe('tok123');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('fails with the error-codes on an unsuccessful verification', async () => {
    const f = fetchReturning({ success: false, 'error-codes': ['invalid-input-response'] });
    const r = await verifyTurnstileToken({ token: 'tok', secret: 'sk', fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('verification_failed');
      expect(r.errorCodes).toEqual(['invalid-input-response']);
    }
  });

  it('maps a network throw to network_error (never throws)', async () => {
    const f = jest.fn().mockRejectedValue(new Error('socket hang up'));
    const r = await verifyTurnstileToken({ token: 'tok', secret: 'sk', fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('network_error');
  });

  it('enforces an expected action when given (action_mismatch)', async () => {
    const f = fetchReturning({ success: true, action: 'signup' });
    const r = await verifyTurnstileToken({
      token: 'tok',
      secret: 'sk',
      expectedAction: 'signin',
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('action_mismatch');
  });

  it('enforces an expected hostname when given (hostname_mismatch)', async () => {
    const f = fetchReturning({ success: true, hostname: 'evil.example' });
    const r = await verifyTurnstileToken({
      token: 'tok',
      secret: 'sk',
      expectedHostname: 'projectsites.dev',
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('hostname_mismatch');
  });
});
