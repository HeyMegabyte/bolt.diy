import { isSuperAdmin, SYS_ADMIN_EMAILS } from '../services/sysadmin';

/**
 * Server-side super-admin check. D1-stub pattern (no module mock): a fake
 * D1Database returns one `{results}` per `.all()`, and the REAL dbQueryOne reads
 * it. The helper is fail-closed (DB error / no row → false).
 */
function makeDb(row: Record<string, unknown> | null | Error) {
  const stmt = {
    bind: () => stmt,
    all: async () => {
      if (row instanceof Error) throw row;
      return { results: row ? [row] : [] };
    },
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

const env = (row: Record<string, unknown> | null | Error) =>
  ({ DB: makeDb(row) }) as unknown as { DB: D1Database };

describe('isSuperAdmin', () => {
  it('returns false for an empty userId without querying', async () => {
    expect(await isSuperAdmin(env(null), '')).toBe(false);
  });

  it('returns false when the user row is not found', async () => {
    expect(await isSuperAdmin(env(null), 'u-missing')).toBe(false);
  });

  it('returns true when is_super_admin column is set', async () => {
    expect(await isSuperAdmin(env({ is_super_admin: 1, email: 'someone@else.com' }), 'u1')).toBe(
      true,
    );
  });

  it('returns true when the email is on the operator allowlist', async () => {
    expect(
      await isSuperAdmin(env({ is_super_admin: 0, email: 'brian@megabyte.space' }), 'u1'),
    ).toBe(true);
  });

  it('is case- and whitespace-insensitive on the allowlist email', async () => {
    expect(
      await isSuperAdmin(env({ is_super_admin: 0, email: '  HEY@Megabyte.Space  ' }), 'u1'),
    ).toBe(true);
  });

  it('returns false for a normal authed user (no column, off-list email)', async () => {
    expect(await isSuperAdmin(env({ is_super_admin: 0, email: 'owner@acme.com' }), 'u1')).toBe(
      false,
    );
  });

  it('fails closed (false) on a DB error', async () => {
    expect(await isSuperAdmin(env(new Error('D1 down')), 'u1')).toBe(false);
  });

  it('exposes the operator allowlist as lowercase', () => {
    expect(SYS_ADMIN_EMAILS).toContain('brian@megabyte.space');
    expect(SYS_ADMIN_EMAILS.every((e) => e === e.toLowerCase())).toBe(true);
  });
});
