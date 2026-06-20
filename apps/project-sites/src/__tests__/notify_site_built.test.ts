import { notifyOwnerSiteBuilt } from '../services/notify_site_built';

/**
 * Golden-path "customer notified" for the embedded-bolt publish path. Resolves
 * the org owner email + sends the "your site is live" notification, fail-soft.
 */
const env = { DB: {} } as never;

describe('notifyOwnerSiteBuilt', () => {
  it('emails the resolved owner with the site facts (slug → URL)', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const resolveEmail = jest.fn().mockResolvedValue('owner@acme.com');
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'org-1', slug: 'acme', version: 'v1', businessName: 'Acme Roofing' },
      { resolveEmail, notify },
    );
    expect(r.notified).toBe(true);
    expect(resolveEmail).toHaveBeenCalledWith(env, 'org-1');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toEqual({
      email: 'owner@acme.com',
      siteName: 'Acme Roofing',
      slug: 'acme',
      siteUrl: 'https://acme.projectsites.dev',
      version: 'v1',
    });
  });

  it('falls back to the slug as the display name when businessName is absent', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', slug: 'vitos', version: 'v2' },
      { resolveEmail: async () => 'o@x.com', notify },
    );
    expect(notify.mock.calls[0][1].siteName).toBe('vitos');
  });

  it('skips (notified:false) when the org has no owner email', async () => {
    const notify = jest.fn();
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', slug: 's', version: 'v' },
      { resolveEmail: async () => null, notify },
    );
    expect(r.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('is fail-soft when the email resolver throws', async () => {
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', slug: 's', version: 'v' },
      {
        resolveEmail: async () => {
          throw new Error('d1 down');
        },
        notify: jest.fn(),
      },
    );
    expect(r.notified).toBe(false);
  });

  it('is fail-soft when the send throws (never blocks the publish)', async () => {
    const r = await notifyOwnerSiteBuilt(
      env,
      { orgId: 'o', slug: 's', version: 'v' },
      {
        resolveEmail: async () => 'o@x.com',
        notify: jest.fn().mockRejectedValue(new Error('email down')),
      },
    );
    expect(r.notified).toBe(false);
  });
});
