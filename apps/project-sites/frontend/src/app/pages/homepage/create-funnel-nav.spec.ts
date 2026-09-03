import { createFunnelNav } from './create-funnel-nav';

/**
 * Deterministic coverage for the funnel-nav decision (no component/DI/Places needed).
 * Locks the WCAG 3.3.7 redundant-entry behavior — especially the signed-OUT branch that
 * used to drop the typed name at a bare /signin (fixed 2026-09-03).
 */
describe('createFunnelNav', () => {
  it('signed-in + name → /create?name=', () => {
    expect(createFunnelNav('Acme Roofing', true)).toEqual({
      path: '/create',
      queryParams: { name: 'Acme Roofing' },
    });
  });

  it('signed-in + no name → bare /create (selected real business rides setSelectedBusiness)', () => {
    expect(createFunnelNav(undefined, true)).toEqual({ path: '/create' });
  });

  it('signed-OUT + name → /signin?returnUrl=/create?name= (carries the name THROUGH sign-in)', () => {
    expect(createFunnelNav('My Shop', false)).toEqual({
      path: '/signin',
      queryParams: { returnUrl: '/create?name=My%20Shop' },
    });
  });

  it('signed-OUT + no name → bare /signin', () => {
    expect(createFunnelNav(undefined, false)).toEqual({ path: '/signin' });
  });

  it('trims surrounding whitespace before deciding + encoding', () => {
    expect(createFunnelNav('  Zephyr Atelier  ', false)).toEqual({
      path: '/signin',
      queryParams: { returnUrl: '/create?name=Zephyr%20Atelier' },
    });
    expect(createFunnelNav('   ', true)).toEqual({ path: '/create' });
  });
});
