import { runAutomations, type AutomationRunDeps } from '../services/automation_dispatch';
import type { AutomationRecipe } from '../services/automation_builder';

/**
 * Guards the automation-recipe firing engine (#11): match gating via
 * recipeMatchesEvent, firing every action of a matching recipe, per-action error
 * isolation (one failing action never aborts the rest), and unknown-action skip.
 * runAction is injected so the orchestration is tested with zero real I/O.
 */
const recipe = (over: Partial<AutomationRecipe> = {}): AutomationRecipe => ({
  name: 'r',
  enabled: true,
  trigger: { type: 'form.submitted' },
  actions: [{ type: 'send_email' }],
  ...over,
});

function makeDeps(impl?: AutomationRunDeps['runAction']): { deps: AutomationRunDeps; runAction: jest.Mock } {
  const runAction = jest.fn(impl ?? (async () => undefined));
  return { deps: { runAction: runAction as unknown as AutomationRunDeps['runAction'] }, runAction };
}

const EVENT = { type: 'form.submitted', payload: { formId: 'f1' } };

describe('runAutomations', () => {
  it('fires every action of a matching recipe', async () => {
    const { deps, runAction } = makeDeps();
    const out = await runAutomations(deps, EVENT, [
      recipe({ actions: [{ type: 'send_email' }, { type: 'notify' }, { type: 'webhook' }] }),
    ]);
    expect(out).toEqual({ matchedRecipes: 1, firedActions: 3, failedActions: 0, skippedUnknownActions: 0 });
    expect(runAction).toHaveBeenCalledTimes(3);
  });

  it('does not fire disabled or non-matching recipes', async () => {
    const { deps, runAction } = makeDeps();
    const out = await runAutomations(deps, EVENT, [
      recipe({ enabled: false }),
      recipe({ trigger: { type: 'site.published' } }),
    ]);
    expect(out).toEqual({ matchedRecipes: 0, firedActions: 0, failedActions: 0, skippedUnknownActions: 0 });
    expect(runAction).not.toHaveBeenCalled();
  });

  it('respects an equals-filter on the trigger', async () => {
    const { deps, runAction } = makeDeps();
    const filtered = recipe({ trigger: { type: 'form.submitted', filter: { formId: 'f1' } } });
    const mismatched = recipe({ trigger: { type: 'form.submitted', filter: { formId: 'other' } } });
    const out = await runAutomations(deps, EVENT, [filtered, mismatched]);
    expect(out.matchedRecipes).toBe(1);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it('isolates a failing action — the rest of the recipe still runs', async () => {
    let n = 0;
    const { deps, runAction } = makeDeps(async () => {
      n += 1;
      if (n === 2) throw new Error('email provider down');
    });
    const out = await runAutomations(deps, EVENT, [
      recipe({ actions: [{ type: 'send_email' }, { type: 'notify' }, { type: 'add_tag' }] }),
    ]);
    expect(out).toEqual({ matchedRecipes: 1, firedActions: 2, failedActions: 1, skippedUnknownActions: 0 });
    expect(runAction).toHaveBeenCalledTimes(3); // all three attempted despite the middle failure
  });

  it('skips unknown action types (defense-in-depth) without firing them', async () => {
    const { deps, runAction } = makeDeps();
    const out = await runAutomations(deps, EVENT, [
      recipe({ actions: [{ type: 'send_email' }, { type: 'launch_missiles' }] }),
    ]);
    expect(out).toEqual({ matchedRecipes: 1, firedActions: 1, failedActions: 0, skippedUnknownActions: 1 });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it('runs across multiple recipes, only the matching ones', async () => {
    const { deps, runAction } = makeDeps();
    const out = await runAutomations(deps, EVENT, [
      recipe({ name: 'a', actions: [{ type: 'send_email' }] }),
      recipe({ name: 'b', trigger: { type: 'payment.succeeded' } }),
      recipe({ name: 'c', actions: [{ type: 'notify' }, { type: 'create_task' }] }),
    ]);
    expect(out).toEqual({ matchedRecipes: 2, firedActions: 3, failedActions: 0, skippedUnknownActions: 0 });
    expect(runAction).toHaveBeenCalledTimes(3);
  });
});
