import { buildClaimEmail, sendClaimBuildEmail } from '../services/claim_build_emails';

/**
 * #1 claimyour.site §2 — "email the user when the build starts / finishes".
 * Pure content builders (subject/html/text) + a DI'd sender (never throws). The
 * copy is brand-voiced and slop-free (copy-writing rule).
 */
const BANNED = ['seamless', 'leverage', 'world-class', 'cutting-edge', 'unleash', 'revolutionize'];

function assertClean(...parts: string[]) {
  const blob = parts.join(' ').toLowerCase();
  for (const w of BANNED) expect(blob).not.toContain(w);
}

describe('buildClaimEmail', () => {
  it('started: announces the background build + survives-page-leave reassurance', () => {
    const e = buildClaimEmail('started', {
      businessName: 'Acme Roofing',
      createUrl: 'https://projectsites.dev/create?claim=abc',
    });
    expect(e.subject.toLowerCase()).toContain('building');
    expect(e.html).toContain('Acme Roofing');
    expect(e.text).toContain('Acme Roofing');
    expect(e.html).toContain('https://projectsites.dev/create?claim=abc');
    assertClean(e.subject, e.html, e.text);
  });

  it('finished: includes the preview link + a clear CTA', () => {
    const e = buildClaimEmail('finished', {
      businessName: 'Acme',
      previewUrl: 'https://acme.projectsites.dev',
    });
    expect(e.subject.toLowerCase()).toContain('ready');
    expect(e.html).toContain('https://acme.projectsites.dev');
    assertClean(e.subject, e.html, e.text);
  });

  it('failed: states the snag + a recovery path, never a dead end', () => {
    const e = buildClaimEmail('failed', {
      businessName: 'Acme',
      error: 'render timeout',
      createUrl: 'https://projectsites.dev/create?claim=abc',
    });
    expect(e.subject.toLowerCase()).toMatch(/snag|trouble|problem/);
    expect(e.html.toLowerCase()).toMatch(/try again|we'?re on it|retry/);
    assertClean(e.subject, e.html, e.text);
  });

  it('escapes HTML in the business name (no markup injection in the email body)', () => {
    const e = buildClaimEmail('started', {
      businessName: '<script>x</script>',
      createUrl: 'https://x',
    });
    expect(e.html).not.toContain('<script>x</script>');
    expect(e.html).toContain('&lt;script&gt;');
  });
});

describe('sendClaimBuildEmail', () => {
  it('sends the built content via the injected sender + returns ok', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const r = await sendClaimBuildEmail(
      'finished',
      'owner@biz.com',
      { businessName: 'Acme', previewUrl: 'https://acme.projectsites.dev' },
      { send },
    );
    expect(r.ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@biz.com', subject: expect.stringMatching(/ready/i) }),
    );
  });

  it('never throws — a sender failure maps to ok:false', async () => {
    const send = jest.fn().mockRejectedValue(new Error('resend down'));
    const r = await sendClaimBuildEmail(
      'started',
      'owner@biz.com',
      { businessName: 'Acme', createUrl: 'https://x' },
      { send },
    );
    expect(r.ok).toBe(false);
  });
});
