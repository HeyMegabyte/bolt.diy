/**
 * @module libs/features/audit_logs/handlers
 *
 * @description
 * Audit-log read + editor-error ingest surface. The GET lists the caller's
 * org audit rows (dashboard activity feed + `/admin/audit` grid) with optional
 * per-site scoping (`site_id` / `site_slug`), a LEFT JOIN to resolve each row's
 * `site` slug, and a true unpaginated `COUNT(*)` so the grid can page past the
 * 500-row cap without silently hiding compliance/security records. The POST
 * records a runtime error surfaced inside the bolt.diy editor iframe
 * (`postMessage` `PS_ERROR`) into the same `audit_logs` table with
 * `action='editor.runtime_error'`, preserving the full stack in
 * `metadata_json`. Both are org-scoped via `c.get('orgId')`; cross-tenant rows
 * are never returned or written.
 *
 * | Method | Path                          | Auth  | Purpose                                          |
 * | ------ | ----------------------------- | ----- | ------------------------------------------------ |
 * | GET    | /api/audit-logs               | orgId | List org audit rows (+optional site scope, paged) |
 * | POST   | /api/audit-logs/editor-error  | orgId | Record a bolt.diy editor runtime error           |
 * | GET    | /api/audit/rows               | orgId | Filtered audit feed (action/actor/target/from/to) |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 13) — only the route-registration receiver changed (`api.` → `auditLogs.`);
 * the handler bodies are byte-for-byte unchanged. The GET reads via `dbQueryOne`
 * + raw parameterized `c.env.DB.prepare(...)`; the POST fires
 * `auditService.writeAuditLog`. Known AppErrors (`unauthorized`) propagate to
 * the app-level error handler; the POST returns its own 401/403 envelopes for
 * missing identity.
 *
 * `GET /api/audit/rows` (the ag-grid-friendly filtered feed) was additionally
 * folded BYTE-VERBATIM from the `ai_admin.ts` monolith (installment 14). It keeps
 * ai_admin's local scaffolding (`HTTPError` / `need(c)` / `safeJson` / this
 * module's `onError`) so its 401 `{ error: { message: 'Authentication required' } }`
 * gate stays byte-identical to the ai_admin surface it came from.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const auditLogs = new Hono<AppContext>();

/**
 * List recent audit log entries scoped to the caller's org. Powers the
 * dashboard activity feed and the `/admin/audit` ag-grid view.
 *
 * @route GET /api/audit-logs
 * @auth Bearer — `orgId` MUST resolve
 * @queryParam limit — default 50, capped at 500 (raised from 200 to satisfy
 *   the admin audit grid which preloads the latest 500 rows for client-side
 *   filtering)
 * @queryParam offset — default 0, floored at 0 (negative values clamped)
 * @queryParam site_id — optional. When supplied, narrows the result set to
 *   rows where `target_id = site_id` OR `metadata_json` contains
 *   `"site_id":"<site_id>"`.
 * @queryParam site_slug — optional. Resolved to `site_id` (org-scoped) before
 *   filtering. Non-resolving slug → empty result set (never "all rows").
 * @returns 200 OK `{ data: AuditLog[], meta: { limit, offset, total, has_more } }`
 *   — org-scoped, ordered by `created_at DESC`, `site` slug resolved per row.
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Org-scoped read: cross-tenant rows are never returned (org_id filter
 * applied inline). The audit log is append-only — these rows are never
 * mutated, only inserted by `auditService.writeAuditLog` fire-and-forget
 * across the codebase. The `site` field is computed via a LEFT JOIN against
 * `sites` on the most common linkage (`target_id`) plus a metadata fallback
 * parsed in-Worker so a single JSON column scan covers both shapes.
 *
 * Parameterized SQL throughout — `site_slug` flows into the JOIN predicate
 * and `site_id` (or the resolved slug → id) flows into the WHERE clause via
 * bound params, never string concatenation.
 *
 * @example
 * ```bash
 * # All audit rows for the caller's org (capped at 500)
 * curl -H "Authorization: Bearer $TOKEN" \
 *   https://projectsites.dev/api/audit-logs
 *
 * # Scoped to a single site by slug (UI default)
 * curl -H "Authorization: Bearer $TOKEN" \
 *   "https://projectsites.dev/api/audit-logs?site_slug=vitos-mens-salon"
 * ```
 *
 * @see {@link auditService.getAuditLogs}
 */
auditLogs.get('/api/audit-logs', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '500'), 1), 500);
  const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);
  const siteIdParam = (c.req.query('site_id') ?? '').trim() || null;
  const siteSlugParam = (c.req.query('site_slug') ?? '').trim() || null;

  // Resolve `site_slug` → `site_id` (org-scoped — never trust the slug to
  // belong to the caller's org without proof). If a site_id was supplied
  // directly, it wins and we skip the slug lookup.
  let scopedSiteId: string | null = siteIdParam;
  if (!scopedSiteId && siteSlugParam) {
    const siteRow = await dbQueryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM sites WHERE org_id = ? AND slug = ? LIMIT 1',
      [orgId, siteSlugParam],
    );
    scopedSiteId = siteRow?.id ?? null;
    // If the slug doesn't resolve to a site in this org, return empty —
    // never fall back to "all rows" (would be a tenant-isolation leak). Carry the
    // `meta` envelope so the FE contract is uniform (total 0, no more pages).
    if (!scopedSiteId)
      return c.json({ data: [], meta: { limit, offset, total: 0, has_more: false } });
  }

  // Build SQL with optional site scope. The LEFT JOIN populates `site` for
  // every row (slug if linked, null if org-level). We use the JOIN's slug
  // column when present and parse `metadata_json.site_id` in JS as a
  // fallback so hostname/billing events still surface their site context.
  const baseSql = `
    SELECT a.id, a.action, a.message, a.target_type, a.target_id, a.actor_id,
           a.metadata_json, a.request_id, a.created_at, s.slug AS site_slug
    FROM audit_logs a
    LEFT JOIN sites s ON s.id = a.target_id AND s.org_id = a.org_id
    WHERE a.org_id = ?
  `;
  const params: (string | number)[] = [orgId];
  let scopedSql = baseSql;
  if (scopedSiteId) {
    scopedSql += ` AND (a.target_id = ? OR a.metadata_json LIKE ?)`;
    params.push(scopedSiteId, `%"site_id":"${scopedSiteId}"%`);
  }
  scopedSql += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rs = await c.env.DB.prepare(scopedSql)
    .bind(...params)
    .all<{
      id: string;
      action: string;
      message: string | null;
      target_type: string | null;
      target_id: string | null;
      actor_id: string | null;
      metadata_json: string | null;
      request_id: string | null;
      created_at: string;
      site_slug: string | null;
    }>();

  // If we scoped by site_id but the JOIN didn't fire for metadata-only
  // rows, resolve the slug once and stamp it on every row in this scope.
  let scopedSlug: string | null = null;
  if (scopedSiteId) {
    const s = await dbQueryOne<{ slug: string }>(
      c.env.DB,
      'SELECT slug FROM sites WHERE id = ? AND org_id = ? LIMIT 1',
      [scopedSiteId, orgId],
    );
    scopedSlug = s?.slug ?? null;
  }

  const data = (rs.results ?? []).map((r) => {
    let metadata: Record<string, unknown> | null = null;
    if (r.metadata_json) {
      try {
        metadata = JSON.parse(r.metadata_json) as Record<string, unknown>;
      } catch {
        metadata = null;
      }
    }
    // Site resolution priority: JOIN hit > metadata.site_slug > scopedSlug
    // (when the request itself was site-scoped). Null for org-level rows.
    let site: string | null = r.site_slug;
    if (!site && metadata && typeof metadata['site_slug'] === 'string') {
      site = metadata['site_slug'] as string;
    }
    if (!site && scopedSlug) site = scopedSlug;
    return {
      id: r.id,
      action: r.action,
      // The human-readable statement written at audit time (e.g. "MCP 'resend'
      // disconnected from site 'vito-salon'"). Was omitted from the SELECT, so the
      // forensics grid always fell back to the generic humanized action — the rich
      // message (already shown on the dashboard) never reached the audit view.
      message: r.message ?? null,
      target_type: r.target_type,
      target_id: r.target_id,
      actor_id: r.actor_id,
      metadata,
      request_id: r.request_id,
      created_at: r.created_at,
      site,
    };
  });

  // Aggregate stats over the FULL matching set (NOT the ≤500-row page) so the admin's
  // stat cards show TRUE totals. Computing `unique_actions` / `actors` / `last_24h`
  // client-side over the loaded 500 rows silently UNDERCOUNTS once an org logs >500
  // events (e.g. "Last 24h: 500" displayed while 1338 real events occurred in 24h) —
  // a lying-number that violates display==store. `total` (unpaginated COUNT) also lets
  // the grid page past the 500 cap without hiding compliance/security records.
  const statsWhere = scopedSiteId
    ? `a.org_id = ? AND (a.target_id = ? OR a.metadata_json LIKE ?)`
    : `a.org_id = ?`;
  const statsParams: (string | number)[] = scopedSiteId
    ? [orgId, scopedSiteId, `%"site_id":"${scopedSiteId}"%`]
    : [orgId];
  const statsRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT a.action) AS unique_actions,
            COUNT(DISTINCT a.actor_id) AS actors,
            SUM(CASE WHEN a.created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last_24h
     FROM audit_logs a WHERE ${statsWhere}`,
  )
    .bind(...statsParams)
    .first<{ total: number; unique_actions: number; actors: number; last_24h: number }>();
  const total = Number(statsRow?.total ?? data.length);

  return c.json({
    data,
    meta: {
      limit,
      offset,
      total,
      has_more: offset + data.length < total,
      // True org-wide (or site-scoped) aggregates so the FE stat cards never
      // undercount from the loaded page. See the FE audit.component fallback.
      stats: {
        unique_actions: Number(statsRow?.unique_actions ?? 0),
        actors: Number(statsRow?.actors ?? 0),
        last_24h: Number(statsRow?.last_24h ?? 0),
      },
    },
  });
});

/**
 * POST /api/audit-logs/editor-error — record a runtime error surfaced
 * inside the bolt.diy iframe via postMessage `PS_ERROR`.
 *
 * Writes to `audit_logs` with `action: 'editor.runtime_error'` and
 * preserves the full stack in `metadata_json` so the admin's audit grid
 * surfaces it alongside the rest of the lifecycle events.
 *
 * @auth Required — userId + orgId must resolve.
 */
auditLogs.post('/api/audit-logs/editor-error', async (c) => {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const userId = c.get('userId');
  const orgId = c.get('orgId');

  if (!userId) {
    return c.json(
      {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId },
      },
      401,
    );
  }

  if (!orgId) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Org context required', request_id: requestId } },
      403,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    stack?: string;
    file?: string;
    line?: number;
    requestId?: string;
    siteId?: string;
    slug?: string;
  };

  const message = (body.message ?? 'Unknown editor error').slice(0, 500);
  const code = (body.code ?? 'editor.runtime_error').slice(0, 100);

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'editor.runtime_error',
    message: `Editor runtime error: ${message}`,
    target_type: body.siteId ? 'site' : 'editor',
    target_id: body.siteId ?? undefined,
    metadata_json: {
      code,
      stack: body.stack?.slice(0, 4000),
      file: body.file?.slice(0, 500),
      line: body.line,
      slug: body.slug,
      client_request_id: body.requestId,
    },
    request_id: requestId,
  });

  return c.json({ data: { recorded: true } });
});

/* ────────────────────────── Audit feed (folded from ai_admin.ts, installment 14) ────────────────────────── */
// `GET /api/audit/rows` was moved BYTE-VERBATIM from `routes/ai_admin.ts`. It keeps
// ai_admin's local auth + error scaffolding (`HTTPError` / `need` / `safeJson` /
// this module's `onError`) so its 401 `{ error: { message: 'Authentication
// required' } }` gate + generic-500 behavior are identical to the ai_admin surface.

type Ctx = Context<AppContext>;

class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

auditLogs.onError((err, c) => {
  // Only the folded-in `GET /api/audit/rows` route throws HTTPError — render its
  // intentional envelope here (byte-identical to ai_admin's onError). Anything else
  // (the shared AppError/ZodError thrown by the ORIGINAL /api/audit-logs routes
  // above) must propagate UNCHANGED to the app-level errorHandler, so re-throw it —
  // else this handler would swallow those routes' 401 envelopes into a generic 500.
  if (err instanceof HTTPError) {
    return c.json({ error: { message: err.message } }, err.status as 400);
  }
  throw err;
});

function need(c: Ctx): { orgId: string; userId: string } {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new HTTPError(401, 'Authentication required');
  return { orgId, userId };
}

function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * `GET /api/audit/rows` — Paginated audit log feed for the caller's org.
 *
 * @remarks
 * Query params: `limit` (default 100, max 500), `action`, `actor_id`,
 * `target_type`, `from`, `to` (ISO timestamps). Append-only — audit rows
 * are never editable or deletable through this surface.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
auditLogs.get('/api/audit/rows', async (c) => {
  const { orgId } = need(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  // Honor the documented filter params (action / actor_id / target_type / from / to).
  // Each is optional and additive — the feed stays org-scoped; omitted filters are no-ops.
  // Previously these were documented but never bound into WHERE (accepted-but-ignored
  // filter drift): a caller narrowing to one action silently got the whole feed.
  const where: string[] = ['org_id = ?'];
  const binds: unknown[] = [orgId];
  const action = c.req.query('action');
  if (action) {
    where.push('action = ?');
    binds.push(action);
  }
  const actorId = c.req.query('actor_id');
  if (actorId) {
    where.push('actor_id = ?');
    binds.push(actorId);
  }
  const targetType = c.req.query('target_type');
  if (targetType) {
    where.push('target_type = ?');
    binds.push(targetType);
  }
  const from = c.req.query('from');
  if (from) {
    where.push('created_at >= ?');
    binds.push(from);
  }
  const to = c.req.query('to');
  if (to) {
    where.push('created_at <= ?');
    binds.push(to);
  }
  binds.push(limit);
  const rows = await c.env.DB.prepare(
    `SELECT id, action, message, target_type, target_id, actor_id, metadata_json, request_id, created_at
     FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(...binds)
    .all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      metadata: safeJson(r['metadata_json'] as string | null),
    })),
  });
});
