/**
 * @module libs/features/api_keys/handlers
 *
 * @description
 * Hono routes for **org-scoped programmatic API keys** (`psk_live_*`) — the
 * projectsites.dev REST API tokens a business owner mints from the admin. Only
 * the SHA-256 hash + a 16-char prefix are persisted (the `api_keys` D1 table);
 * the full secret is shown to the user EXACTLY once at creation. Bearer-auth
 * callers present either a session token (existing) or one of these keys. Every
 * route requires both an `orgId` and a `userId` on the request context — the
 * {@link need} helper throws `HTTPError(401)` when either is missing.
 *
 * | Method | Path                        | Auth         | Purpose                                              |
 * | ------ | --------------------------- | ------------ | --------------------------------------------------- |
 * | GET    | /api/admin/api-keys         | orgId+userId | List org API keys (no secret bodies)                |
 * | POST   | /api/admin/api-keys         | orgId+userId | Mint a new org API key — returns `psk_live_…` ONCE  |
 * | DELETE | /api/admin/api-keys/:id      | orgId+userId | Revoke an org API key (`revoked_at = now()`)        |
 *
 * The keystore is the D1 `api_keys` table accessed directly (parameterized SQL
 * via `c.env.DB`) — there is NO separate `api_keys`/`api_tokens` SERVICE behind
 * these routes; the local {@link hashApiKey} helper (SHA-256 over the raw secret,
 * hex-encoded) is the only crypto dependency and it moved here VERBATIM with the
 * routes (it was a module-private helper used by no other `ai_admin.ts` route).
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 19) — only the route-registration receiver changed (`aiAdmin.` →
 * `apiKeys.`); the handler bodies + `hashApiKey` are byte-for-byte unchanged. The
 * module imports its error/auth scaffolding (the `need(c)` helper and a
 * byte-identical `onError`) from the SHARED `src/lib/ai_admin_kit.ts` kit — no
 * local copies — so behavior is identical: it contains ONLY these ai_admin-sourced
 * routes, so exact reproduction = byte-identical behavior. Bodies are read via a
 * raw `as {…}` cast + `.catch(() => ({}))` rather than a Zod schema at the
 * boundary (matching the original), so there is no `schemas.ts` — the moved
 * handlers keep their original in-body validation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, safeJson, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const apiKeys = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · safeJson · onError) is shared via
// src/lib/ai_admin_kit.ts — imported above (route-decomposition installment 19).
// Byte-identical behavior to the ai_admin.ts inline copies; see the kit module
// doc for the siteOwned-vs-requireOwnedSite rationale.
apiKeys.onError(aiAdminOnError);

/* ────────────────────────── Org API keys (psk_…) ────────────────────────── */
// Org-scoped programmatic keys for the projectsites.dev REST API. Hash + 8-char
// prefix are stored; the full secret is shown to the user EXACTLY once at
// creation. Pattern: psk_live_<48 url-safe chars>. Bearer-auth callers can
// present either a session token (existing) or one of these keys.
async function hashApiKey(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * `GET /api/admin/api-keys` — List org-scoped API keys (`psk_live_*`,
 * `psk_test_*`) without secret bodies.
 *
 * @remarks
 * Returns name, prefix, created_by, last_used_at, revoked_at. The raw
 * secret is only ever returned once at creation time.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
apiKeys.get('/api/admin/api-keys', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, prefix, scopes_json, last_used_at, expires_at, created_at, revoked_at
     FROM api_keys WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(orgId)
    .all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      scopes: r['scopes_json'] ? safeJson(r['scopes_json'] as string) : [],
      active:
        !r['revoked_at'] &&
        (!r['expires_at'] || new Date(r['expires_at'] as string).getTime() > Date.now()),
    })),
  });
});

/**
 * `POST /api/admin/api-keys` — Mint a new org-scoped API key.
 *
 * @remarks
 * Body: `{ name, expires_at? }`. Returns `{ key: 'psk_live_…' }` exactly
 * once — the raw secret is only ever stored as SHA-256 in D1. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when name is missing.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
apiKeys.post('/api/admin/api-keys', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    expires_in_days?: number;
  };
  const name = (body.name ?? '').trim() || 'untitled key';
  // 48 url-safe chars of entropy = ~288 bits.
  const random = Array.from(crypto.getRandomValues(new Uint8Array(36)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 48);
  const secret = `psk_live_${random}`;
  const prefix = secret.slice(0, 16); // "psk_live_AbCdEfGh"
  const hash = await hashApiKey(secret);
  const id = crypto.randomUUID();
  const expiresAt = body.expires_in_days
    ? new Date(
        Date.now() + Math.max(1, Math.min(365, body.expires_in_days)) * 86400 * 1000,
      ).toISOString()
    : null;
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, org_id, created_by, name, prefix, hash, scopes_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      userId,
      name,
      prefix,
      hash,
      JSON.stringify(body.scopes ?? ['read', 'write']),
      expiresAt,
    )
    .run();
  return c.json(
    {
      data: {
        id,
        name,
        prefix,
        secret, // returned ONCE — never again.
        expires_at: expiresAt,
        scopes: body.scopes ?? ['read', 'write'],
        note: 'Copy this secret now — it cannot be shown again. Send as `Authorization: Bearer <secret>`.',
      },
    },
    201,
  );
});

/**
 * `DELETE /api/admin/api-keys/:id` — Revoke an org-scoped API key.
 *
 * @remarks
 * Sets `revoked_at = now()`; subsequent requests with that key fail auth.
 * Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the key id doesn't belong to the caller's org.
 */
apiKeys.delete('/api/admin/api-keys/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
  )
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { revoked: true } });
});
