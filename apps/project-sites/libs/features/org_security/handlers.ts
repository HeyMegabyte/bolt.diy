/**
 * @module libs/features/org_security/handlers
 *
 * @description
 * Hono routes for the caller org's **security settings** — the session TTL,
 * idle timeout, sign-in domain allowlist, and 2FA-required toggle persisted in
 * the `org_security` D1 table (one row per org, upserted). Backs the admin
 * **Settings → Security** view. Both routes require an `orgId` on the request
 * context — the {@link need} helper throws `HTTPError(401)` when it is missing.
 *
 * | Method | Path                  | Auth  | Purpose                                              |
 * | ------ | --------------------- | ----- | --------------------------------------------------- |
 * | GET    | /api/admin/security   | orgId | Read the org's security settings (defaults if none) |
 * | PUT    | /api/admin/security   | orgId | Upsert the org's security settings (clamped ranges) |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 20) — only the route-registration receiver changed (`aiAdmin.` →
 * `orgSecurity.`); the handler bodies are byte-for-byte unchanged. Error/auth
 * scaffolding (the `need(c)` helper + a byte-identical `onError`) is imported
 * from the SHARED `src/lib/ai_admin_kit.ts` kit — no local copies. Neither
 * route validates a typed body against a schema (the PUT clamps raw numbers
 * inline exactly as the original did), so there is no `schemas.ts`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const orgSecurity = new Hono<AppContext>();

// Error/auth scaffolding (need · onError) is shared via src/lib/ai_admin_kit.ts —
// imported above (route-decomposition installment 20, extracted from ai_admin.ts).
// Byte-identical behavior to the prior inline copies.
orgSecurity.onError(aiAdminOnError);

/**
 * `GET /api/admin/security` — Read the caller org's security settings, or
 * safe defaults (168h session / 60m idle / no allowlist / 2FA off) when the
 * org has never saved any.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
orgSecurity.get('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT session_hours, idle_minutes, allowed_domains, require_2fa, updated_at
     FROM org_security WHERE org_id = ?`,
  )
    .bind(orgId)
    .first();
  return c.json({
    data: row ?? {
      session_hours: 168,
      idle_minutes: 60,
      allowed_domains: null,
      require_2fa: 0,
      updated_at: null,
    },
  });
});
/**
 * `PUT /api/admin/security` — Update the caller org's security settings
 * (SSO enforcement, IP allowlist, session TTL).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the caller isn't an org admin.
 */
orgSecurity.put('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    session_hours?: number;
    idle_minutes?: number;
    allowed_domains?: string | null;
    require_2fa?: boolean;
  };
  const sessionHours = Math.max(1, Math.min(720, Number(body.session_hours) || 168));
  const idleMinutes = Math.max(5, Math.min(240, Number(body.idle_minutes) || 60));
  const allowed = (body.allowed_domains ?? '').trim() || null;
  const require2fa = body.require_2fa ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO org_security (org_id, session_hours, idle_minutes, allowed_domains, require_2fa, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       session_hours = excluded.session_hours,
       idle_minutes = excluded.idle_minutes,
       allowed_domains = excluded.allowed_domains,
       require_2fa = excluded.require_2fa,
       updated_at = excluded.updated_at`,
  )
    .bind(orgId, sessionHours, idleMinutes, allowed, require2fa)
    .run();
  return c.json({
    data: {
      saved: true,
      session_hours: sessionHours,
      idle_minutes: idleMinutes,
      allowed_domains: allowed,
      require_2fa: require2fa,
    },
  });
});
