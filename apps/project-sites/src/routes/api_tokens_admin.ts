/**
 * @module routes/api_tokens_admin
 * @description Account-level Public API token CRUD for the `/admin/api-tokens` UI.
 *
 * Lists / creates / revokes the caller-org's `psk_` tokens — the SAME tokens the
 * platform MCP (`/api/mcp`) verifies. The admin UI + the `api_tokens` service +
 * the `0515_public_api` migration all existed, but this route (which the SPA
 * calls at `/api/v1-tokens`) was never built → the section 404'd on every load.
 *
 * | Method | Path                | Body / Response                                            |
 * | ------ | ------------------- | ---------------------------------------------------------- |
 * | GET    | /api/v1-tokens      | → `{ data: ApiTokenPublic[] }` (never the hash/plaintext)  |
 * | POST   | /api/v1-tokens      | `{ name, scopes[], expires_at? }` → `{ token, plaintext, warning }` (plaintext shown ONCE) |
 * | DELETE | /api/v1-tokens/:id  | revoke → `{ ok: true }`                                    |
 *
 * Gated on the `public_api` flag (stable, on) — 404 (never 403) when off.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  VALID_SCOPES,
  type ApiScope,
} from '../services/api_tokens.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const apiTokensAdmin = new Hono<AppContext>();

const FLAG_KEY = 'public_api';

/** GET /api/v1-tokens — list the caller org's tokens (metadata only). */
apiTokensAdmin.get('/api/v1-tokens', async (c) => {
  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, FLAG_KEY, { userId: c.get('userId') ?? '', orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }
  const tokens = await listApiTokens(c.env.DB, orgId);
  return c.json({ data: tokens });
});

/** POST /api/v1-tokens — mint a token. Plaintext is returned ONCE, never stored. */
apiTokensAdmin.post('/api/v1-tokens', async (c) => {
  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, FLAG_KEY, { userId: c.get('userId') ?? '', orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    scopes?: unknown;
    expires_at?: unknown;
  };
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 120) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'A token name (1–120 characters) is required.' } },
      400,
    );
  }
  const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter(
    (s): s is ApiScope => typeof s === 'string' && (VALID_SCOPES as readonly string[]).includes(s),
  );
  if (scopes.length === 0) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Select at least one valid scope.' } },
      400,
    );
  }
  let expiresAt: string | null = null;
  if (body.expires_at != null && String(body.expires_at).trim() !== '') {
    const d = new Date(String(body.expires_at));
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Expiry must be a valid future date — leave blank for a token that never expires.',
          },
        },
        400,
      );
    }
    expiresAt = d.toISOString();
  }
  const result = await createApiToken(c.env.DB, orgId, name, scopes, c.get('userId') ?? null, expiresAt);
  return c.json(
    {
      token: result.token,
      plaintext: result.plaintext,
      warning: 'Copy this token now — it is shown only once and cannot be retrieved again.',
    },
    201,
  );
});

/** DELETE /api/v1-tokens/:id — revoke a token the caller org owns. */
apiTokensAdmin.delete('/api/v1-tokens/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, FLAG_KEY, { userId: c.get('userId') ?? '', orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }
  const revoked = await revokeApiToken(c.env.DB, orgId, c.req.param('id'));
  if (!revoked) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Token not found.' } }, 404);
  }
  return c.json({ ok: true });
});
