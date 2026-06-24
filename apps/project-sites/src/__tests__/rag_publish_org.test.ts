/**
 * Regression: `/api/publish/bolt` used to index every site under the literal
 * `orgId: 'bolt'`, which made bolt-published sites permanently unsearchable via
 * the org-scoped `/api/sites/:id/search` endpoint (semanticSearch filters
 * `metadata.orgId === authenticatedOrg`). `resolvePublishOrgId` now resolves the
 * real owning org.
 */
import { resolvePublishOrgId } from '../services/rag_publish.js';
import type { Env } from '../types/env.js';

function makeEnv(ownerOrgId: string | null): { env: Env; first: jest.Mock } {
  const first = jest.fn().mockResolvedValue(ownerOrgId ? { org_id: ownerOrgId } : null);
  const bind = jest.fn(() => ({ first }));
  const prepare = jest.fn(() => ({ bind }));
  return { env: { DB: { prepare } } as unknown as Env, first };
}

describe('resolvePublishOrgId', () => {
  it('prefers the authenticated session org and skips the D1 lookup', async () => {
    const { env, first } = makeEnv('org_db');
    const result = await resolvePublishOrgId(env, 'acme-bakery', 'org_session');
    expect(result).toBe('org_session');
    expect(first).not.toHaveBeenCalled();
  });

  it("ignores the 'bolt' placeholder session org and falls through to the site row", async () => {
    const { env } = makeEnv('org_owner');
    const result = await resolvePublishOrgId(env, 'acme-bakery', 'bolt');
    expect(result).toBe('org_owner');
  });

  it('resolves the org from the site row by slug when there is no session org', async () => {
    const { env, first } = makeEnv('org_from_slug');
    const result = await resolvePublishOrgId(env, 'acme-bakery', undefined);
    expect(result).toBe('org_from_slug');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'bolt' for a brand-new slug with no owner row", async () => {
    const { env } = makeEnv(null);
    const result = await resolvePublishOrgId(env, 'brand-new-slug', undefined);
    expect(result).toBe('bolt');
  });

  it("returns 'bolt' when the D1 lookup throws (never blocks publish)", async () => {
    const first = jest.fn().mockRejectedValue(new Error('d1 down'));
    const bind = jest.fn(() => ({ first }));
    const prepare = jest.fn(() => ({ bind }));
    const env = { DB: { prepare } } as unknown as Env;
    const result = await resolvePublishOrgId(env, 'acme-bakery', undefined);
    expect(result).toBe('bolt');
  });
});
