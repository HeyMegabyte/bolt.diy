/**
 * @module libs/features/ai_endpoints/handlers
 *
 * @description
 * Hono routes for a site's **AI endpoints** — the per-site serverless functions
 * (AI-prompt or Worker code) surfaced publicly at `/api/ai/:slug/:endpoint`. This
 * is the authenticated management surface: CRUD over the `ai_endpoints` D1 table
 * plus deploy / logs / duplicate / ai-helper (IDE) actions and an LLM-backed
 * `suggest` scaffolder. Every route requires both an `orgId` and a `userId` on the
 * request context — the {@link need} helper throws `HTTPError(401)` when either is
 * missing — and guards site ownership through {@link siteOwned} (404, never 403,
 * on a missing/foreign site so cross-org sites never leak).
 *
 * | Method | Path                                                        | Auth        | Purpose                                              |
 * | ------ | ----------------------------------------------------------- | ----------- | ---------------------------------------------------- |
 * | GET    | /api/sites/:siteId/ai-endpoints/:endpointId                 | orgId+userId | Fetch one endpoint (files, language, deploy status) |
 * | GET    | /api/sites/:siteId/ai-endpoints                             | orgId+userId | List endpoints (no bodies) + deploy/auth summary    |
 * | POST   | /api/sites/:siteId/ai-endpoints                             | orgId+userId | Create endpoint + starter files + first deploy      |
 * | PUT    | /api/sites/:siteId/ai-endpoints/:endpointId                 | orgId+userId | Update metadata / files / auth mode                 |
 * | POST   | /api/sites/:siteId/ai-endpoints/:endpointId/deploy          | orgId+userId | Re-deploy from the IDE                               |
 * | GET    | /api/sites/:siteId/ai-endpoints/:endpointId/logs            | orgId+userId | Last 20 invocation logs                             |
 * | POST   | /api/sites/:siteId/ai-endpoints/:endpointId/duplicate       | orgId+userId | Clone endpoint (new slug, fresh deploy)             |
 * | POST   | /api/sites/:siteId/ai-endpoints/:endpointId/ai-helper       | orgId+userId | IDE AI helper (stub — LLM-backed ships later)       |
 * | DELETE | /api/sites/:siteId/ai-endpoints/:endpointId                 | orgId+userId | Delete endpoint + tear down dispatched Worker       |
 * | POST   | /api/sites/:siteId/ai-endpoints/suggest                     | orgId+userId | LLM scaffolds a new endpoint (Zod-validated)        |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 15) — only the route-registration receiver changed (`aiAdmin.` →
 * `aiEndpoints.`); the handler bodies are byte-for-byte unchanged. The module
 * reproduces ai_admin's EXACT error scaffolding (the `HTTPError` class, the
 * `need(c)` / `siteOwned(...)` / `safeJson(...)` helpers, and a byte-identical
 * `onError`) so behavior is identical: it contains ONLY these ai_admin-sourced
 * routes, so exact reproduction = byte-identical behavior (no re-throw needed —
 * this module has no pre-existing shared-`AppError` routes to fall through to).
 * Bodies are read via a raw `as {…}` cast + `.catch(() => ({}))` rather than a Zod
 * schema at the boundary, so there is no `schemas.ts` — the moved handlers keep
 * their original in-body validation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import {
  uploadUserWorker,
  deleteUserWorker,
  SUPPORTED_LANGUAGES,
  isWfpConfigured,
} from '../../../src/services/wfp_dispatch.js';
import {
  deployEndpointFromFiles,
  normaliseSlug,
  safeParseJson,
  LANGUAGE_STARTERS,
  type IdeLanguage,
  type EndpointAuthMode,
} from '../../../src/services/ai_endpoints_ide.js';
import { suggestEndpoint } from '../../../src/services/ai_admin_features.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const aiEndpoints = new Hono<AppContext>();

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

function need(c: Ctx): { orgId: string; userId: string } {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new HTTPError(401, 'Authentication required');
  return { orgId, userId };
}

class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

aiEndpoints.onError((err, c) => {
  if (err instanceof HTTPError)
    return c.json({ error: { message: err.message } }, err.status as 400);
  // Unexpected error → log the detail server-side, return a GENERIC message so
  // raw internals (stack/SQL/paths) never reach the client (HTTPError above is
  // the typed, intentionally-surfaced path).
  console.warn(
    JSON.stringify({
      level: 'error',
      service: 'ai_admin',
      message: 'unhandled error',
      error: err.message,
      request_id: c.get('requestId'),
    }),
  );
  return c.json({ error: { message: 'internal error' } }, 500);
});

async function siteOwned(
  c: Ctx,
  orgId: string,
  siteId: string,
): Promise<{ slug: string; business_name: string | null }> {
  const row = await c.env.DB.prepare(
    `SELECT slug, business_name FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(siteId, orgId)
    .first<{ slug: string; business_name: string | null }>();
  if (!row) throw new HTTPError(404, 'Site not found');
  return row;
}

function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/* ────────────────────────── AI Endpoints CRUD ────────────────────────── */

/**
 * `GET /api/sites/:siteId/ai-endpoints/:endpointId` — Fetch a single AI
 * endpoint definition including source files, language, and deploy status.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the endpoint id doesn't exist on that site.
 */
aiEndpoints.get('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, display_name, description, kind, method,
            prompt_template, worker_language, worker_code, wfp_script_name,
            enabled, mcp_tools_json, created_at, updated_at,
            language, files_json, bindings_json, auth_mode, rate_limit_per_sec,
            cache_ttl_seconds, cron_expression, tags_json, deploy_status,
            deploy_error, deployed_at
     FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<Record<string, unknown>>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  return c.json({
    data: {
      ...row,
      mcp_tools: row['mcp_tools_json'] ? safeJson(row['mcp_tools_json'] as string) : [],
      files: safeParseJson<Record<string, string>>(row['files_json'] as string | null, {}),
      bindings: safeParseJson<unknown[]>(row['bindings_json'] as string | null, []),
      tags: safeParseJson<unknown[]>(row['tags_json'] as string | null, []),
    },
  });
});

/**
 * `GET /api/sites/:siteId/ai-endpoints` — List AI endpoints registered on
 * the site (without source bodies) with deploy + auth mode summary.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
aiEndpoints.get('/api/sites/:siteId/ai-endpoints', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, display_name, description, kind, method, worker_language,
            wfp_script_name, enabled, created_at, updated_at,
            language, auth_mode, rate_limit_per_sec, cache_ttl_seconds,
            cron_expression, tags_json, deploy_status, deployed_at
     FROM ai_endpoints WHERE site_id = ? ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      tags: safeParseJson<unknown[]>(r['tags_json'] as string | null, []),
    })),
    wfp_configured: isWfpConfigured(c.env),
    supported_languages: SUPPORTED_LANGUAGES,
  });
});

/**
 * `POST /api/sites/:siteId/ai-endpoints` — Create a new AI endpoint with
 * starter files for the chosen language.
 *
 * @remarks
 * Body accepts `name`, `slug` (auto-normalised), `description`,
 * `language` (must be in {@link SUPPORTED_LANGUAGES}), `auth_mode`, and
 * optional starter `files`. Defaults are pulled from
 * {@link LANGUAGE_STARTERS}. Writes an audit entry on success.
 *
 * @throws 400 BAD_REQUEST when the language is unsupported or the slug
 *   collides with an existing endpoint on the site.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
aiEndpoints.post('/api/sites/:siteId/ai-endpoints', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as {
    endpoint_slug: string;
    display_name?: string;
    description?: string;
    kind?: 'prompt' | 'worker';
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'BOTH';
    prompt_template?: string;
    worker_language?: string;
    worker_code?: string;
    mcp_tools?: string[];
    language?: IdeLanguage;
    files?: Record<string, string>;
    bindings?: unknown[];
    auth_mode?: EndpointAuthMode;
    rate_limit_per_sec?: number;
    cache_ttl_seconds?: number;
    cron_expression?: string | null;
    tags?: unknown[];
  };
  // Clamp numeric config to the range the FE enforces (rate 0-10000/sec, ttl
  // 0-86400s) so the raw API can't persist a negative or absurd value that would
  // break the endpoint's own limiter/cache. Clamps (never rejects) — matches FE.
  const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : dflt;
    return Math.max(min, Math.min(max, n));
  };
  const slug = normaliseSlug(body.endpoint_slug);
  if (!slug) throw new HTTPError(400, 'slug must be lowercase a-z 0-9 dashes, 2-64 chars');
  const language: IdeLanguage =
    body.language ??
    (body.kind === 'worker'
      ? ((body.worker_language as IdeLanguage) ?? 'javascript')
      : 'ai-prompt');
  const kind: 'prompt' | 'worker' = language === 'ai-prompt' ? 'prompt' : 'worker';
  const files =
    body.files && Object.keys(body.files).length > 0 ? body.files : LANGUAGE_STARTERS[language];
  const id = crypto.randomUUID();
  const deploy = await deployEndpointFromFiles(c.env, {
    siteId,
    endpointSlug: slug,
    language,
    files,
  });
  if (!deploy.ok) throw new HTTPError((deploy.status ?? 502) as 400, deploy.error);
  await c.env.DB.prepare(
    `INSERT INTO ai_endpoints (id, org_id, site_id, endpoint_slug, display_name, description,
       kind, method, prompt_template, worker_language, worker_code, wfp_script_name, mcp_tools_json,
       language, files_json, bindings_json, auth_mode, rate_limit_per_sec, cache_ttl_seconds,
       cron_expression, tags_json, deploy_status, deployed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      siteId,
      slug,
      body.display_name ?? slug,
      body.description ?? null,
      kind,
      body.method ?? 'POST',
      language === 'ai-prompt' ? (body.prompt_template ?? files['prompt.md'] ?? null) : null,
      language === 'ai-prompt' ? null : language,
      language === 'ai-prompt' ? null : (body.worker_code ?? null),
      deploy.scriptName,
      body.mcp_tools ? JSON.stringify(body.mcp_tools) : null,
      language,
      JSON.stringify(files),
      body.bindings ? JSON.stringify(body.bindings) : null,
      body.auth_mode ?? 'open',
      clampInt(body.rate_limit_per_sec, 0, 10000, 60),
      clampInt(body.cache_ttl_seconds, 0, 86400, 0),
      body.cron_expression ?? null,
      body.tags ? JSON.stringify(body.tags) : null,
      deploy.runtimePending ? 'idle' : 'live',
      deploy.runtimePending ? null : new Date().toISOString(),
    )
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'ai_endpoint.created',
      message: `AI endpoint '${slug}' created on site '${site.slug}' (${language})`,
      target_type: 'ai_endpoint',
      target_id: id,
      metadata_json: { site_id: siteId, slug: site.slug, endpoint_slug: slug, language, kind },
      request_id: c.get('requestId'),
    }),
  );

  return c.json(
    {
      data: {
        id,
        endpoint_slug: slug,
        url: `https://projectsites.dev/api/ai/${site.slug}/${slug}`,
        runtime_pending: deploy.runtimePending,
        language,
      },
    },
    201,
  );
});

/**
 * `PUT /api/sites/:siteId/ai-endpoints/:endpointId` — Update an existing
 * AI endpoint's metadata, files, or auth mode.
 *
 * @remarks
 * Body accepts any subset of `name`, `description`, `auth_mode`, `files`,
 * `enabled`. Source-file edits invalidate the deployed Worker until the
 * next `/deploy` call. Writes an audit entry on success.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the endpoint id doesn't exist on that site.
 */
aiEndpoints.put('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, kind, wfp_script_name, language FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<{
      id: string;
      endpoint_slug: string;
      kind: string;
      wfp_script_name: string | null;
      language: string | null;
    }>();
  if (!existing) throw new HTTPError(404, 'Endpoint not found');

  let nextSlug = existing.endpoint_slug;
  if (typeof body['endpoint_slug'] === 'string' || typeof body['slug'] === 'string') {
    const proposed = normaliseSlug((body['endpoint_slug'] ?? body['slug']) as string);
    if (!proposed) throw new HTTPError(400, 'slug must be lowercase a-z 0-9 dashes, 2-64 chars');
    if (proposed !== existing.endpoint_slug) {
      const dupe = await c.env.DB.prepare(
        `SELECT id FROM ai_endpoints WHERE site_id = ? AND endpoint_slug = ? AND id != ?`,
      )
        .bind(siteId, proposed, existing.id)
        .first();
      if (dupe) throw new HTTPError(409, `Endpoint slug "${proposed}" already exists on this site`);
      nextSlug = proposed;
    }
  }

  if (typeof body['method'] === 'string') {
    const allowed = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'BOTH'];
    if (!allowed.includes(body['method'] as string))
      throw new HTTPError(400, 'method must be one of ' + allowed.join(', '));
  }

  let wfpScriptName = existing.wfp_script_name;
  let deployStatus: string | null = null;
  let deployedAt: string | null = null;
  let deployError: string | null = null;
  if (body['files'] || body['language']) {
    const language = ((body['language'] as IdeLanguage | undefined) ??
      (existing.language as IdeLanguage | null) ??
      'ai-prompt') as IdeLanguage;
    const files = (body['files'] as Record<string, string> | undefined) ?? {};
    const result = await deployEndpointFromFiles(c.env, {
      siteId,
      endpointSlug: nextSlug,
      language,
      files,
    });
    if (!result.ok) {
      deployStatus = 'error';
      deployError = result.error;
    } else {
      wfpScriptName = result.scriptName;
      deployStatus = result.runtimePending ? 'idle' : 'live';
      deployedAt = result.runtimePending ? null : new Date().toISOString();
    }
  } else if (existing.kind === 'worker' && typeof body['worker_code'] === 'string') {
    // Legacy single-file edit.
    const up = await uploadUserWorker(c.env, {
      siteId,
      endpointSlug: nextSlug,
      language: ((body['worker_language'] as string) ?? 'javascript') as
        | 'javascript'
        | 'typescript'
        | 'python'
        | 'rust-wasm',
      code: body['worker_code'] as string,
    });
    if (!up.ok) throw new HTTPError(502, `WFP upload failed: ${up.error}`);
    wfpScriptName = up.scriptName;
  }

  const updates: Record<string, unknown> = {};
  const direct = [
    'display_name',
    'description',
    'method',
    'prompt_template',
    'worker_language',
    'worker_code',
    'enabled',
    'language',
    'auth_mode',
    'rate_limit_per_sec',
    'cache_ttl_seconds',
    'cron_expression',
  ];
  for (const k of direct) if (k in body) updates[k] = body[k];
  // Same clamp as create — the raw API can't persist an out-of-range rate/ttl.
  if ('rate_limit_per_sec' in updates)
    updates['rate_limit_per_sec'] = Math.max(
      0,
      Math.min(10000, Math.trunc(Number(updates['rate_limit_per_sec']) || 0)),
    );
  if ('cache_ttl_seconds' in updates)
    updates['cache_ttl_seconds'] = Math.max(
      0,
      Math.min(86400, Math.trunc(Number(updates['cache_ttl_seconds']) || 0)),
    );
  if (nextSlug !== existing.endpoint_slug) updates['endpoint_slug'] = nextSlug;
  if (body['files']) updates['files_json'] = JSON.stringify(body['files']);
  if (body['bindings']) updates['bindings_json'] = JSON.stringify(body['bindings']);
  if (body['tags']) updates['tags_json'] = JSON.stringify(body['tags']);
  if (wfpScriptName !== existing.wfp_script_name) updates['wfp_script_name'] = wfpScriptName;
  if (deployStatus !== null) updates['deploy_status'] = deployStatus;
  if (deployedAt !== null) updates['deployed_at'] = deployedAt;
  if (deployError !== null) updates['deploy_error'] = deployError;

  if (Object.keys(updates).length === 0) return c.json({ data: { saved: true, slug: nextSlug } });
  const cols = Object.keys(updates);
  const set = [...cols.map((k) => `${k} = ?`), `updated_at = datetime('now')`].join(', ');
  await c.env.DB.prepare(`UPDATE ai_endpoints SET ${set} WHERE id = ?`)
    .bind(...cols.map((k) => updates[k]), c.req.param('endpointId'))
    .run();
  return c.json({
    data: { saved: true, slug: nextSlug, deploy_status: deployStatus, deploy_error: deployError },
  });
});

/* ────────────────────────── AI Endpoints IDE: deploy + helpers ────────────────────────── */

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/deploy
 * Re-deploy from the IDE. Body: { files: {[path]: contents}, language? }.
 * Returns { ok, runtime_pending, deploy_status, deploy_error }.
 */
aiEndpoints.post('/api/sites/:siteId/ai-endpoints/:endpointId/deploy', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const row = await c.env.DB.prepare(
    `SELECT endpoint_slug, language FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(endpointId, siteId)
    .first<{ endpoint_slug: string; language: string | null }>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  const body = (await c.req.json().catch(() => ({}))) as {
    files?: Record<string, string>;
    language?: IdeLanguage;
  };
  const language = (body.language ?? row.language ?? 'ai-prompt') as IdeLanguage;
  const files = body.files ?? {};
  const result = await deployEndpointFromFiles(c.env, {
    siteId,
    endpointSlug: row.endpoint_slug,
    language,
    files,
  });
  const deployStatus = !result.ok ? 'error' : result.runtimePending ? 'idle' : 'live';
  const deployError = result.ok ? null : result.error;
  const deployedAt = result.ok && !result.runtimePending ? new Date().toISOString() : null;
  await c.env.DB.prepare(
    `UPDATE ai_endpoints SET language = ?, files_json = ?, deploy_status = ?, deploy_error = ?, deployed_at = COALESCE(?, deployed_at), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(language, JSON.stringify(files), deployStatus, deployError, deployedAt, endpointId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: result.ok ? 'ai_endpoint.deployed' : 'ai_endpoint.deploy_failed',
      message: result.ok
        ? `AI endpoint '${row.endpoint_slug}' deployed (${language})`
        : `AI endpoint '${row.endpoint_slug}' deploy failed: ${deployError ?? 'unknown error'}`,
      target_type: 'ai_endpoint',
      target_id: endpointId,
      metadata_json: {
        site_id: siteId,
        endpoint_slug: row.endpoint_slug,
        language,
        deploy_status: deployStatus,
        deploy_error: deployError,
      },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({
    data: {
      ok: result.ok,
      runtime_pending: result.ok ? result.runtimePending : false,
      deploy_status: deployStatus,
      deploy_error: deployError,
      deployed_at: deployedAt,
    },
  });
});

/**
 * GET /api/sites/:siteId/ai-endpoints/:endpointId/logs
 * Returns the last 20 invocations (status + ms + timestamp). Stub data when no
 * logs table is configured — the frontend renders an empty state gracefully.
 */
aiEndpoints.get('/api/sites/:siteId/ai-endpoints/:endpointId/logs', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const rows = await c.env.DB.prepare(
    `SELECT id, status, latency_ms, created_at FROM ai_form_logs WHERE endpoint_slug IN
       (SELECT endpoint_slug FROM ai_endpoints WHERE id = ?)
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(endpointId)
    .all()
    .catch(() => ({ results: [] as unknown[] }));
  return c.json({ data: rows.results ?? [] });
});

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/duplicate
 * Clone an existing endpoint (different slug, fresh deploy).
 */
aiEndpoints.post('/api/sites/:siteId/ai-endpoints/:endpointId/duplicate', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const src = await c.env.DB.prepare(`SELECT * FROM ai_endpoints WHERE id = ? AND site_id = ?`)
    .bind(endpointId, siteId)
    .first<Record<string, unknown>>();
  if (!src) throw new HTTPError(404, 'Endpoint not found');
  let candidate = `${src['endpoint_slug']}-copy`;
  let i = 1;
  while (
    await c.env.DB.prepare(`SELECT id FROM ai_endpoints WHERE site_id = ? AND endpoint_slug = ?`)
      .bind(siteId, candidate)
      .first()
  ) {
    i += 1;
    candidate = `${src['endpoint_slug']}-copy-${i}`;
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO ai_endpoints (id, org_id, site_id, endpoint_slug, display_name, description,
       kind, method, prompt_template, worker_language, worker_code, mcp_tools_json,
       language, files_json, bindings_json, auth_mode, rate_limit_per_sec, cache_ttl_seconds,
       cron_expression, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      siteId,
      candidate,
      `${src['display_name']} (copy)`,
      src['description'] ?? null,
      src['kind'],
      src['method'],
      src['prompt_template'] ?? null,
      src['worker_language'] ?? null,
      src['worker_code'] ?? null,
      src['mcp_tools_json'] ?? null,
      src['language'] ?? 'ai-prompt',
      src['files_json'] ?? null,
      src['bindings_json'] ?? null,
      src['auth_mode'] ?? 'open',
      src['rate_limit_per_sec'] ?? 60,
      src['cache_ttl_seconds'] ?? 0,
      src['cron_expression'] ?? null,
      src['tags_json'] ?? null,
    )
    .run();
  return c.json(
    {
      data: {
        id,
        endpoint_slug: candidate,
        url: `https://projectsites.dev/api/ai/${site.slug}/${candidate}`,
      },
    },
    201,
  );
});

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/ai-helper
 * Body: { intent: 'explain' | 'suggest' | 'tests' | 'openapi' | 'convert', target_language?, files }.
 * Returns a placeholder response. The full LLM-backed implementation is gated
 * on the workspace-LLM provider being wired (`env.AI` + AI Gateway).
 */
aiEndpoints.post('/api/sites/:siteId/ai-endpoints/:endpointId/ai-helper', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as {
    intent?: string;
    target_language?: string;
  };
  // Stub: surface a friendly "coming soon" to the IDE.
  return c.json({
    data: {
      ok: true,
      intent: body.intent ?? 'explain',
      stub: true,
      message: `AI helper (${body.intent ?? 'explain'}) is queued — full LLM-backed responses ship in the next release.`,
    },
  });
});

/**
 * `DELETE /api/sites/:siteId/ai-endpoints/:endpointId` — Remove an AI
 * endpoint and tear down its dispatched Worker.
 *
 * @remarks
 * Calls {@link deleteUserWorker} to remove the WfP namespace deployment
 * (failures are swallowed so a stale Worker never blocks the D1 cleanup)
 * then deletes the row and writes an audit entry.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the endpoint id doesn't exist on that site.
 */
aiEndpoints.delete('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const row = await c.env.DB.prepare(
    `SELECT wfp_script_name, endpoint_slug FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(endpointId, siteId)
    .first<{ wfp_script_name: string | null; endpoint_slug: string }>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  if (row.wfp_script_name) await deleteUserWorker(c.env, row.wfp_script_name);
  await c.env.DB.prepare(`DELETE FROM ai_endpoints WHERE id = ?`).bind(endpointId).run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'ai_endpoint.deleted',
      message: `AI endpoint '${row.endpoint_slug}' deleted`,
      target_type: 'ai_endpoint',
      target_id: endpointId,
      metadata_json: {
        site_id: siteId,
        endpoint_slug: row.endpoint_slug,
        wfp_script_name: row.wfp_script_name,
      },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── #93 AI Suggest Endpoint ────────────────────────── */

/**
 * POST /api/sites/:siteId/ai-endpoints/suggest
 *
 * Body: { description: string }. Calls the LLM to scaffold a new AI endpoint
 * (slug + method + language + files) and returns the Zod-validated suggestion.
 */
aiEndpoints.post('/api/sites/:siteId/ai-endpoints/suggest', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as { description?: string };
  const description = (body.description ?? '').trim();
  if (description.length < 4) {
    throw new HTTPError(400, 'description must be at least 4 characters');
  }
  try {
    const suggestion = await suggestEndpoint(c.env, description);
    return c.json({ data: suggestion });
  } catch (err) {
    throw new HTTPError(502, err instanceof Error ? err.message : 'AI suggestion failed');
  }
});
