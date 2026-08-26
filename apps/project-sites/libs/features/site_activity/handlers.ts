/**
 * @module libs/features/site_activity/handlers
 *
 * @description
 * Hono routes for a site's **per-site, read-only activity**: contact-form
 * submissions and AI operation logs. This module backs BOTH the admin **Forms**
 * view (the `form_submissions` table — the owner's lead inbox) AND the admin
 * **AI-Logs** view (the `ai_form_logs` trace table — router/chat/endpoint/tool
 * calls), each list + single-row. Every route requires both an `orgId` and a
 * `userId` on the request context — the {@link need} helper throws
 * `HTTPError(401)` when either is missing — and guards site ownership through
 * {@link siteOwned} (404, never 403, on a missing/foreign site so cross-org
 * sites never leak).
 *
 * | Method | Path                                           | Auth         | Purpose                                                     |
 * | ------ | ---------------------------------------------- | ------------ | ---------------------------------------------------------- |
 * | GET    | /api/sites/:siteId/form-submissions            | orgId+userId | List recent contact-form submissions (paged, true total)   |
 * | GET    | /api/sites/:siteId/form-submissions/:subId     | orgId+userId | Single submission + its AI form logs                       |
 * | GET    | /api/sites/:siteId/ai-logs                      | orgId+userId | List AI trace rows (LLM/tool/router, paged, true total)    |
 * | GET    | /api/sites/:siteId/ai-logs/:logId               | orgId+userId | Single AI trace row (full input/output + timing)           |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 19) — only the route-registration receiver changed (`aiAdmin.` →
 * `siteActivity.`); the handler bodies are byte-for-byte unchanged. The module
 * imports its error/auth scaffolding (the `HTTPError` class, the `need(c)` /
 * `siteOwned(...)` helpers, the `safeJson` parser, and a byte-identical
 * `onError`) from the SHARED `src/lib/ai_admin_kit.ts` kit — no local copies — so
 * behavior is identical: it contains ONLY these ai_admin-sourced routes, so exact
 * reproduction = byte-identical behavior. All four routes are read-only `GET`s
 * with no request body, so there is no `schemas.ts` — query/param handling is
 * byte-identical to the original.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { HTTPError, need, siteOwned, safeJson, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteActivity = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · siteOwned · safeJson · onError) is
// shared via src/lib/ai_admin_kit.ts — imported above (route-decomposition
// installment 19). Byte-identical behavior to the ai_admin.ts inline copies; see
// the kit module doc for the siteOwned-vs-requireOwnedSite rationale.
siteActivity.onError(aiAdminOnError);

/* ────────────────────────── Form Submissions + AI Logs ────────────────────────── */

/**
 * `GET /api/sites/:siteId/form-submissions` — List up to 200 most recent form
 * submissions for the requested site.
 *
 * @remarks
 * Requires org membership of the site's owning org. Returns each submission
 * with `fields` parsed from the stored JSON payload.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 *
 * @see {@link siteActivity.get('/api/sites/:siteId/form-submissions/:subId')}
 */
siteActivity.get('/api/sites/:siteId/form-submissions', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const rows = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, created_at
     FROM form_submissions WHERE site_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(siteId, limit, offset)
    .all<Record<string, unknown>>();
  // True count so a business owner can reach EVERY lead (offset-page) and the
  // count pill shows the real total — a hardcoded LIMIT with no total silently
  // hides leads (= revenue) past the cap once a site gets popular.
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM form_submissions WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<{ n: number }>();
  const data = (rows.results ?? []).map((r) => ({
    ...r,
    fields: safeJson(r['payload'] as string),
  }));
  const total = Number(countRow?.n ?? data.length);
  return c.json({
    data,
    meta: { limit, offset, total, has_more: offset + data.length < total },
  });
});

/**
 * `GET /api/sites/:siteId/form-submissions/:subId` — Fetch a single form
 * submission by id with parsed `fields`.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the submission doesn't exist on that site.
 */
siteActivity.get('/api/sites/:siteId/form-submissions/:subId', async (c) => {
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

/**
 * `GET /api/sites/:siteId/ai-logs?kind=&limit=` — List recent AI trace rows
 * for a site (LLM calls, tool calls, router decisions).
 *
 * @remarks
 * `kind` optionally filters by `trace_kind` (`router`, `chat`, `endpoint`,
 * etc.); `limit` is clamped to 1000 and defaults to 200. Each row is a
 * lightweight summary with `output_preview` truncated to 200 chars.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 *
 * @see {@link siteActivity.get('/api/sites/:siteId/ai-logs/:logId')}
 */
siteActivity.get('/api/sites/:siteId/ai-logs', async (c) => {
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
  const list = rows.results ?? [];
  // TRUE count (respecting the same `kind` filter) so the admin "Calls" stat can't
  // under-report once a site's AI traces exceed the page cap — mirrors
  // form-submissions + /logs + audit-logs. A hardcoded LIMIT with no total silently
  // hides calls (cost/debugging signal) on any active AI site.
  const countStmt = kind
    ? c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ai_form_logs WHERE site_id = ? AND trace_kind = ?`,
      ).bind(siteId, kind)
    : c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ai_form_logs WHERE site_id = ?`).bind(siteId);
  const countRow = await countStmt.first<{ n: number }>();
  const total = Number(countRow?.n ?? list.length);
  return c.json({ data: list, meta: { limit, total, has_more: list.length < total } });
});

/**
 * `GET /api/sites/:siteId/ai-logs/:logId` — Fetch a single AI trace row
 * including full input/output text and timing breakdown.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the log row doesn't exist on that site.
 */
siteActivity.get('/api/sites/:siteId/ai-logs/:logId', async (c) => {
  const { orgId } = need(c);
  await siteOwned(c, orgId, c.req.param('siteId'));
  const row = await c.env.DB.prepare(`SELECT * FROM ai_form_logs WHERE id = ? AND site_id = ?`)
    .bind(c.req.param('logId'), c.req.param('siteId'))
    .first();
  if (!row) throw new HTTPError(404, 'Log not found');
  return c.json({ data: row });
});
