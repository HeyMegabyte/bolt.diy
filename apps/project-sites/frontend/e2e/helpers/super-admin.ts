import type { APIRequestContext } from '@playwright/test';

/**
 * Whether the `E2E_API_KEY` session resolves to a platform super-admin (operator).
 *
 * The E2E key authenticates as `e2e-test-org` / `e2e@megabyte.space` — which is NOT
 * on the super-admin allowlist (`SYS_ADMIN_EMAILS = ['brian@megabyte.space',
 * 'hey@megabyte.space']`, worker `services/sysadmin.ts`) and whose `users.is_super_admin`
 * column is unset — so it is NOT super-admin (`/api/auth/me` → `is_super_admin:false`).
 *
 * Super-admin-only surfaces (e.g. `/admin/feature-flags`, guarded by `sysAdminGuard` in
 * `app.routes.ts`) REDIRECT this session away before the page mounts, so any spec that
 * drives such a surface must `test.skip(!superAdmin, …)` for the E2E-key session. Those
 * super-admin surfaces are instead verified by the Browserbase brian-login sweep, which
 * runs as brian@megabyte.space (a real super-admin) — the intended coverage split
 * (org-scoped surfaces → E2E-key chromium suite; super-admin surfaces → brian sweep).
 *
 * @param request - a Playwright `APIRequestContext` (the `request` fixture).
 * @returns `true` only when the E2E session's `/api/auth/me` reports `is_super_admin:true`.
 *
 * @example
 * let SUPER_ADMIN = false;
 * test.beforeAll(async ({ request }) => { SUPER_ADMIN = await isSessionSuperAdmin(request); });
 * test.beforeEach(() => test.skip(!SUPER_ADMIN, 'super-admin surface — covered by the brian sweep'));
 */
export async function isSessionSuperAdmin(request: APIRequestContext): Promise<boolean> {
  const key = process.env.E2E_API_KEY ?? '';
  if (!key) return false;
  const base = process.env.PROD_URL ?? 'https://projectsites.dev';
  try {
    // Explicit short timeout so a tarpitted probe FAILS-FAST to `false` (→ the caller
    // `test.skip`s) instead of hanging until the Playwright HOOK timeout (45s) aborts the
    // `beforeAll` externally — a hook abort `try/catch` cannot intercept, which marks EVERY
    // test in the file `failed` instead of `skipped` under concurrent CI load (the per-IP CF
    // tarpit on `/api/auth/me`). The E2E key's correct answer is always `false` (never
    // super-admin), so a fast timeout→false is always correct; super-admin surfaces are
    // covered by the Browserbase brian-login sweep regardless. See
    // memory/prod-e2e-ci-flakes-are-environmental.md (guard-hook-timeout class).
    const res = await request.get(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10_000,
    });
    if (!res.ok()) return false;
    const body = (await res.json()) as { data?: { is_super_admin?: boolean } };
    return body.data?.is_super_admin === true;
  } catch {
    return false;
  }
}
