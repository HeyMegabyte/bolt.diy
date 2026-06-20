import { notifyOwnerSiteBuilt } from '../services/notify_site_built';

/**
 * Golden-path "customer notified" for the embedded-bolt publish path. Notifies
 * the org owner their site is live across BOTH channels — the rich email
 * (notifySiteBuilt) + the in-app Novu bell (build.finished) — each independent
 * and fail-soft so one failing never blocks the other or the publish.
 */
const env = { DB: {} } as never;

function deps(over: Partial<Parameters<typeof notifyOwnerSiteBuilt>[2]> = {}) {
  return {
    resolveEmail: jest.fn().mockResolvedValue('owner@acme.com'),
    notify: jest.fn().mockResolvedValue(undefined),
    bell: jest.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

describe('notifyOwnerSiteBuilt', () => {
  it('emails the resolved owner AND fires the build.finished bell with the preview URL', async () => {
    const d = deps();
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'org-1', siteId: 's1', slug: 'acme', version: 'v1', businessName: 'Acme Roofing' },
      d,
    );
    expect(r).toEqual({ emailed: true, belled: true });
    expect(d.notify.mock.calls[0][1]).toEqual({
      email: 'owner@acme.com',
      siteName: 'Acme Roofing',
      slug: 'acme',
      siteUrl: 'https://acme.projectsites.dev',
      version: 'v1',
    });
    expect(d.bell).toHaveBeenCalledWith(env, env.DB, {
      orgId: 'org-1',
      event: {
        event: 'build.finished',
        tenantId: 'org-1',
        siteId: 's1',
        previewUrl: 'https://acme.projectsites.dev',
      },
    });
  });

  it('falls back to the slug as the email display name when businessName is absent', async () => {
    const d = deps();
    await notifyOwnerSiteBuilt(env, { orgId: 'o', siteId: 's', slug: 'vitos', version: 'v2' }, d);
    expect(d.notify.mock.calls[0][1].siteName).toBe('vitos');
  });

  it('still fires the bell when the org has no owner email (emailed:false, belled:true)', async () => {
    const d = deps({ resolveEmail: jest.fn().mockResolvedValue(null), notify: jest.fn() });
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', siteId: 's', slug: 's', version: 'v' },
      d,
    );
    expect(r).toEqual({ emailed: false, belled: true });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('channels are independent: a bell failure leaves the email sent', async () => {
    const d = deps({ bell: jest.fn().mockRejectedValue(new Error('novu down')) });
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', siteId: 's', slug: 's', version: 'v' },
      d,
    );
    expect(r).toEqual({ emailed: true, belled: false });
  });

  it('is fail-soft when the email resolver throws (bell still fires)', async () => {
    const d = deps({ resolveEmail: jest.fn().mockRejectedValue(new Error('d1 down')) });
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', siteId: 's', slug: 's', version: 'v' },
      d,
    );
    expect(r).toEqual({ emailed: false, belled: true });
  });

  it('treats a bell ok:false as not belled', async () => {
    const d = deps({ bell: jest.fn().mockResolvedValue({ ok: false, detail: 'invalid_event' }) });
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', siteId: 's', slug: 's', version: 'v' },
      d,
    );
    expect(r.belled).toBe(false);
  });
});
