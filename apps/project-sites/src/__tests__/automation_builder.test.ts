import {
  validateRecipe,
  recipeMatchesEvent,
  createRecipe,
  listRecipes,
  deleteRecipe,
  MAX_RECIPE_ACTIONS,
  type AutomationRecipe,
} from '../services/automation_builder.js';
import type { Env } from '../types/env.js';

/** Mock D1: .all()→{results} for SELECT; .run()→{meta.changes} for INSERT/UPDATE; captures bind args. */
function mockEnv(rows: Record<string, unknown>[], changes: number, captured: unknown[][] = []): Env {
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: rows }),
          run: async () => {
            captured.push(args);
            return { meta: { changes } };
          },
        }),
      }),
    },
  } as unknown as Env;
}

const valid: AutomationRecipe = {
  name: 'Email on new lead',
  enabled: true,
  trigger: { type: 'form.submitted' },
  actions: [{ type: 'send_email', config: { to: 'owner@example.com' } }],
};

describe('validateRecipe', () => {
  it('accepts a well-formed recipe', () => {
    expect(validateRecipe(valid)).toEqual({ ok: true, errors: [] });
  });

  it('rejects an unknown trigger', () => {
    const r = validateRecipe({ ...valid, trigger: { type: 'not.a.trigger' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Unknown trigger'))).toBe(true);
  });

  it('rejects an unknown action', () => {
    const r = validateRecipe({ ...valid, actions: [{ type: 'launch_missiles' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Unknown action'))).toBe(true);
  });

  it('requires a name and at least one action', () => {
    expect(validateRecipe({ ...valid, name: '   ' }).ok).toBe(false);
    expect(validateRecipe({ ...valid, actions: [] }).ok).toBe(false);
  });

  it('caps the number of actions', () => {
    const many = Array.from({ length: MAX_RECIPE_ACTIONS + 1 }, () => ({ type: 'notify' as const }));
    const r = validateRecipe({ ...valid, actions: many });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Too many actions'))).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const r = validateRecipe({ name: '', enabled: true, trigger: { type: 'x' }, actions: [] });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('recipeMatchesEvent', () => {
  it('matches on type with no filter', () => {
    expect(recipeMatchesEvent(valid, { type: 'form.submitted', payload: {} })).toBe(true);
  });

  it('does not match a disabled recipe', () => {
    expect(recipeMatchesEvent({ ...valid, enabled: false }, { type: 'form.submitted', payload: {} })).toBe(false);
  });

  it('does not match a different event type', () => {
    expect(recipeMatchesEvent(valid, { type: 'site.published', payload: {} })).toBe(false);
  });

  it('matches only when every filter key equals the payload', () => {
    const filtered: AutomationRecipe = { ...valid, trigger: { type: 'form.submitted', filter: { formId: 'contact' } } };
    expect(recipeMatchesEvent(filtered, { type: 'form.submitted', payload: { formId: 'contact' } })).toBe(true);
    expect(recipeMatchesEvent(filtered, { type: 'form.submitted', payload: { formId: 'newsletter' } })).toBe(false);
    expect(recipeMatchesEvent(filtered, { type: 'form.submitted', payload: {} })).toBe(false); // missing key
  });
});

describe('createRecipe', () => {
  it('validates then inserts a valid recipe', async () => {
    const captured: unknown[][] = [];
    const env = mockEnv([], 1, captured);
    const res = await createRecipe(env, 'o1', 's1', valid);
    expect(res.ok).toBe(true);
    expect(typeof res.id).toBe('string');
    // bind: [id, site_id, org_id, name, enabled, trigger_type, trigger_filter, actions]
    expect(captured[0]?.[1]).toBe('s1');
    expect(captured[0]?.[2]).toBe('o1');
    expect(captured[0]?.[5]).toBe('form.submitted');
    expect(JSON.parse(captured[0]?.[7] as string)).toEqual(valid.actions);
  });

  it('rejects an invalid recipe without inserting', async () => {
    const captured: unknown[][] = [];
    const res = await createRecipe(mockEnv([], 1, captured), 'o1', 's1', { ...valid, trigger: { type: 'bad' } });
    expect(res.ok).toBe(false);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(captured.length).toBe(0); // no INSERT
  });
});

describe('listRecipes', () => {
  it('parses JSON columns back into recipe objects', async () => {
    const env = mockEnv(
      [{ id: 'r1', name: 'X', enabled: 1, trigger_type: 'form.submitted', trigger_filter: '{"formId":"contact"}', actions: '[{"type":"send_email"}]' }],
      0,
    );
    const list = await listRecipes(env, 'o1', 's1');
    expect(list.length).toBe(1);
    expect(list[0]?.enabled).toBe(true);
    expect(list[0]?.trigger.filter).toEqual({ formId: 'contact' });
    expect(list[0]?.actions).toEqual([{ type: 'send_email' }]);
  });
});

describe('deleteRecipe', () => {
  it('reports ok when a row was soft-deleted', async () => {
    expect(await deleteRecipe(mockEnv([], 1), 'o1', 's1', 'r1')).toEqual({ ok: true });
  });
  it('reports not-ok when nothing matched', async () => {
    expect(await deleteRecipe(mockEnv([], 0), 'o1', 's1', 'missing')).toEqual({ ok: false });
  });
});
