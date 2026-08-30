/**
 * Functions internal-fetch plane (ADR-0035 §6/§8, Stage 4.1(d) env.AI).
 *
 * A user `functions/` worker can't touch platform D1/AI directly — that would be
 * UNMETERED + cross-tenant. Instead the runtime shims make a SIGNED internal fetch
 * to `/api/_ps/*` on the platform worker: the deploy injects a per-site token
 * `<siteId>.<hmac>` (HMAC-SHA256 of the siteId under the platform's
 * `FUNCTIONS_INTERNAL_SECRET`), and the handlers here verify it, resolve the org,
 * and do the METERED work. Only a worker WE deployed for that siteId carries a
 * valid token — user code never sees it (it's a `__PS_*` binding, stripped by
 * `buildFunctionsEnv`). This same plane will back `env.DATA` (Stage 4.1(e)).
 */
import type { Context } from 'hono';
import type { Env, Variables } from '../../types/env.js';
import { getBalance, debitCredits, maybeFireAlerts } from '../credits.js';
import { dbQuery, dbQueryOne } from '../db.js';
import { getSession } from '../auth.js';
import { safeWaitUntil } from '../../lib/wait-until.js';

/** HMAC-SHA256(secret, message) as lowercase hex. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex-string compare (avoids leaking the HMAC via timing). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sign a per-site function token: `<siteId>.<hmacHex>`.
 * @example await signFunctionToken(secret, 'abc') // 'abc.9f8e…'
 */
export async function signFunctionToken(secret: string, siteId: string): Promise<string> {
  return `${siteId}.${await hmacHex(secret, siteId)}`;
}

/**
 * Verify a function token; returns the siteId iff the HMAC matches, else null.
 * @example (await verifyFunctionToken(secret, token)) === 'abc'
 */
export async function verifyFunctionToken(secret: string, token: string): Promise<string | null> {
  if (!secret || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const siteId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(secret, siteId);
  return timingSafeEqualHex(sig, expected) ? siteId : null;
}

/** Read the platform functions-internal HMAC secret (cast — `env.ts` is concurrent-owned). */
function internalSecret(env: Env): string {
  return (env as unknown as { FUNCTIONS_INTERNAL_SECRET?: string }).FUNCTIONS_INTERNAL_SECRET ?? '';
}

/** Credits debited per `env.AI.run` call (v1 flat; token-based metering later). */
export const AI_CALL_COST = 1;

/**
 * `POST /api/_ps/ai/run` — the debit-then-call backend for `env.AI` (Stage 4.1(d)).
 *
 * Verifies the site token → resolves the org → checks `ai_credits_balance` → runs
 * Workers AI → debits {@link AI_CALL_COST} (only on success — a failed run is never
 * charged). 401 on a bad token, 404 unknown site, 400 bad body, 402 out of credits,
 * 502 on an AI fault. `env.AI` is metered BY CONSTRUCTION — user code never gets a
 * raw AI binding.
 *
 * @remarks Impure — reads/writes D1 + calls Workers AI.
 */
export async function handleFunctionAiRun(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const siteId = await verifyFunctionToken(internalSecret(c.env), token);
  if (!siteId) return c.json({ error: { message: 'invalid function token' } }, 401);

  const site = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site) return c.json({ error: { message: 'site not found' } }, 404);

  let body: { model?: unknown; inputs?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: { message: 'invalid JSON body' } }, 400);
  }
  if (typeof body.model !== 'string' || body.model.length === 0) {
    return c.json({ error: { message: 'model (string) is required' } }, 400);
  }

  const balance = await getBalance(c.env, site.org_id);
  if (balance < AI_CALL_COST) {
    return c.json(
      { error: { message: 'AI credits exhausted for this site — top up at /admin/billing' } },
      402,
    );
  }

  let result: unknown;
  try {
    result = await c.env.AI.run(
      body.model as Parameters<Ai['run']>[0],
      (body.inputs ?? {}) as Parameters<Ai['run']>[1],
    );
  } catch (err) {
    return c.json(
      { error: { message: err instanceof Error ? err.message : 'AI call failed' } },
      502,
    );
  }

  // Debit AFTER a successful call. Fail-soft: a debit failure still returns the
  // result (we already spent the compute); alerts fire-and-forget.
  const fresh = await debitCredits(c.env, {
    orgId: site.org_id,
    siteId,
    amount: AI_CALL_COST,
    reason: 'function.ai',
  }).catch(() => balance - AI_CALL_COST);
  // Post-debit spend alerts, fire-and-forget. safeWaitUntil tolerates a missing
  // ExecutionContext (internal/test invocations) — a bare c.executionCtx getter throws.
  safeWaitUntil(c, maybeFireAlerts(c.env, site.org_id, fresh).catch(() => {}) as Promise<unknown>);

  return c.json({ result, credits_remaining: fresh });
}

/** Verify the per-site function token from the `Authorization: Bearer` header. */
async function siteIdFromAuth(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<string | null> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return verifyFunctionToken(internalSecret(c.env), token);
}

/** Max rows `env.DATA.forms.list` returns; the shim also clamps, defense-in-depth. */
export const FORMS_LIST_MAX = 100;
/** Default rows when the caller omits `limit`. */
export const FORMS_LIST_DEFAULT = 20;

/**
 * `GET /api/_ps/data/forms?limit=N` — the read backend for `env.DATA.forms.list`
 * (Stage 4.1(e)). Verifies the site token → returns THIS site's `form_submissions`
 * (newest first, `limit` clamped to [1, {@link FORMS_LIST_MAX}]) as a safe read-only
 * shape (id, form_name, email, parsed `fields`, status, created_at). Tenant-scoped by
 * `site_id` from the token — NEVER cross-site; no raw SQL reaches user code; visitor
 * `ip_address`/`user_agent` are deliberately withheld. 401 on a bad token.
 *
 * @remarks Impure — reads D1.
 */
export async function handleFunctionDataForms(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const siteId = await siteIdFromAuth(c);
  if (!siteId) return c.json({ error: { message: 'invalid function token' } }, 401);

  const raw = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(raw)
    ? Math.max(1, Math.min(FORMS_LIST_MAX, raw))
    : FORMS_LIST_DEFAULT;

  const rows = await dbQuery<{
    id: string;
    form_name: string;
    email: string | null;
    payload: string | null;
    status: string | null;
    created_at: string;
  }>(
    c.env.DB,
    // NOTE: form_submissions has NO deleted_at column (it is NOT soft-deleted, unlike
    // most tables) — filtering on it errors in D1 + gets swallowed into a lying-empty
    // result. Scope by site_id alone (the tenant boundary from the token).
    `SELECT id, form_name, email, payload, status, created_at
       FROM form_submissions
      WHERE site_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [siteId, limit],
  );

  const items = (rows.data ?? []).map((r) => {
    let fields: unknown = {};
    if (r.payload) {
      try {
        fields = JSON.parse(r.payload);
      } catch {
        fields = {};
      }
    }
    return {
      id: r.id,
      form_name: r.form_name,
      email: r.email,
      fields,
      status: r.status,
      created_at: r.created_at,
    };
  });

  return c.json({ items });
}

/**
 * `GET /api/_ps/data/site` — the read backend for `env.DATA.site()` (Stage 4.1(e)).
 * Verifies the site token → returns THIS site's own read-only metadata (id, slug,
 * business_name, business_address, status, created_at). Tenant-scoped by the token;
 * no org-wide or cross-site data, no internal columns. 401 on a bad token, 404 when
 * the site is missing/soft-deleted.
 *
 * @remarks Impure — reads D1.
 */
export async function handleFunctionDataSite(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const siteId = await siteIdFromAuth(c);
  if (!siteId) return c.json({ error: { message: 'invalid function token' } }, 401);

  const site = await dbQueryOne<{
    id: string;
    slug: string;
    business_name: string | null;
    business_address: string | null;
    status: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, slug, business_name, business_address, status, created_at
       FROM sites WHERE id = ? AND deleted_at IS NULL`,
    [siteId],
  );
  if (!site) return c.json({ error: { message: 'site not found' } }, 404);

  return c.json({ site });
}

/**
 * `POST /api/_ps/auth/verify-session` — the backend for `ctx.verifyOwnerSession()`
 * (Stage 4.2b, ADR-0035 §108). Verifies the site token → resolves the site's org,
 * then checks whether the FORWARDED end-user session token (from the request that
 * hit the user endpoint) belongs to a MEMBER of that org (the site owner). Returns
 * `{authenticated, userId?, orgId?}` — an unauthenticated caller is a VALID
 * `{authenticated:false}` answer, never an error status. 401 only on a bad SITE
 * token; 404 unknown site. Never exposes any data beyond the yes/no + the owner's id.
 *
 * @remarks Impure — reads D1 (sessions + memberships).
 */
export async function handleFunctionAuthVerifySession(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const siteId = await siteIdFromAuth(c);
  if (!siteId) return c.json({ error: { message: 'invalid function token' } }, 401);

  const site = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site) return c.json({ error: { message: 'site not found' } }, 404);

  let body: { session_token?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }
  const token = typeof body.session_token === 'string' ? body.session_token : '';
  if (!token) return c.json({ authenticated: false });

  const session = await getSession(c.env.DB, token);
  if (!session) return c.json({ authenticated: false });

  // Owner = a member of the site's org. A valid session for a NON-member is
  // authenticated-but-not-owner → `{authenticated:false}` (the helper is
  // "owner session", not "any session").
  const member = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1',
    [site.org_id, session.user_id],
  );
  if (!member) return c.json({ authenticated: false });
  return c.json({ authenticated: true, userId: session.user_id, orgId: site.org_id });
}

/**
 * `POST /api/_ps/turnstile/verify` — the backend for `ctx.verifyTurnstile(token)`
 * (Stage 4.2b, ADR-0035 §109). Verifies the site token, then calls Cloudflare's
 * Turnstile siteverify with the PLATFORM secret (`TURNSTILE_SECRET_KEY`) + the
 * caller's token. Returns `{success}`. A missing platform secret or a siteverify
 * fault → `{success:false}` (graceful — never a crash). 401 on a bad site token.
 *
 * @remarks Impure — issues a siteverify subrequest.
 */
export async function handleFunctionTurnstileVerify(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const siteId = await siteIdFromAuth(c);
  if (!siteId) return c.json({ error: { message: 'invalid function token' } }, 401);

  let body: { token?: unknown; remoteip?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }
  const token = typeof body.token === 'string' ? body.token : '';
  const secret = c.env.TURNSTILE_SECRET_KEY ?? '';
  if (!token || !secret) return c.json({ success: false });

  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (typeof body.remoteip === 'string') form.set('remoteip', body.remoteip);

  let ok = false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    ok = res.ok && data.success === true;
  } catch {
    ok = false;
  }
  return c.json({ success: ok });
}
