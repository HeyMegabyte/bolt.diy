import {
  validateRecipe,
  recipeMatchesEvent,
  MAX_RECIPE_ACTIONS,
  type AutomationRecipe,
} from '../services/automation_builder.js';

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
