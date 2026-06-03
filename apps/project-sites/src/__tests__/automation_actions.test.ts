import { buildRunAction, type ActionEffectDeps } from '../services/automation_actions';
import { runAutomations } from '../services/automation_dispatch';
import type { AutomationRecipe } from '../services/automation_builder';

/**
 * Guards the #11 action executor: each action type routes to its injected effect
 * with config-derived args, defaults fill optional fields, and invalid/unknown
 * actions throw (so runAutomations isolates them as failed). No real I/O.
 */
function effects(over: Partial<ActionEffectDeps> = {}): { [K in keyof ActionEffectDeps]: jest.Mock } & { deps: ActionEffectDeps } {
  const mocks = {
    sendWebhook: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn().mockResolvedValue(undefined),
    addTag: jest.fn().mockResolvedValue(undefined),
    createTask: jest.fn().mockResolvedValue(undefined),
  };
  const deps = { ...mocks, ...over } as unknown as ActionEffectDeps;
  return { ...mocks, deps };
}

const EVENT = { type: 'form.submitted', payload: { formId: 'f1' } };
const SITE = 'site-1';

describe('buildRunAction', () => {
  it('routes webhook → sendWebhook(url, json body with the event)', async () => {
    const e = effects();
    await buildRunAction(e.deps, SITE)({ type: 'webhook', config: { url: 'https://x.com/h' } }, EVENT);
    expect(e.sendWebhook).toHaveBeenCalledTimes(1);
    expect(e.sendWebhook.mock.calls[0][0]).toBe('https://x.com/h');
    expect(JSON.parse(e.sendWebhook.mock.calls[0][1])).toEqual({ type: 'form.submitted', payload: { formId: 'f1' } });
  });

  it('routes send_email with explicit subject/body, and defaults when omitted', async () => {
    const e = effects();
    const run = buildRunAction(e.deps, SITE);
    await run({ type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'Body' } }, EVENT);
    expect(e.sendEmail).toHaveBeenCalledWith('a@b.com', 'Hi', 'Body');

    await run({ type: 'send_email', config: { to: 'a@b.com' } }, EVENT);
    expect(e.sendEmail.mock.calls[1][0]).toBe('a@b.com');
    expect(e.sendEmail.mock.calls[1][1]).toContain('form.submitted'); // default subject
    expect(e.sendEmail.mock.calls[1][2]).toContain('form.submitted'); // default body
  });

  it('routes notify with a default message when omitted', async () => {
    const e = effects();
    await buildRunAction(e.deps, SITE)({ type: 'notify', config: {} }, EVENT);
    expect(e.notify).toHaveBeenCalledWith(SITE, 'Event: form.submitted');
  });

  it('routes add_tag → addTag(siteId, tag) and create_task → createTask(siteId, title, assignee)', async () => {
    const e = effects();
    const run = buildRunAction(e.deps, SITE);
    await run({ type: 'add_tag', config: { tag: 'vip' } }, EVENT);
    expect(e.addTag).toHaveBeenCalledWith(SITE, 'vip');
    await run({ type: 'create_task', config: { title: 'Call', assignee: 'u1' } }, EVENT);
    expect(e.createTask).toHaveBeenCalledWith(SITE, 'Call', 'u1');
  });

  it('throws on invalid config (so runAutomations isolates it as a failed action)', async () => {
    const e = effects();
    await expect(buildRunAction(e.deps, SITE)({ type: 'webhook', config: {} }, EVENT)).rejects.toThrow();
    expect(e.sendWebhook).not.toHaveBeenCalled();
  });

  it('throws on an unknown action type', async () => {
    const e = effects();
    await expect(buildRunAction(e.deps, SITE)({ type: 'launch_missiles', config: {} }, EVENT)).rejects.toThrow();
  });

  it('integrates with runAutomations: one bad action is isolated, the rest fire', async () => {
    const e = effects();
    const recipe: AutomationRecipe = {
      name: 'r',
      enabled: true,
      trigger: { type: 'form.submitted' },
      actions: [
        { type: 'notify', config: { message: 'hi' } },
        { type: 'webhook', config: {} }, // invalid → throws → isolated
        { type: 'add_tag', config: { tag: 'lead' } },
      ],
    };
    const out = await runAutomations({ runAction: buildRunAction(e.deps, SITE) }, EVENT, [recipe]);
    expect(out).toEqual({ matchedRecipes: 1, firedActions: 2, failedActions: 1, skippedUnknownActions: 0 });
    expect(e.notify).toHaveBeenCalled();
    expect(e.addTag).toHaveBeenCalled();
    expect(e.sendWebhook).not.toHaveBeenCalled();
  });
});
