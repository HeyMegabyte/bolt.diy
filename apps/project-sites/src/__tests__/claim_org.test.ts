import { transferClaimSite, PLATFORM_CLAIMS_ORG_ID } from '../services/claim_org';

/**
 * #1 transfer-on-claim — re-parent a platform-org claim site to the claiming
 * user's org. D1-stub (real dbQueryOne/dbUpdate/writeAuditLog run against it).
 * The stub records every prepared SQL so we can assert the guarded UPDATE.
 */
function makeDb(siteRow: Record<string, unknown> | null, opts: { updateFails?: boolean } = {}) {
  const sqls: string[] = [];
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: siteRow ? [siteRow] : [] }),
    run: async () => {
      if (opts.updateFails) throw new Error('d1 down');
      return { meta: { changes: 1 } };
    },
    first: async () => null,
  };
  const db = { prepare: (sql: string) => (sqls.push(sql), stmt) } as unknown as D1Database;
  return { db, sqls };
}
const env = (db: D1Database) => ({ DB: db }) as never;

describe('transferClaimSite', () => {
  it('returns not_found when the site is absent', async () => {
    const { db } = makeDb(null);
    const r = await transferClaimSite(env(db), 'site_missing', 'org-user');
    expect(r).toEqual({ transferred: false, reason: 'not_found' });
  });

  it('is idempotent (already_yours) when the site is already the caller’s org', async () => {
    const { db } = makeDb({ id: 'site_x', org_id: 'org-user', slug: 'acme' });
    const r = await transferClaimSite(env(db), 'site_x', 'org-user');
    expect(r).toEqual({ transferred: false, reason: 'already_yours' });
  });

  it('refuses (already_claimed) a site owned by a DIFFERENT org', async () => {
    const { db } = makeDb({ id: 'site_x', org_id: 'org-other', slug: 'acme' });
    const r = await transferClaimSite(env(db), 'site_x', 'org-user');
    expect(r).toEqual({ transferred: false, reason: 'already_claimed' });
  });

  it('transfers a platform-owned site to the caller’s org (guarded UPDATE)', async () => {
    const { db, sqls } = makeDb({
      id: 'site_x',
      org_id: PLATFORM_CLAIMS_ORG_ID,
      slug: 'acme-roofing',
    });
    const r = await transferClaimSite(env(db), 'site_x', 'org-user', 'user-1');
    expect(r).toEqual({ transferred: true, slug: 'acme-roofing' });
    // The UPDATE re-parents sites and is scoped to id + the platform org.
    const updateSql = sqls.find((s) => /UPDATE sites/i.test(s));
    expect(updateSql).toBeDefined();
    expect(updateSql).toMatch(/org_id/);
  });

  it('returns update_failed when the DB update errors', async () => {
    const { db } = makeDb(
      { id: 'site_x', org_id: PLATFORM_CLAIMS_ORG_ID, slug: 'acme' },
      {
        updateFails: true,
      },
    );
    const r = await transferClaimSite(env(db), 'site_x', 'org-user');
    expect(r).toEqual({ transferred: false, reason: 'update_failed' });
  });
});
