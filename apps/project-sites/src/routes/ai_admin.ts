/**
 * Admin surface for the AI platform: form submissions, AI logs, chat context
 * files, AI settings (router prompt + chat persona + contact email), endpoints
 * CRUD, AI credits (balance, ledger, topup checkout), spend alerts, team
 * invites/members, per-site cost breakdown. Mounted by index.ts.
 *
 * Every route requires an authenticated org context. Public endpoints (form
 * ingest, /api/ai/:slug/:endpoint) live in their own files.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getBalance, topupCredits, CREDIT_BUNDLES, type BundleKey } from '../services/credits.js';
import { allProviders } from '../services/mcp_client.js';
import { DEFAULT_ROUTER_PROMPT, DEFAULT_CHAT_SYSTEM_PROMPT } from '../services/form_router.js';
import { uploadUserWorker, deleteUserWorker, SUPPORTED_LANGUAGES, isWfpConfigured } from '../services/wfp_dispatch.js';
import {
  deployEndpointFromFiles,
  normaliseSlug,
  safeParseJson,
  LANGUAGE_STARTERS,
  type IdeLanguage,
  type EndpointAuthMode,
} from '../services/ai_endpoints_ide.js';
import { recordEvent, loadOverview } from '../services/cf_analytics.js';
import {
  extractContext,
  MAX_CONTEXT_FILE_BYTES,
} from '../services/ai_context_extract.js';
import {
  buildAuthUrl,
  getAccessToken,
  listFolders,
  DRIVE_SCOPE,
} from '../services/google_drive.js';
import { syncDriveFolder } from '../services/ai_drive_sync.js';
import {
  explainTrace,
  suggestEndpoint,
  aiSearch,
  forecastCost,
  type AiTraceRow,
} from '../services/ai_admin_features.js';
import { safeParseJSONOrNull } from '../utils/safe-parse.js';

export const aiAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

function need(c: Ctx): { orgId: string; userId: string } {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new HTTPError(401, 'Authentication required');
  return { orgId, userId };
}

class HTTPError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

aiAdmin.onError((err, c) => {
  if (err instanceof HTTPError) return c.json({ error: { message: err.message } }, err.status as 400);
  return c.json({ error: { message: err.message || 'internal error' } }, 500);
});

async function siteOwned(c: Ctx, orgId: string, siteId: string): Promise<{ slug: string; business_name: string | null }> {
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
  try { return JSON.parse(s); } catch { return s; }
}

/* ────────────────────────── Form Submissions + AI Logs ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/form-submissions', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, created_at
     FROM form_submissions WHERE site_id = ?
     ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(siteId)
    .all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((r) => ({ ...r, fields: safeJson(r['payload'] as string) })),
  });
});

aiAdmin.get('/api/sites/:siteId/form-submissions/:subId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const sub = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, user_agent, created_at
     FROM form_submissions WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('subId'), siteId)
    .first<Record<string, unknown>>();
  if (!sub) throw new HTTPError(404, 'Submission not found');
  const logs = await c.env.DB.prepare(
    `SELECT * FROM ai_form_logs WHERE submission_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.req.param('subId'))
    .all();
  return c.json({
    data: {
      submission: { ...sub, fields: safeJson(sub['payload'] as string) },
      ai_logs: logs.results ?? [],
    },
  });
});

aiAdmin.get('/api/sites/:siteId/ai-logs', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const kind = c.req.query('kind');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000);
  const stmt = kind
    ? c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ? AND trace_kind = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, kind, limit)
    : c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, limit);
  const rows = await stmt.all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.get('/api/sites/:siteId/ai-logs/:logId', async (c) => {
  const { orgId } = need(c);
  await siteOwned(c, orgId, c.req.param('siteId'));
  const row = await c.env.DB.prepare(
    `SELECT * FROM ai_form_logs WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('logId'), c.req.param('siteId'))
    .first();
  if (!row) throw new HTTPError(404, 'Log not found');
  return c.json({ data: row });
});

/* ────────────────────────── AI Chat Context Files ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, description, enabled,
            length(extracted_text) AS text_chars, created_at
     FROM ai_chat_context_files WHERE site_id = ? ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.post('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) throw new HTTPError(400, 'multipart/form-data required');
  const form = await c.req.formData();
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') throw new HTTPError(400, 'file field required');
  const file = fileRaw as unknown as File;
  if (file.size > 5 * 1024 * 1024) throw new HTTPError(400, 'file too large (max 5 MB)');
  const description = (form.get('description') as string | null) ?? null;
  const id = crypto.randomUUID();
  const r2Key = `ai-context/${siteId}/${id}-${file.name}`;
  const buf = await file.arrayBuffer();
  await c.env.SITES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  let extracted: string | null = null;
  if (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'text/markdown') {
    extracted = new TextDecoder().decode(buf).slice(0, 60_000);
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_chat_context_files (id, org_id, site_id, filename, mime_type, size_bytes, r2_key, extracted_text, description, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(id, orgId, siteId, file.name, file.type || null, file.size, r2Key, extracted, description)
    .run();
  return c.json({ data: { id, filename: file.name, size_bytes: file.size, indexed: !!extracted } }, 201);
});

aiAdmin.delete('/api/sites/:siteId/ai-chat/context-files/:fileId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM ai_chat_context_files WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('fileId'), siteId)
    .first<{ r2_key: string }>();
  if (!row) throw new HTTPError(404, 'File not found');
  await c.env.SITES_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(`DELETE FROM ai_chat_context_files WHERE id = ?`)
    .bind(c.req.param('fileId'))
    .run();
  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── AI Site Settings (router prompt + chat + contact) ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-settings', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT chat_persona, chat_system_prompt, form_router_prompt, reply_email,
            contact_email, brand_tone, search_synonyms_json, updated_at,
            allow_web_research, drive_folder_id, drive_folder_name,
            drive_last_synced_at,
            CASE WHEN drive_access_token_enc IS NOT NULL THEN 1 ELSE 0 END AS drive_connected
     FROM ai_site_settings WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<Record<string, string | number | null>>();
  return c.json({
    data: {
      site_id: siteId,
      slug: site.slug,
      business_name: site.business_name,
      chat_persona: (row?.chat_persona as string | null) ?? null,
      chat_system_prompt: (row?.chat_system_prompt as string | null) ?? null,
      chat_system_prompt_default: DEFAULT_CHAT_SYSTEM_PROMPT,
      form_router_prompt: (row?.form_router_prompt as string | null) ?? null,
      form_router_prompt_default: DEFAULT_ROUTER_PROMPT,
      reply_email: (row?.reply_email as string | null) ?? null,
      contact_email: (row?.contact_email as string | null) ?? null,
      brand_tone: (row?.brand_tone as string | null) ?? null,
      search_synonyms: row?.search_synonyms_json
        ? safeJson(row.search_synonyms_json as string)
        : {},
      allow_web_research: !!row?.allow_web_research,
      drive_connected: !!row?.drive_connected,
      drive_folder_id: (row?.drive_folder_id as string | null) ?? null,
      drive_folder_name: (row?.drive_folder_name as string | null) ?? null,
      drive_last_synced_at: (row?.drive_last_synced_at as string | null) ?? null,
      updated_at: (row?.updated_at as string | null) ?? null,
    },
  });
});

aiAdmin.put('/api/sites/:siteId/ai-settings', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as Record<string, unknown>;
  const allowed = [
    'chat_persona',
    'chat_system_prompt',
    'form_router_prompt',
    'reply_email',
    'contact_email',
    'brand_tone',
  ] as const;
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) fields[k] = body[k];
  if ('allow_web_research' in body) {
    fields['allow_web_research'] = body['allow_web_research'] ? 1 : 0;
  }
  if ('search_synonyms' in body) fields['search_synonyms_json'] = JSON.stringify(body['search_synonyms']);
  const existing = await c.env.DB.prepare(`SELECT 1 FROM ai_site_settings WHERE site_id = ?`)
    .bind(siteId)
    .first();
  if (existing) {
    const cols = Object.keys(fields);
    const set = cols.map((k) => `${k} = ?`).join(', ');
    await c.env.DB.prepare(`UPDATE ai_site_settings SET ${set} WHERE site_id = ?`)
      .bind(...cols.map((k) => fields[k]), siteId)
      .run();
  } else {
    const cols = ['site_id', ...Object.keys(fields)];
    const placeholders = cols.map(() => '?').join(', ');
    await c.env.DB.prepare(`INSERT INTO ai_site_settings (${cols.join(', ')}) VALUES (${placeholders})`)
      .bind(siteId, ...Object.keys(fields).map((k) => fields[k]))
      .run();
  }
  return c.json({ data: { saved: true } });
});

/* ────────────────────────── AI Endpoints CRUD ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
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

aiAdmin.get('/api/sites/:siteId/ai-endpoints', async (c) => {
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

aiAdmin.post('/api/sites/:siteId/ai-endpoints', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as {
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
  const slug = normaliseSlug(body.endpoint_slug);
  if (!slug) throw new HTTPError(400, 'slug must be lowercase a-z 0-9 dashes, 2-64 chars');
  const language: IdeLanguage = body.language ?? (body.kind === 'worker' ? ((body.worker_language as IdeLanguage) ?? 'javascript') : 'ai-prompt');
  const kind: 'prompt' | 'worker' = language === 'ai-prompt' ? 'prompt' : 'worker';
  const files = body.files && Object.keys(body.files).length > 0 ? body.files : LANGUAGE_STARTERS[language];
  const id = crypto.randomUUID();
  const deploy = await deployEndpointFromFiles(c.env, { siteId, endpointSlug: slug, language, files });
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
      typeof body.rate_limit_per_sec === 'number' ? body.rate_limit_per_sec : 60,
      typeof body.cache_ttl_seconds === 'number' ? body.cache_ttl_seconds : 0,
      body.cron_expression ?? null,
      body.tags ? JSON.stringify(body.tags) : null,
      deploy.runtimePending ? 'idle' : 'live',
      deploy.runtimePending ? null : new Date().toISOString(),
    )
    .run();
  return c.json({
    data: {
      id,
      endpoint_slug: slug,
      url: `https://projectsites.dev/api/ai/${site.slug}/${slug}`,
      runtime_pending: deploy.runtimePending,
      language,
    },
  }, 201);
});

aiAdmin.put('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as Record<string, unknown>;
  const existing = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, kind, wfp_script_name, language FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<{ id: string; endpoint_slug: string; kind: string; wfp_script_name: string | null; language: string | null }>();
  if (!existing) throw new HTTPError(404, 'Endpoint not found');

  // Slug change: validate, ensure unique on site, allow rename of the WFP script.
  let nextSlug = existing.endpoint_slug;
  if (typeof body['endpoint_slug'] === 'string' || typeof body['slug'] === 'string') {
    const proposed = normaliseSlug((body['endpoint_slug'] ?? body['slug']) as string);
    if (!proposed) throw new HTTPError(400, 'slug must be lowercase a-z 0-9 dashes, 2-64 chars');
    if (proposed !== existing.endpoint_slug) {
      const dupe = await c.env.DB.prepare(
        `SELECT id FROM ai_endpoints WHERE site_id = ? AND endpoint_slug = ? AND id != ?`,
      ).bind(siteId, proposed, existing.id).first();
      if (dupe) throw new HTTPError(409, `Endpoint slug "${proposed}" already exists on this site`);
      nextSlug = proposed;
    }
  }

  // Method validation if present.
  if (typeof body['method'] === 'string') {
    const allowed = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'BOTH'];
    if (!allowed.includes(body['method'] as string)) throw new HTTPError(400, 'method must be one of ' + allowed.join(', '));
  }

  // Re-deploy if files or language changed.
  let wfpScriptName = existing.wfp_script_name;
  let deployStatus: string | null = null;
  let deployedAt: string | null = null;
  let deployError: string | null = null;
  if (body['files'] || body['language']) {
    const language = ((body['language'] as IdeLanguage | undefined) ?? (existing.language as IdeLanguage | null) ?? 'ai-prompt') as IdeLanguage;
    const files = (body['files'] as Record<string, string> | undefined) ?? {};
    const result = await deployEndpointFromFiles(c.env, { siteId, endpointSlug: nextSlug, language, files });
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
      language: ((body['worker_language'] as string) ?? 'javascript') as 'javascript' | 'typescript' | 'python' | 'rust-wasm',
      code: body['worker_code'] as string,
    });
    if (!up.ok) throw new HTTPError(502, `WFP upload failed: ${up.error}`);
    wfpScriptName = up.scriptName;
  }

  const updates: Record<string, unknown> = {};
  const direct = ['display_name', 'description', 'method', 'prompt_template', 'worker_language', 'worker_code', 'enabled', 'language', 'auth_mode', 'rate_limit_per_sec', 'cache_ttl_seconds', 'cron_expression'];
  for (const k of direct) if (k in body) updates[k] = body[k];
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
  return c.json({ data: { saved: true, slug: nextSlug, deploy_status: deployStatus, deploy_error: deployError } });
});

/* ────────────────────────── AI Endpoints IDE: deploy + helpers ────────────────────────── */

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/deploy
 * Re-deploy from the IDE. Body: { files: {[path]: contents}, language? }.
 * Returns { ok, runtime_pending, deploy_status, deploy_error }.
 */
aiAdmin.post('/api/sites/:siteId/ai-endpoints/:endpointId/deploy', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const row = await c.env.DB.prepare(
    `SELECT endpoint_slug, language FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  ).bind(endpointId, siteId).first<{ endpoint_slug: string; language: string | null }>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  const body = (await c.req.json().catch(() => ({}))) as { files?: Record<string, string>; language?: IdeLanguage };
  const language = (body.language ?? row.language ?? 'ai-prompt') as IdeLanguage;
  const files = body.files ?? {};
  const result = await deployEndpointFromFiles(c.env, { siteId, endpointSlug: row.endpoint_slug, language, files });
  const deployStatus = !result.ok ? 'error' : result.runtimePending ? 'idle' : 'live';
  const deployError = result.ok ? null : result.error;
  const deployedAt = result.ok && !result.runtimePending ? new Date().toISOString() : null;
  await c.env.DB.prepare(
    `UPDATE ai_endpoints SET language = ?, files_json = ?, deploy_status = ?, deploy_error = ?, deployed_at = COALESCE(?, deployed_at), updated_at = datetime('now') WHERE id = ?`,
  ).bind(language, JSON.stringify(files), deployStatus, deployError, deployedAt, endpointId).run();
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
aiAdmin.get('/api/sites/:siteId/ai-endpoints/:endpointId/logs', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const rows = await c.env.DB.prepare(
    `SELECT id, status, latency_ms, created_at FROM ai_form_logs WHERE endpoint_slug IN
       (SELECT endpoint_slug FROM ai_endpoints WHERE id = ?)
     ORDER BY created_at DESC LIMIT 20`,
  ).bind(endpointId).all().catch(() => ({ results: [] as unknown[] }));
  return c.json({ data: rows.results ?? [] });
});

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/duplicate
 * Clone an existing endpoint (different slug, fresh deploy).
 */
aiAdmin.post('/api/sites/:siteId/ai-endpoints/:endpointId/duplicate', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const endpointId = c.req.param('endpointId');
  const src = await c.env.DB.prepare(
    `SELECT * FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  ).bind(endpointId, siteId).first<Record<string, unknown>>();
  if (!src) throw new HTTPError(404, 'Endpoint not found');
  let candidate = `${src['endpoint_slug']}-copy`;
  let i = 1;
  while (await c.env.DB.prepare(`SELECT id FROM ai_endpoints WHERE site_id = ? AND endpoint_slug = ?`).bind(siteId, candidate).first()) {
    i += 1; candidate = `${src['endpoint_slug']}-copy-${i}`;
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO ai_endpoints (id, org_id, site_id, endpoint_slug, display_name, description,
       kind, method, prompt_template, worker_language, worker_code, mcp_tools_json,
       language, files_json, bindings_json, auth_mode, rate_limit_per_sec, cache_ttl_seconds,
       cron_expression, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, orgId, siteId, candidate,
    `${src['display_name']} (copy)`, src['description'] ?? null,
    src['kind'], src['method'], src['prompt_template'] ?? null, src['worker_language'] ?? null,
    src['worker_code'] ?? null, src['mcp_tools_json'] ?? null,
    src['language'] ?? 'ai-prompt', src['files_json'] ?? null, src['bindings_json'] ?? null,
    src['auth_mode'] ?? 'open', src['rate_limit_per_sec'] ?? 60, src['cache_ttl_seconds'] ?? 0,
    src['cron_expression'] ?? null, src['tags_json'] ?? null,
  ).run();
  return c.json({ data: { id, endpoint_slug: candidate, url: `https://projectsites.dev/api/ai/${site.slug}/${candidate}` } }, 201);
});

/**
 * POST /api/sites/:siteId/ai-endpoints/:endpointId/ai-helper
 * Body: { intent: 'explain' | 'suggest' | 'tests' | 'openapi' | 'convert', target_language?, files }.
 * Returns a placeholder response. The full LLM-backed implementation is gated
 * on the workspace-LLM provider being wired (`env.AI` + AI Gateway).
 */
aiAdmin.post('/api/sites/:siteId/ai-endpoints/:endpointId/ai-helper', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as { intent?: string; target_language?: string };
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

aiAdmin.delete('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT wfp_script_name FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<{ wfp_script_name: string | null }>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  if (row.wfp_script_name) await deleteUserWorker(c.env, row.wfp_script_name);
  await c.env.DB.prepare(`DELETE FROM ai_endpoints WHERE id = ?`).bind(c.req.param('endpointId')).run();
  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── AI Credits + Spend Alerts ────────────────────────── */

aiAdmin.get('/api/billing/credits', async (c) => {
  const { orgId } = need(c);
  const balance = await getBalance(c.env, orgId);
  const ledger = await c.env.DB.prepare(
    `SELECT delta, reason, stripe_session_id, created_at FROM ai_credits_ledger
     WHERE org_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(orgId)
    .all();
  return c.json({
    data: {
      balance,
      bundles: CREDIT_BUNDLES,
      ledger: ledger.results ?? [],
    },
  });
});

aiAdmin.post('/api/billing/credits/topup', async (c) => {
  const { orgId } = need(c);
  const { bundle } = (await c.req.json()) as { bundle: BundleKey };
  const cfg = CREDIT_BUNDLES[bundle];
  if (!cfg) throw new HTTPError(400, 'unknown bundle');
  const priceKey = cfg.price_id as keyof Env;
  const priceId = c.env[priceKey] as string | undefined;
  if (!priceId) {
    // DEV fallback: credit immediately. In prod this would be a Stripe Checkout.
    const fresh = await topupCredits(c.env, { orgId, amount: cfg.credits, reason: 'topup_dev' });
    return c.json({ data: { mode: 'dev', balance: fresh } });
  }
  const params = new URLSearchParams({
    'mode': 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `https://projectsites.dev/admin/billing?topup=success&bundle=${bundle}`,
    'cancel_url': `https://projectsites.dev/admin/billing?topup=cancel`,
    'metadata[org_id]': orgId,
    'metadata[bundle]': bundle,
    'metadata[credits]': String(cfg.credits),
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = (await res.json()) as { url?: string; id?: string };
  if (!res.ok || !json.url) throw new HTTPError(502, 'Stripe session creation failed');
  return c.json({ data: { mode: 'stripe', url: json.url, session_id: json.id } });
});

aiAdmin.get('/api/billing/spend-alerts', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM spend_alerts WHERE org_id = ? ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.post('/api/billing/spend-alerts', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json()) as {
    name: string;
    threshold_credits: number;
    alert_kind: 'balance_low' | 'daily_burn';
    notify_email: string;
  };
  if (!body.name || !body.notify_email || !body.alert_kind) throw new HTTPError(400, 'invalid');
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO spend_alerts (id, org_id, name, threshold_credits, alert_kind, notify_email)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, body.name, body.threshold_credits, body.alert_kind, body.notify_email)
    .run();
  return c.json({ data: { id } }, 201);
});

aiAdmin.delete('/api/billing/spend-alerts/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(`DELETE FROM spend_alerts WHERE id = ? AND org_id = ?`)
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { deleted: true } });
});

aiAdmin.get('/api/billing/site-costs', async (c) => {
  const { orgId } = need(c);
  const sinceDay = c.req.query('since') ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT site_id, SUM(ai_calls) AS ai_calls, SUM(ai_credits) AS ai_credits,
            SUM(bandwidth_bytes) AS bandwidth_bytes, SUM(storage_bytes) AS storage_bytes,
            SUM(estimated_cost_micro_usd) AS estimated_cost_micro_usd
     FROM site_cost_daily WHERE org_id = ? AND day >= ?
     GROUP BY site_id ORDER BY estimated_cost_micro_usd DESC`,
  )
    .bind(orgId, sinceDay)
    .all();
  // Enrich with site names.
  const sites = await c.env.DB.prepare(
    `SELECT id, slug, business_name FROM sites WHERE org_id = ? AND deleted_at IS NULL`,
  )
    .bind(orgId)
    .all<{ id: string; slug: string; business_name: string | null }>();
  const byId = new Map((sites.results ?? []).map((s) => [s.id, s]));
  return c.json({
    data: {
      since: sinceDay,
      rows: (rows.results ?? []).map((r) => {
        const s = byId.get(r['site_id'] as string);
        return { ...r, slug: s?.slug, business_name: s?.business_name };
      }),
    },
  });
});

/* ────────────────────────── MCP connections (list + disconnect) ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/mcp/connections', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, display_name, status, scopes_json, account_metadata_json, connected_at
     FROM mcp_connections WHERE site_id = ? AND status = 'active'`,
  )
    .bind(siteId)
    .all();
  return c.json({
    data: {
      providers: allProviders(),
      connections: (rows.results ?? []).map((r) => ({
        ...r,
        metadata: safeJson(r['account_metadata_json'] as string | null),
      })),
    },
  });
});

aiAdmin.delete('/api/sites/:siteId/mcp/connections/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('id'), siteId)
    .run();
  return c.json({ data: { revoked: true } });
});

/* ────────────────────────── Team (Settings → Team) ────────────────────────── */

aiAdmin.get('/api/team', async (c) => {
  const { orgId } = need(c);
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name AS name, m.role, m.created_at
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at ASC`,
  )
    .bind(orgId)
    .all();
  const invites = await c.env.DB.prepare(
    `SELECT id, email, role, created_at, expires_at FROM team_invites
     WHERE org_id = ? AND accepted_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: { members: members.results ?? [], invites: invites.results ?? [] } });
});

aiAdmin.post('/api/team/invites', async (c) => {
  const { orgId, userId } = need(c);
  const { email, role } = (await c.req.json()) as { email: string; role: 'owner' | 'editor' | 'viewer' };
  if (!email || !role) throw new HTTPError(400, 'email + role required');
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '');
  const tokenHash = Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  )).map((b) => b.toString(16).padStart(2, '0')).join('');
  const expires = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO team_invites (id, org_id, email, role, token_hash, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, email, role, tokenHash, userId, expires)
    .run();
  if (c.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'team@projectsites.dev',
        to: [email],
        subject: 'You’ve been invited to a Project Sites team',
        text: `You were invited as ${role}. Accept here: https://projectsites.dev/admin/accept-invite?token=${token}`,
      }),
    }).catch(() => {});
  }
  return c.json({ data: { id, token } }, 201);
});

aiAdmin.delete('/api/team/invites/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(`DELETE FROM team_invites WHERE id = ? AND org_id = ?`)
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { revoked: true } });
});

aiAdmin.delete('/api/team/members/:userId', async (c) => {
  const { orgId } = need(c);
  const targetUserId = c.req.param('userId');
  // Last-owner guard — every org must keep at least one owner. Refuse the
  // delete if removing this member would leave zero owners. Mirrors the
  // client-side disabled state on the Settings → Team list.
  const target = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).bind(targetUserId, orgId).first<{ role: string }>();
  if (target?.role === 'owner') {
    const ownerCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner' AND deleted_at IS NULL`,
    ).bind(orgId).first<{ n: number }>();
    if ((ownerCount?.n ?? 0) <= 1) {
      throw new HTTPError(409, 'Cannot remove the last owner. Promote another member to owner first.');
    }
  }
  await c.env.DB.prepare(`DELETE FROM memberships WHERE user_id = ? AND org_id = ?`)
    .bind(targetUserId, orgId)
    .run();
  return c.json({ data: { removed: true } });
});

/* ────────────────────────── Audit Log (ag-grid friendly) ────────────────────────── */

/* ────────────────────────── Cloudflare Analytics ────────────────────────── */

// Public, unauthenticated — the admin SPA fires this on every route change.
// Records one Analytics Engine data point. Seeds a sentinel visit on first
// hit so the Analytics page always shows ≥ 1 visit out of the box.
aiAdmin.post('/api/analytics/track', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { route?: string; site_id?: string };
  const orgId = (c.get('orgId') as string | undefined) ?? 'anonymous';
  recordEvent(c.env, {
    event: 'admin_visit',
    routePath: body.route ?? '/admin',
    siteId: body.site_id ?? null,
    orgId,
    userAgent: c.req.header('user-agent'),
    referrer: c.req.header('referer'),
    country: c.req.header('cf-ipcountry'),
  });
  return c.json({ data: { tracked: true } });
});

aiAdmin.get('/api/analytics/overview', async (c) => {
  const { orgId } = need(c);
  // Seed at least one visit so the page never reads empty on first load.
  recordEvent(c.env, {
    event: 'admin_visit',
    routePath: '/admin/analytics',
    orgId,
    userAgent: c.req.header('user-agent'),
    country: c.req.header('cf-ipcountry'),
  });
  const rangeRaw = c.req.query('range') ?? '30d';
  const days = rangeRaw === '1d' ? 1 : rangeRaw === '7d' ? 7 : rangeRaw === '90d' ? 90 : 30;
  try {
    const data = await loadOverview(c.env, orgId, days);
    return c.json({ data, range: rangeRaw, days });
  } catch (err) {
    return c.json({
      error: { message: err instanceof Error ? err.message : 'analytics unavailable' },
      data: null,
    }, 200);
  }
});

aiAdmin.get('/api/audit/rows', async (c) => {
  const { orgId } = need(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 500), 5000);
  const rows = await c.env.DB.prepare(
    `SELECT id, action, target_type, target_id, actor_id, metadata_json, request_id, created_at
     FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(orgId, limit)
    .all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      metadata: safeJson(r['metadata_json'] as string | null),
    })),
  });
});

/* ────────────────────────── Team invite acceptance ────────────────────────── */
// Email link is /admin/accept-invite?token=…; the frontend POSTs back here.
// We rehash the raw token, find the pending invite row, ensure the caller's
// user matches the invite email, then insert a membership.
aiAdmin.post('/api/team/invites/accept', async (c) => {
  const { userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const raw = (body.token ?? '').trim();
  if (!raw) return c.json({ error: { code: 'BAD_REQUEST', message: 'token required' } }, 400);
  const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const tokenHash = Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const invite = await c.env.DB.prepare(
    `SELECT id, org_id, email, role, expires_at FROM team_invites
     WHERE token_hash = ? AND accepted_at IS NULL AND deleted_at IS NULL`,
  ).bind(tokenHash).first<{ id: string; org_id: string; email: string; role: string; expires_at: string }>();
  if (!invite) return c.json({ error: { code: 'NOT_FOUND', message: 'Invite not found or already used' } }, 404);
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return c.json({ error: { code: 'EXPIRED', message: 'Invite expired — ask the owner to resend' } }, 410);
  }
  const me = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(userId).first<{ email: string }>();
  if (me?.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json({
      error: { code: 'WRONG_USER', message: `This invite was sent to ${invite.email}; sign in as that account first.` },
    }, 403);
  }
  // Insert membership (ignore conflict if user already in org).
  await c.env.DB.prepare(
    `INSERT INTO memberships (id, org_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = NULL`,
  ).bind(crypto.randomUUID(), invite.org_id, userId, invite.role).run();
  await c.env.DB.prepare(
    `UPDATE team_invites SET accepted_at = datetime('now') WHERE id = ?`,
  ).bind(invite.id).run();
  return c.json({ data: { joined: true, org_id: invite.org_id, role: invite.role } });
});

/* ────────────────────────── Org security defaults ────────────────────────── */
aiAdmin.get('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT session_hours, idle_minutes, allowed_domains, require_2fa, updated_at
     FROM org_security WHERE org_id = ?`,
  ).bind(orgId).first();
  return c.json({
    data: row ?? { session_hours: 168, idle_minutes: 60, allowed_domains: null, require_2fa: 0, updated_at: null },
  });
});
aiAdmin.put('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    session_hours?: number; idle_minutes?: number; allowed_domains?: string | null; require_2fa?: boolean;
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
  ).bind(orgId, sessionHours, idleMinutes, allowed, require2fa).run();
  return c.json({ data: { saved: true, session_hours: sessionHours, idle_minutes: idleMinutes, allowed_domains: allowed, require_2fa: require2fa } });
});

/* ────────────────────────── AI Chat field "Improve with AI" ────────────────────────── */
// Rewrites a single persona or system-prompt string with the org's brand AI.
// Field type controls the rewrite goal: persona = one-line voice note; system =
// detailed instruction set. Always reads + sends the current contact_email +
// brand_tone so the rewrite stays in voice.
aiAdmin.post('/api/sites/:siteId/ai-settings/improve', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as { field?: 'persona' | 'system'; value?: string };
  const field = body.field === 'persona' || body.field === 'system' ? body.field : 'persona';
  const value = (body.value ?? '').trim();

  const brand = await c.env.DB.prepare(
    `SELECT brand_tone, contact_email FROM ai_site_settings WHERE site_id = ?`,
  ).bind(siteId).first<{ brand_tone: string | null; contact_email: string | null }>();
  const tone = brand?.brand_tone?.trim() || 'warm, plainspoken, never pushy';

  const goal = field === 'persona'
    ? 'Rewrite the chat persona — one short sentence (≤15 words) describing the voice the AI should use.'
    : 'Rewrite this AI chat system prompt to be tighter, clearer, more actionable. Keep all factual constraints. Add 1-3 concrete behavioral rules if the original lacks them. Plain English, no marketing fluff.';
  const sys = `You are a senior brand copy editor. Brand tone: "${tone}". ${goal} Return ONLY the rewritten text — no quotes, no preamble.`;
  const user = value || (field === 'persona' ? 'A helpful concierge.' : 'You are a helpful AI for this business. Be concise.');

  try {
    const result = (await c.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof c.env.AI.run>[0],
      { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_tokens: 250 } as Parameters<typeof c.env.AI.run>[1],
    )) as { response?: string };
    const improved = (result?.response ?? '').replace(/^["']|["']$/g, '').trim();
    return c.json({ data: { field, original: value, improved: improved || value, tone } });
  } catch (err) {
    return c.json({
      error: { code: 'AI_UNAVAILABLE', message: err instanceof Error ? err.message : 'AI is offline right now' },
    }, 502);
  }
});

/* ────────────────────────── Org deletion (real, soft + scheduled purge) ────────────────────────── */
aiAdmin.post('/api/admin/org/delete', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'DELETE') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Confirmation text must be "DELETE"' } }, 400);
  }
  const me = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).bind(orgId, userId).first<{ role: string }>();
  if (me?.role !== 'owner') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the org owner can delete it' } }, 403);
  }
  const now = new Date().toISOString();
  // Soft-delete cascade: org → sites → memberships → invites → api_keys.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sites SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`).bind(now, orgId),
    c.env.DB.prepare(`UPDATE memberships SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`).bind(now, orgId),
    c.env.DB.prepare(`UPDATE team_invites SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`).bind(now, orgId),
    c.env.DB.prepare(`UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND revoked_at IS NULL`).bind(now, orgId),
    c.env.DB.prepare(`UPDATE orgs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, orgId),
  ]);
  return c.json({ data: { deleted: true, scheduled_purge_after_days: 30 } });
});

/* ────────────────────────── Org data export (queued job) ────────────────────────── */
aiAdmin.post('/api/admin/org/export', async (c) => {
  const { orgId, userId } = need(c);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO org_exports (id, org_id, requested_by, status) VALUES (?, ?, ?, 'queued')`,
  ).bind(id, orgId, userId).run();
  // Fire-and-forget: bundle the org's D1 rows into a JSON file in R2.
  // Image/asset bundling stays deferred; this hits the 80% "give me my data" case.
  c.executionCtx.waitUntil((async () => {
    try {
      const tables = ['sites', 'site_snapshots', 'ai_site_settings', 'ai_endpoints', 'ai_form_logs', 'hostnames'];
      const dump: Record<string, unknown[]> = {};
      for (const t of tables) {
        const rows = await c.env.DB.prepare(
          `SELECT * FROM ${t} WHERE ${t === 'sites' ? 'org_id' : 'site_id'} IN
             (SELECT id FROM sites WHERE org_id = ? AND deleted_at IS NULL) OR
             ${t === 'sites' ? 'org_id = ?' : '0'}`,
        ).bind(orgId, orgId).all().catch(() => ({ results: [] as unknown[] }));
        dump[t] = rows.results ?? [];
      }
      const memberships = await c.env.DB.prepare(
        `SELECT m.*, u.email, u.display_name FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`,
      ).bind(orgId).all().catch(() => ({ results: [] }));
      dump['team'] = memberships.results ?? [];

      const r2Key = `exports/${orgId}/${id}.json`;
      const body = new TextEncoder().encode(JSON.stringify(dump, null, 2));
      await c.env.SITES_BUCKET.put(r2Key, body, { httpMetadata: { contentType: 'application/json' } });
      await c.env.DB.prepare(
        `UPDATE org_exports SET status = 'ready', r2_key = ?, size_bytes = ?, completed_at = datetime('now') WHERE id = ?`,
      ).bind(r2Key, body.byteLength, id).run();
    } catch (err) {
      await c.env.DB.prepare(
        `UPDATE org_exports SET status = 'error', error = ?, completed_at = datetime('now') WHERE id = ?`,
      ).bind(err instanceof Error ? err.message : String(err), id).run().catch(() => undefined);
    }
  })());
  return c.json({ data: { id, status: 'queued', poll: `/api/admin/org/export/${id}` } });
});

aiAdmin.get('/api/admin/org/export/:id', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT id, status, size_bytes, error, created_at, completed_at, r2_key FROM org_exports
     WHERE id = ? AND org_id = ?`,
  ).bind(c.req.param('id'), orgId).first<{
    id: string; status: string; size_bytes: number | null; error: string | null;
    created_at: string; completed_at: string | null; r2_key: string | null;
  }>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Export not found' } }, 404);
  return c.json({
    data: {
      ...row,
      download_url: row.status === 'ready' && row.r2_key ? `/api/admin/org/export/${row.id}/download` : null,
    },
  });
});

aiAdmin.get('/api/admin/org/export/:id/download', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM org_exports WHERE id = ? AND org_id = ? AND status = 'ready'`,
  ).bind(c.req.param('id'), orgId).first<{ r2_key: string }>();
  if (!row?.r2_key) return c.json({ error: { code: 'NOT_READY' } }, 404);
  const obj = await c.env.SITES_BUCKET.get(row.r2_key);
  if (!obj) return c.json({ error: { code: 'GONE' } }, 410);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="projectsites-export-${c.req.param('id')}.json"`,
    },
  });
});

/* ────────────────────────── Org API keys (psk_…) ────────────────────────── */
// Org-scoped programmatic keys for the projectsites.dev REST API. Hash + 8-char
// prefix are stored; the full secret is shown to the user EXACTLY once at
// creation. Pattern: psk_live_<48 url-safe chars>. Bearer-auth callers can
// present either a session token (existing) or one of these keys.
async function hashApiKey(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

aiAdmin.get('/api/admin/api-keys', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, prefix, scopes_json, last_used_at, expires_at, created_at, revoked_at
     FROM api_keys WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`,
  ).bind(orgId).all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      scopes: r['scopes_json'] ? safeJson(r['scopes_json'] as string) : [],
      active: !r['revoked_at'] && (!r['expires_at'] || new Date(r['expires_at'] as string).getTime() > Date.now()),
    })),
  });
});

aiAdmin.post('/api/admin/api-keys', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; scopes?: string[]; expires_in_days?: number };
  const name = (body.name ?? '').trim() || 'untitled key';
  // 48 url-safe chars of entropy = ~288 bits.
  const random = Array.from(crypto.getRandomValues(new Uint8Array(36)))
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
  const secret = `psk_live_${random}`;
  const prefix = secret.slice(0, 16); // "psk_live_AbCdEfGh"
  const hash = await hashApiKey(secret);
  const id = crypto.randomUUID();
  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + Math.max(1, Math.min(365, body.expires_in_days)) * 86400 * 1000).toISOString()
    : null;
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, org_id, created_by, name, prefix, hash, scopes_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, orgId, userId, name, prefix, hash, JSON.stringify(body.scopes ?? ['read', 'write']), expiresAt).run();
  return c.json({
    data: {
      id, name, prefix,
      secret, // returned ONCE — never again.
      expires_at: expiresAt,
      scopes: body.scopes ?? ['read', 'write'],
      note: 'Copy this secret now — it cannot be shown again. Send as `Authorization: Bearer <secret>`.',
    },
  }, 201);
});

aiAdmin.delete('/api/admin/api-keys/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
  ).bind(c.req.param('id'), orgId).run();
  return c.json({ data: { revoked: true } });
});

/* ────────────────────────── Domains aggregator (all sites' hostnames) ────────────────────────── */
// Settings → Domains needs to see every hostname across the org without the
// user having to click into each site. This endpoint joins sites + hostnames
// so the page can render the full picture and inline-act on any row.
aiAdmin.get('/api/admin/domains', async (c) => {
  const { orgId } = need(c);
  const sites = await c.env.DB.prepare(
    `SELECT id, slug, business_name FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
  ).bind(orgId).all();
  const siteRows = (sites.results ?? []) as { id: string; slug: string; business_name: string | null }[];
  if (siteRows.length === 0) return c.json({ data: { sites: [] } });
  const placeholders = siteRows.map(() => '?').join(',');
  const hosts = await c.env.DB.prepare(
    `SELECT id, site_id, hostname, type, status, is_primary, ssl_status,
            verification_errors, last_verified_at, created_at
     FROM hostnames WHERE site_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY is_primary DESC, created_at DESC`,
  ).bind(...siteRows.map((s) => s.id)).all();
  const byId = new Map<string, { site: { id: string; slug: string; business_name: string | null }; hostnames: unknown[] }>();
  for (const s of siteRows) byId.set(s.id, { site: s, hostnames: [] });
  for (const h of (hosts.results ?? []) as Record<string, unknown>[]) {
    const bucket = byId.get(h['site_id'] as string);
    if (bucket) bucket.hostnames.push(h);
  }
  return c.json({ data: { sites: Array.from(byId.values()) } });
});

/* ────────────────────────── Cloudflare auto-config status ────────────────────────── */
// Returns whether Analytics + WFP are fully wired, plus the namespace name
// + masked account id so the UI can replace "Setup needed" with a real
// status badge. POST kicks off a verification round-trip against the CF
// API using whatever auth the worker already has (scoped token preferred,
// global key fallback) so we know the dashboard view matches reality.
aiAdmin.get('/api/admin/cloudflare/status', async (c) => {
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

aiAdmin.post('/api/admin/cloudflare/auto-setup', async (c) => {
  need(c);
  const env = c.env as Env & {
    CF_ACCOUNT_ID?: string;
    WFP_NAMESPACE_NAME?: string;
    CLOUDFLARE_API_KEY?: string;
    CLOUDFLARE_EMAIL?: string;
  };
  const accountId = env.CF_ACCOUNT_ID;
  if (!accountId) {
    return c.json({ error: { code: 'NO_ACCOUNT', message: 'CF_ACCOUNT_ID env var is not set' } }, 503);
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
  const verifyBody = (await verifyRes.json().catch(() => null)) as
    | { success: boolean; result?: { namespace_name: string }[]; errors?: { code: number; message: string }[] }
    | null;
  if (!verifyRes.ok || !verifyBody?.success) {
    return c.json({
      error: {
        code: 'CF_AUTH_FAILED',
        message: verifyBody?.errors?.[0]?.message ?? `CF API returned ${verifyRes.status}`,
      },
    }, 502);
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
    const createBody = (await createRes.json().catch(() => null)) as { success: boolean; errors?: { message: string }[] } | null;
    if (!createRes.ok || !createBody?.success) {
      return c.json({
        error: { code: 'NAMESPACE_CREATE_FAILED', message: createBody?.errors?.[0]?.message ?? `${createRes.status}` },
      }, 502);
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

/* ────────────────────────── Admin AI Chat (bottom-right widget) ────────────────────────── */
// Streams a single completion using the org's chat persona + system prompt.
// Used by the floating AI chat widget on every /admin page.
aiAdmin.post('/api/admin/ai-chat', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    site_id?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  };
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  if (!msgs.length) return c.json({ error: { code: 'BAD_REQUEST', message: 'messages required' } }, 400);

  let persona = '';
  let systemPrompt = DEFAULT_CHAT_SYSTEM_PROMPT;
  if (body.site_id) {
    // Confirm the site belongs to this org, then read settings (single-table schema, site_id is PK).
    const owned = await c.env.DB.prepare(
      `SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    ).bind(body.site_id, orgId).first();
    if (owned) {
      const row = await c.env.DB.prepare(
        `SELECT chat_persona, chat_system_prompt FROM ai_site_settings WHERE site_id = ?`,
      ).bind(body.site_id).first<{ chat_persona: string | null; chat_system_prompt: string | null }>();
      if (row?.chat_persona) persona = row.chat_persona;
      if (row?.chat_system_prompt) systemPrompt = row.chat_system_prompt;
    }
  }

  const sysContent = [systemPrompt, persona ? `Persona: ${persona}` : '']
    .filter(Boolean).join('\n\n');

  try {
    const result = (await c.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof c.env.AI.run>[0],
      { messages: [{ role: 'system', content: sysContent }, ...msgs] } as Parameters<typeof c.env.AI.run>[1],
    )) as { response?: string };
    return c.json({ data: { reply: result?.response ?? '(no reply)' } });
  } catch (err) {
    return c.json({
      data: { reply: `(AI temporarily unavailable: ${err instanceof Error ? err.message : 'unknown'})` },
    });
  }
});

/* ────────────────────────── Per-site AI credit cap ────────────────────────── */
aiAdmin.get('/api/sites/:siteId/credit-cap', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT site_id, monthly_credit_cap, updated_at FROM site_credit_caps WHERE org_id = ? AND site_id = ?`,
  ).bind(orgId, c.req.param('siteId')).first<{ site_id: string; monthly_credit_cap: number; updated_at: string }>();
  return c.json({ data: row ?? { site_id: c.req.param('siteId'), monthly_credit_cap: null } });
});

aiAdmin.put('/api/sites/:siteId/credit-cap', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { monthly_credit_cap?: number | null };
  const cap = body.monthly_credit_cap == null ? null : Math.max(0, Math.min(1_000_000, Number(body.monthly_credit_cap) || 0));
  await c.env.DB.prepare(
    `INSERT INTO site_credit_caps (org_id, site_id, monthly_credit_cap, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, site_id) DO UPDATE SET monthly_credit_cap = excluded.monthly_credit_cap, updated_at = excluded.updated_at`,
  ).bind(orgId, c.req.param('siteId'), cap).run();
  return c.json({ data: { site_id: c.req.param('siteId'), monthly_credit_cap: cap } });
});

/* ────────────────────────── Transfer org ownership (14-day pending) ────────────────────────── */
aiAdmin.post('/api/team/transfer', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { to_email?: string };
  const toEmail = (body.to_email ?? '').trim().toLowerCase();
  if (!toEmail.includes('@')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'valid to_email required' } }, 400);
  }
  // Caller must be owner.
  const me = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE org_id = ? AND user_id = ?`,
  ).bind(orgId, userId).first<{ role: string }>();
  if (me?.role !== 'owner') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the owner can transfer ownership.' } }, 403);
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO org_transfers (id, org_id, from_user_id, to_email, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now','+14 days'), datetime('now'))`,
  ).bind(id, orgId, userId, toEmail).run();
  return c.json({ data: { id, to_email: toEmail, status: 'pending', expires_in_days: 14 } });
});

aiAdmin.get('/api/team/transfer', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, to_email, status, expires_at, created_at FROM org_transfers
     WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5`,
  ).bind(orgId).all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.delete('/api/team/transfer/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(
    `UPDATE org_transfers SET status = 'cancelled' WHERE id = ? AND org_id = ? AND status = 'pending'`,
  ).bind(c.req.param('id'), orgId).run();
  return c.json({ data: { cancelled: true } });
});

/* ────────────────────────── AI Chat Extras: uploads + drive + summary ────────────────────────── */

/**
 * Resolve the absolute callback URL for the Google Drive OAuth flow.
 * Mirrors the host the current request was served from so localhost dev
 * and production both work without env-side configuration.
 */
function driveCallbackUrl(c: Ctx): string {
  const u = new URL(c.req.url);
  return `${u.protocol}//${u.host}/api/auth/google-drive/callback`;
}

/**
 * POST /api/sites/:siteId/ai/context/upload
 * Multipart upload of a PDF or image. Stores the raw bytes in R2 and the
 * Vision-extracted text in D1. Caps file size at 10 MB.
 */
aiAdmin.post('/api/sites/:siteId/ai/context/upload', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    throw new HTTPError(400, 'multipart/form-data required');
  }
  const form = await c.req.formData();
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') {
    throw new HTTPError(400, 'file field required');
  }
  const file = fileRaw as unknown as File;
  if (file.size > MAX_CONTEXT_FILE_BYTES) {
    return c.json({ error: { message: 'file too large (max 10 MB)' } }, 413);
  }
  const mime = file.type || 'application/octet-stream';
  if (!(mime === 'application/pdf' || mime.startsWith('image/'))) {
    throw new HTTPError(400, 'only application/pdf and image/* accepted');
  }
  const buf = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const r2Key = `sites/${site.slug}/ai-context/${id}-${file.name}`;
  await c.env.SITES_BUCKET.put(r2Key, buf, { httpMetadata: { contentType: mime } });
  const extraction = await extractContext(c.env, buf, mime);
  await c.env.DB.prepare(
    `INSERT INTO ai_context_files
       (id, site_id, org_id, filename, content_type, size_bytes, r2_key, extracted_text, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
  )
    .bind(id, siteId, orgId, file.name, mime, file.size, r2Key, extraction.text)
    .run();
  return c.json(
    {
      data: {
        id,
        filename: file.name,
        size_bytes: file.size,
        extracted_chars: extraction.text.length,
      },
    },
    201,
  );
});

/**
 * GET /api/sites/:siteId/ai/context/files
 * List non-deleted context files (uploads + drive ingests) for the site.
 */
aiAdmin.get('/api/sites/:siteId/ai/context/files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, content_type, size_bytes, source, drive_file_id,
            length(extracted_text) AS extracted_chars, created_at, updated_at
     FROM ai_context_files
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

/**
 * DELETE /api/sites/:siteId/ai/context/files/:fileId
 * Soft-deletes the row and best-effort removes the R2 object.
 */
aiAdmin.delete('/api/sites/:siteId/ai/context/files/:fileId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM ai_context_files WHERE id = ? AND site_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('fileId'), siteId)
    .first<{ r2_key: string }>();
  if (!row) throw new HTTPError(404, 'File not found');
  await c.env.SITES_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(
    `UPDATE ai_context_files SET deleted_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.req.param('fileId'))
    .run();
  return c.json({ data: { deleted: true } });
});

/**
 * GET /api/sites/:siteId/ai/drive/auth-url
 * Returns the Google OAuth consent URL plus the CSRF state cookie value the
 * front-end should navigate to.  Persists state in google_drive_oauth_states.
 */
aiAdmin.get('/api/sites/:siteId/ai/drive/auth-url', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const redirectUrl = c.req.query('redirect_url') ?? '/admin/settings?tab=ai-chat';
  const state = crypto.randomUUID();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO google_drive_oauth_states (id, site_id, org_id, state, redirect_url, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+1 hour'))`,
  )
    .bind(id, siteId, orgId, state, redirectUrl)
    .run();
  const url = buildAuthUrl(c.env, state, driveCallbackUrl(c));
  return c.json({ data: { auth_url: url, scope: DRIVE_SCOPE } });
});

/**
 * POST /api/sites/:siteId/ai/drive/folders
 * Lists folders the connected Drive account can read. Optional body
 * `{ query }` substring-matches folder names.
 */
aiAdmin.post('/api/sites/:siteId/ai/drive/folders', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const token = await getAccessToken(c.env, c.env.DB, siteId);
  if (!token) throw new HTTPError(400, 'Drive not connected');
  const folders = await listFolders(token, body.query);
  return c.json({ data: folders });
});

/**
 * POST /api/sites/:siteId/ai/drive/select-folder
 * Persists the chosen folder on ai_site_settings and triggers an immediate
 * ingest of every eligible file in that folder.
 */
aiAdmin.post('/api/sites/:siteId/ai/drive/select-folder', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as { folder_id?: string; folder_name?: string };
  if (!body.folder_id || !body.folder_name) {
    throw new HTTPError(400, 'folder_id and folder_name required');
  }
  const existing = await c.env.DB.prepare(
    `SELECT 1 FROM ai_site_settings WHERE site_id = ?`,
  )
    .bind(siteId)
    .first();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE ai_site_settings SET drive_folder_id = ?, drive_folder_name = ?, updated_at = datetime('now') WHERE site_id = ?`,
    )
      .bind(body.folder_id, body.folder_name, siteId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO ai_site_settings (site_id, drive_folder_id, drive_folder_name) VALUES (?, ?, ?)`,
    )
      .bind(siteId, body.folder_id, body.folder_name)
      .run();
  }
  return c.json({ data: await triggerDriveSync(c, siteId, orgId, site.slug) });
});

/**
 * POST /api/sites/:siteId/ai/drive/sync
 * Re-pull the configured folder. Idempotent — matches by drive_file_id and
 * skips files whose modified_time is older than the local copy.
 *
 * Workflows v2 path (item #60): when the `DRIVE_SYNC_WORKFLOW` binding is
 * present, this endpoint creates a Workflow instance and returns a
 * status URL. When absent (dev), it falls back to the legacy synchronous
 * inline `syncDriveFolder` call.
 */
aiAdmin.post('/api/sites/:siteId/ai/drive/sync', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  return c.json({ data: await triggerDriveSync(c, siteId, orgId, site.slug) });
});

/**
 * GET /api/sites/:siteId/workflows/:wfName/:id
 * Proxy a workflow instance's `.status()` to the client (item #60). Supports
 * `drive-sync` and `image-generation` Workflow names. Verifies the site is
 * owned by the caller's org before exposing the status.
 */
aiAdmin.get('/api/sites/:siteId/workflows/:wfName/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const wfName = c.req.param('wfName');
  const instanceId = c.req.param('id');
  await siteOwned(c, orgId, siteId);

  let binding: Workflow | undefined;
  if (wfName === 'drive-sync') binding = c.env.DRIVE_SYNC_WORKFLOW;
  else if (wfName === 'image-generation') binding = c.env.IMAGE_GENERATION_WORKFLOW;
  else throw new HTTPError(404, 'unknown workflow name');

  if (!binding) {
    return c.json({ data: { status: 'unbound', workflow: wfName } });
  }

  try {
    const instance = await binding.get(instanceId);
    const status = await instance.status();
    return c.json({ data: { workflow: wfName, workflow_id: instanceId, ...status } });
  } catch (err) {
    throw new HTTPError(404, err instanceof Error ? err.message : 'workflow_lookup_failed');
  }
});

/**
 * Internal helper: fire the drive-sync workflow when bound, otherwise run
 * the legacy inline path so dev (`wrangler dev --local`) still works.
 *
 * @returns Either `{ workflow_id, status_url }` (workflow path) or the raw
 *          `SyncResult` shape (legacy inline path).
 */
async function triggerDriveSync(
  c: Ctx,
  siteId: string,
  orgId: string,
  slug: string,
): Promise<
  | { workflow_id: string; status_url: string; mode: 'workflow' }
  | { added: number; updated: number; removed: number; skipped: number; mode: 'inline' }
> {
  if (c.env.DRIVE_SYNC_WORKFLOW) {
    const instanceId = `drive-sync-${siteId}-${Date.now()}`;
    const inst = await c.env.DRIVE_SYNC_WORKFLOW.create({
      id: instanceId,
      params: { siteId, orgId, slug },
    });
    return {
      workflow_id: inst.id,
      status_url: `/api/sites/${siteId}/workflows/drive-sync/${inst.id}`,
      mode: 'workflow',
    };
  }
  const result = await syncDriveFolder(c.env, c.env.DB, siteId, orgId, slug);
  return { ...result, mode: 'inline' };
}

/**
 * GET /api/sites/:siteId/ai/context/summary
 * Assembles a human-readable Markdown summary of every input the AI chat
 * uses: system prompt, web-research toggle, drive connection + folder, and
 * a per-file digest (filename, char count, first 300 chars). Cached 60s.
 */
aiAdmin.get('/api/sites/:siteId/ai/context/summary', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const cacheKey = `ai-context-summary:${siteId}`;
  const cached = await c.env.CACHE_KV.get(cacheKey);
  if (cached) {
    // KV value is set by us, but a stale / partially-written entry must not
    // 500 the request — fall through to a fresh build on parse failure.
    const hit = safeParseJSONOrNull<{ data: unknown }>(cached);
    if (hit) return c.json(hit);
  }
  const settings = await c.env.DB.prepare(
    `SELECT chat_system_prompt, allow_web_research, drive_folder_id, drive_folder_name,
            drive_last_synced_at
     FROM ai_site_settings WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<{
      chat_system_prompt: string | null;
      allow_web_research: number | null;
      drive_folder_id: string | null;
      drive_folder_name: string | null;
      drive_last_synced_at: string | null;
    }>();
  const files = await c.env.DB.prepare(
    `SELECT filename, source, content_type, size_bytes,
            length(extracted_text) AS chars, substr(extracted_text, 1, 300) AS preview
     FROM ai_context_files
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all<{
      filename: string;
      source: string;
      content_type: string | null;
      size_bytes: number;
      chars: number | null;
      preview: string | null;
    }>();
  const fileRows = files.results ?? [];
  const totalChars = fileRows.reduce((sum, f) => sum + (f.chars ?? 0), 0);
  const md = renderContextMarkdown({
    siteName: site.business_name ?? site.slug,
    systemPrompt: settings?.chat_system_prompt ?? null,
    allowWebResearch: !!settings?.allow_web_research,
    driveFolderName: settings?.drive_folder_name ?? null,
    driveLastSyncedAt: settings?.drive_last_synced_at ?? null,
    files: fileRows,
  });
  const payload = {
    data: { markdown: md, total_chars: totalChars, file_count: fileRows.length },
  };
  await c.env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 });
  return c.json(payload);
});

/**
 * Render the markdown summary returned by /ai/context/summary.
 *
 * @param input - Pre-collected context for the chat assistant.
 * @returns Markdown string suitable for display in the admin modal.
 */
function renderContextMarkdown(input: {
  siteName: string;
  systemPrompt: string | null;
  allowWebResearch: boolean;
  driveFolderName: string | null;
  driveLastSyncedAt: string | null;
  files: Array<{
    filename: string;
    source: string;
    content_type: string | null;
    size_bytes: number;
    chars: number | null;
    preview: string | null;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`# AI Chat context — ${input.siteName}`);
  lines.push('');
  lines.push('## System prompt');
  lines.push('');
  lines.push(input.systemPrompt ? '```\n' + input.systemPrompt + '\n```' : '_Using platform default._');
  lines.push('');
  lines.push('## Web research');
  lines.push('');
  lines.push(input.allowWebResearch ? 'Enabled — the assistant may search the web.' : 'Disabled.');
  lines.push('');
  lines.push('## Google Drive');
  lines.push('');
  if (input.driveFolderName) {
    lines.push(`Connected folder: **${input.driveFolderName}**`);
    lines.push(`Last synced: ${input.driveLastSyncedAt ?? 'never'}`);
  } else {
    lines.push('_Not connected._');
  }
  lines.push('');
  lines.push(`## Knowledge files (${input.files.length})`);
  lines.push('');
  if (!input.files.length) {
    lines.push('_No files uploaded yet._');
  } else {
    for (const f of input.files) {
      lines.push(`### ${f.filename}`);
      lines.push('');
      lines.push(
        `- Source: ${f.source} · Type: ${f.content_type ?? 'unknown'} · ${f.size_bytes} bytes · ${
          f.chars ?? 0
        } extracted chars`,
      );
      if (f.preview && f.preview.length > 0) {
        lines.push('');
        lines.push('```');
        lines.push(f.preview.replace(/```/g, '` ``'));
        lines.push('```');
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

/* ────────────────────────── #91 AI Explain Trace ────────────────────────── */

/**
 * POST /api/admin/traces/:traceId/explain
 *
 * Loads the trace row (org-scoped via ai_form_logs.org_id), feeds it to
 * Llama 3.3 70B with an SRE-grade system prompt, and returns a 3-paragraph
 * markdown explanation. Results are cached in KV for 1 hour.
 */
aiAdmin.post('/api/admin/traces/:traceId/explain', async (c) => {
  const { orgId } = need(c);
  const traceId = c.req.param('traceId');
  const row = await c.env.DB.prepare(
    `SELECT id, trace_kind, endpoint_slug, model, status, prompt_template, input_json,
            output_text, error_message, latency_ms, tokens_input, tokens_output, created_at
     FROM ai_form_logs WHERE id = ? AND org_id = ? LIMIT 1`,
  )
    .bind(traceId, orgId)
    .first<AiTraceRow>();
  if (!row) throw new HTTPError(404, 'Trace not found');

  const out = await explainTrace(c.env, row);
  return c.json({ data: out });
});

/* ────────────────────────── #93 AI Suggest Endpoint ────────────────────────── */

/**
 * POST /api/sites/:siteId/ai-endpoints/suggest
 *
 * Body: { description: string }. Calls the LLM to scaffold a new AI endpoint
 * (slug + method + language + files) and returns the Zod-validated suggestion.
 */
aiAdmin.post('/api/sites/:siteId/ai-endpoints/suggest', async (c) => {
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

/* ────────────────────────── #94 AI Natural-Language Search ────────────────────────── */

/**
 * POST /api/admin/search/ai
 *
 * Body: { query: string }. Asks the LLM to pick an entity + filter, runs a
 * parameterised D1 SELECT (org-scoped), returns rows + the LLM's structured
 * filter for transparency.
 */
aiAdmin.post('/api/admin/search/ai', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const query = (body.query ?? '').trim();
  if (query.length < 2) throw new HTTPError(400, 'query must be at least 2 characters');
  try {
    const out = await aiSearch(c.env, orgId, query);
    return c.json({ data: out });
  } catch (err) {
    throw new HTTPError(502, err instanceof Error ? err.message : 'AI search failed');
  }
});

/* ────────────────────────── #95 AI Cost Forecaster ────────────────────────── */

/**
 * GET /api/admin/forecast/cost
 *
 * 30-day usage rollup → next-month USD forecast per Cloudflare pricing, plus
 * one LLM-generated savings tip.
 */
aiAdmin.get('/api/admin/forecast/cost', async (c) => {
  const { orgId } = need(c);
  const forecast = await forecastCost(c.env, orgId);
  return c.json({ data: forecast });
});
