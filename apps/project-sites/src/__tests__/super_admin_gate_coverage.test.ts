/**
 * Structural detector locking the super-admin privesc-prevention property.
 *
 * `requireSuperAdmin` is mounted as a WILDCARD middleware on `/api/super-admin/*`
 * (super_admin.ts). That gate only covers routes whose path starts with that
 * prefix. The existing gate tests loop a HARDCODED `ROUTES` list, so a future
 * route added on the WRONG prefix (or simply forgotten from the list) would ship
 * ungated — a silent privilege-escalation hole. This reads the ACTUAL Hono router
 * and fails the build if any registered route falls outside the gated prefix, so
 * the property can't drift no matter what routes are added later.
 */
import { superAdmin } from '../routes/super_admin.js';

const GATE_PREFIX = '/api/super-admin/';

describe('super-admin gate coverage (structural — drift-proof)', () => {
  it('registers the requireSuperAdmin wildcard middleware on /api/super-admin/*', () => {
    const hasGate = superAdmin.routes.some((r) => r.path === '/api/super-admin/*');
    expect(hasGate).toBe(true);
  });

  it('every registered route lives under the gated prefix (no ungated privesc route)', () => {
    const offenders = superAdmin.routes
      .filter((r) => r.path !== '/api/super-admin/*') // the gate middleware itself
      .filter((r) => !r.path.startsWith(GATE_PREFIX))
      .map((r) => `${r.method} ${r.path}`);
    // A non-empty list means a route bypasses requireSuperAdmin — fix the path.
    expect(offenders).toEqual([]);
  });
});
