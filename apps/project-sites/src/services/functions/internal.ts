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
import { dbQueryOne } from '../db.js';
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
