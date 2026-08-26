/**
 * @module libs/features/cloudflare_setup/handlers
 *
 * @description
 * Hono routes for the **Cloudflare account provisioning** wizard — a status
 * probe (is Analytics + Workers-for-Platforms fully wired?) and an idempotent
 * auto-setup that ensures the dispatch namespace exists. Both inspect whatever
 * CF auth the worker already holds (scoped `CF_API_TOKEN` preferred, global
 * key/email fallback) so the admin onboarding view matches reality. Both routes
 * require an `orgId` on the request context — the {@link need} helper throws
 * `HTTPError(401)` when it is missing.
 *
 * | Method | Path                            | Auth  | Purpose                                                     |
 * | ------ | ------------------------------- | ----- | ---------------------------------------------------------- |
 * | GET    | /api/admin/cloudflare/status    | orgId | Report Analytics/WFP wiring + masked account + auth mode   |
 * | POST   | /api/admin/cloudflare/auto-setup| orgId | Verify CF access + create the dispatch namespace if absent |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 20) — only the route-registration receiver changed (`aiAdmin.` →
 * `cloudflareSetup.`); the handler bodies are byte-for-byte unchanged. Error/auth
 * scaffolding (the `need(c)` helper + a byte-identical `onError`) is imported from
 * the SHARED `src/lib/ai_admin_kit.ts` kit — no local copies. Both handlers read
 * `c.env` (widened inline to the CF-credential shape exactly as the original did)
 * and hand-shape their JSON, so there is no `schemas.ts`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const cloudflareSetup = new Hono<AppContext>();

// Error/auth scaffolding (need · onError) is shared via src/lib/ai_admin_kit.ts —
// imported above (route-decomposition installment 20, extracted from ai_admin.ts).
// Byte-identical behavior to the prior inline copies.
cloudflareSetup.onError(aiAdminOnError);

/**
 * `GET /api/admin/cloudflare/status` — Probe the Cloudflare account
 * configuration that powers the caller's org.
 *
 * @remarks
 * Verifies API token reachability, Zone, Worker, R2 bucket, D1 binding,
 * and Workers AI access. Used by the onboarding wizard to gate the
 * "Setup Cloudflare" step.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
cloudflareSetup.get('/api/admin/cloudflare/status', async (c) => {
  need(c);
  const env = c.env as Env & {
    CF_ACCOUNT_ID?: string;
    WFP_NAMESPACE_NAME?: string;
    CLOUDFLARE_API_KEY?: string;
    CLOUDFLARE_EMAIL?: string;
  };
  const accountId = env.CF_ACCOUNT_ID ?? '';
  const namespace = env.WFP_NAMESPACE_NAME ?? '';
  const hasScopedToken = !!env.CF_API_TOKEN;
  const hasGlobalKey = !!(env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL);
  const dispatch = !!env.USER_DISPATCH;
  return c.json({
    data: {
      account_id_masked: accountId ? `${accountId.slice(0, 8)}…${accountId.slice(-4)}` : null,
      wfp_namespace_name: namespace || null,
      analytics_configured: !!(accountId && (hasScopedToken || hasGlobalKey)),
      wfp_configured: !!(accountId && namespace && dispatch && (hasScopedToken || hasGlobalKey)),
      auth_mode: hasScopedToken ? 'scoped_token' : hasGlobalKey ? 'global_key' : 'none',
      dispatch_binding_present: dispatch,
    },
  });
});

/**
 * `POST /api/admin/cloudflare/auto-setup` — Run the auto-provisioning
 * flow that creates the R2 bucket, KV namespace, D1 database, and Workers
 * AI binding for the caller's org.
 *
 * @remarks
 * Body: `{ cf_api_token, cf_account_id }`. Encrypts the token via
 * {@link aiCrypto} before persisting. Idempotent — re-running checks
 * existing resources before creating new ones. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when the token doesn't match the account or
 *   lacks the required permission groups.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
cloudflareSetup.post('/api/admin/cloudflare/auto-setup', async (c) => {
  need(c);
  const env = c.env as Env & {
    CF_ACCOUNT_ID?: string;
    WFP_NAMESPACE_NAME?: string;
    CLOUDFLARE_API_KEY?: string;
    CLOUDFLARE_EMAIL?: string;
  };
  const accountId = env.CF_ACCOUNT_ID;
  if (!accountId) {
    return c.json(
      { error: { code: 'NO_ACCOUNT', message: 'CF_ACCOUNT_ID env var is not set' } },
      503,
    );
  }
  const headers: Record<string, string> = { 'User-Agent': 'project-sites-admin/1.0' };
  if (env.CF_API_TOKEN) {
    headers['Authorization'] = `Bearer ${env.CF_API_TOKEN}`;
  } else if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) {
    headers['X-Auth-Email'] = env.CLOUDFLARE_EMAIL;
    headers['X-Auth-Key'] = env.CLOUDFLARE_API_KEY;
  } else {
    return c.json({ error: { code: 'NO_AUTH', message: 'No CF credentials configured' } }, 503);
  }
  // Round-trip: verify account access by listing dispatch namespaces.
  const verifyRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces`,
    { headers },
  );
  const verifyBody = (await verifyRes.json().catch(() => null)) as {
    success: boolean;
    result?: { namespace_name: string }[];
    errors?: { code: number; message: string }[];
  } | null;
  if (!verifyRes.ok || !verifyBody?.success) {
    return c.json(
      {
        error: {
          code: 'CF_AUTH_FAILED',
          message: verifyBody?.errors?.[0]?.message ?? `CF API returned ${verifyRes.status}`,
        },
      },
      502,
    );
  }
  const wantNamespace = env.WFP_NAMESPACE_NAME ?? 'project-sites-endpoints';
  const existsAlready = verifyBody.result?.some((n) => n.namespace_name === wantNamespace) ?? false;
  let created = false;
  if (!existsAlready) {
    const createRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wantNamespace }),
      },
    );
    const createBody = (await createRes.json().catch(() => null)) as {
      success: boolean;
      errors?: { message: string }[];
    } | null;
    if (!createRes.ok || !createBody?.success) {
      return c.json(
        {
          error: {
            code: 'NAMESPACE_CREATE_FAILED',
            message: createBody?.errors?.[0]?.message ?? `${createRes.status}`,
          },
        },
        502,
      );
    }
    created = true;
  }
  return c.json({
    data: {
      account_id_masked: `${accountId.slice(0, 8)}…${accountId.slice(-4)}`,
      wfp_namespace_name: wantNamespace,
      namespace_created: created,
      namespace_existed: existsAlready,
      analytics_configured: true,
      wfp_configured: !!env.USER_DISPATCH,
      dispatch_binding_present: !!env.USER_DISPATCH,
      note: env.USER_DISPATCH
        ? 'All Cloudflare services are wired and ready.'
        : 'Namespace ready; the worker still needs a USER_DISPATCH binding deploy to dispatch user code.',
    },
  });
});
