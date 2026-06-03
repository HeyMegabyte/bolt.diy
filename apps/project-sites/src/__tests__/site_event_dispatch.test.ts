import { handleSiteEvent, type SiteEventDeps } from '../services/site_event_dispatch';

/**
 * Guards the shared site-event dispatch keystone (#10 + #11): both arms run
 * concurrently, and a failure in one arm is isolated (the other arm's result is
 * preserved as a real outcome, the failed arm becomes { error }).
 */
const EVENT = { type: 'form.submitted', payload: { formId: 'f1' } };
const WH = { delivered: 1, failed: 0, skipped: 0, attempts: 1 };
const AUTO = { matchedRecipes: 1, firedActions: 2, failedActions: 0, skippedUnknownActions: 0 };

describe('handleSiteEvent', () => {
  it('runs both arms and returns both outcomes', async () => {
    const dispatchWebhooks = jest.fn().mockResolvedValue(WH);
    const runAutomations = jest.fn().mockResolvedValue(AUTO);
    const out = await handleSiteEvent({ dispatchWebhooks, runAutomations } as unknown as SiteEventDeps, EVENT);

    expect(out).toEqual({ webhooks: WH, automations: AUTO });
    expect(dispatchWebhooks).toHaveBeenCalledWith(EVENT);
    expect(runAutomations).toHaveBeenCalledWith(EVENT);
  });

  it('isolates a webhook-arm failure — automations still return', async () => {
    const deps = {
      dispatchWebhooks: jest.fn().mockRejectedValue(new Error('D1 down loading endpoints')),
      runAutomations: jest.fn().mockResolvedValue(AUTO),
    } as unknown as SiteEventDeps;
    const out = await handleSiteEvent(deps, EVENT);

    expect(out.automations).toEqual(AUTO);
    expect(out.webhooks).toEqual({ error: 'D1 down loading endpoints' });
  });

  it('isolates an automations-arm failure — webhooks still return', async () => {
    const deps = {
      dispatchWebhooks: jest.fn().mockResolvedValue(WH),
      runAutomations: jest.fn().mockRejectedValue(new Error('recipe load failed')),
    } as unknown as SiteEventDeps;
    const out = await handleSiteEvent(deps, EVENT);

    expect(out.webhooks).toEqual(WH);
    expect(out.automations).toEqual({ error: 'recipe load failed' });
  });

  it('reports both errors when both arms fail (non-Error reason → arm_failed)', async () => {
    const deps = {
      dispatchWebhooks: jest.fn().mockRejectedValue('boom'),
      runAutomations: jest.fn().mockRejectedValue(new Error('nope')),
    } as unknown as SiteEventDeps;
    const out = await handleSiteEvent(deps, EVENT);

    expect(out.webhooks).toEqual({ error: 'arm_failed' });
    expect(out.automations).toEqual({ error: 'nope' });
  });

  it('runs the arms concurrently (does not await the first before starting the second)', async () => {
    const order: string[] = [];
    const deps = {
      dispatchWebhooks: jest.fn().mockImplementation(async () => { order.push('wh-start'); await Promise.resolve(); order.push('wh-end'); return WH; }),
      runAutomations: jest.fn().mockImplementation(async () => { order.push('auto-start'); return AUTO; }),
    } as unknown as SiteEventDeps;
    await handleSiteEvent(deps, EVENT);
    // Both start before either fully resolves → concurrent, not serial.
    expect(order.slice(0, 2)).toEqual(['wh-start', 'auto-start']);
  });
});
