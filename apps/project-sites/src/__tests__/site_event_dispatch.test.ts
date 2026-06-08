import { handleSiteEvent, type SiteEventDeps } from '../services/site_event_dispatch';

/**
 * Guards the shared site-event dispatch keystone (#10 Outbound Webhooks). The
 * automation-recipes arm (#11) was removed 2026-06-08; this now fans out to the
 * webhook arm only, still with per-arm failure isolation (a rejected arm becomes
 * { error } rather than throwing).
 */
const EVENT = { type: 'form.submitted', payload: { formId: 'f1' } };
const WH = { delivered: 1, failed: 0, skipped: 0, attempts: 1 };

describe('handleSiteEvent', () => {
  it('runs the webhook arm and returns its outcome', async () => {
    const dispatchWebhooks = jest.fn().mockResolvedValue(WH);
    const out = await handleSiteEvent({ dispatchWebhooks } as unknown as SiteEventDeps, EVENT);

    expect(out).toEqual({ webhooks: WH });
    expect(dispatchWebhooks).toHaveBeenCalledWith(EVENT);
  });

  it('isolates a webhook-arm failure as { error } (Error reason → message)', async () => {
    const deps = {
      dispatchWebhooks: jest.fn().mockRejectedValue(new Error('D1 down loading endpoints')),
    } as unknown as SiteEventDeps;
    const out = await handleSiteEvent(deps, EVENT);

    expect(out.webhooks).toEqual({ error: 'D1 down loading endpoints' });
  });

  it('maps a non-Error rejection reason to arm_failed', async () => {
    const deps = {
      dispatchWebhooks: jest.fn().mockRejectedValue('boom'),
    } as unknown as SiteEventDeps;
    const out = await handleSiteEvent(deps, EVENT);

    expect(out.webhooks).toEqual({ error: 'arm_failed' });
  });
});
