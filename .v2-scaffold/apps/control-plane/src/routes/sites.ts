/**
 * Sites + hostnames. Create-from-search provisions a per-tenant D1 via the CF API
 * + queues the site-generation workflow.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import { provisionTenantD1, attachCustomHostname } from '../services/cloudflare.js';
import { aiTextCompletion } from '../services/ai-gateway.js';

interface SiteRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  status: string;
  primary_hostname: string | null;
  d1_database_id: string | null;
  worker_name: string | null;
  created_at: string;
  updated_at: string;
}

const app = new Hono<HonoEnv>();

// Loose context typing keeps the helper reusable across Hono handlers;
// the actual c.get() / c.req types are enforced at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireTenant(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

app.get('/', async (c) => {
  const tenantId = requireTenant(c);
  const rows = await dbQuery<SiteRow>(
    c.env.DB,
    `SELECT id, tenant_id, slug, name, status, primary_hostname, d1_database_id, worker_name, created_at, updated_at
     FROM sites WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [tenantId],
  );
  return c.json({ sites: rows });
});

app.get('/:id', async (c) => {
  const tenantId = requireTenant(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<SiteRow>(
    c.env.DB,
    `SELECT id, tenant_id, slug, name, status, primary_hostname, d1_database_id, worker_name, created_at, updated_at
     FROM sites WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'site');
  return c.json(row);
});

app.post(
  '/from-search',
  zValidator(
    'json',
    z.object({
      query: z.string().min(2).max(200),
      slug: z
        .string()
        .min(2)
        .max(63)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
      site_type: z
        .enum([
          'software',
          'local-business',
          'nonprofit',
          'portfolio',
          'restaurant',
          'medical',
          'legal',
          'retail',
        ])
        .default('software'),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = requireTenant(c);
    const body = c.req.valid('json');

    const existing = await dbQueryOne(
      c.env.DB,
      `SELECT id FROM sites WHERE slug = ?1 AND deleted_at IS NULL`,
      [body.slug],
    );
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, `slug ${body.slug} already taken`);
    }

    const siteId = crypto.randomUUID();
    const dbName = `projectsites-tenant-${body.slug}`;
    const provisioned = await provisionTenantD1(c.env, { databaseName: dbName });

    await dbInsert(c.env.DB, 'sites', {
      id: siteId,
      tenant_id: tenantId,
      slug: body.slug,
      name: body.query,
      status: 'provisioning',
      d1_database_id: provisioned.id,
      worker_name: `projectsites-tenant-${body.slug}`,
      primary_hostname: `${body.slug}.projectsites.dev`,
      metadata_json: JSON.stringify({ query: body.query, site_type: body.site_type }),
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'site.create_from_search',
      target_type: 'site',
      target_id: siteId,
      metadata: { slug: body.slug, query: body.query, site_type: body.site_type },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ site_id: siteId, status: 'provisioning', d1_database_id: provisioned.id });
  },
);

app.delete('/:id', async (c) => {
  const userId = requireAuth(c);
  const tenantId = requireTenant(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<SiteRow>(
    c.env.DB,
    `SELECT id FROM sites WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'site');
  await dbExecute(
    c.env.DB,
    `UPDATE sites SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2`,
    [new Date().toISOString(), id],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'site.delete',
    target_type: 'site',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

app.get('/:id/workflow-status', async (c) => {
  requireTenant(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<{ status: string; metadata_json: string | null }>(
    c.env.DB,
    `SELECT status, metadata_json FROM sites WHERE id = ?1`,
    [id],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'site');
  return c.json({
    status: row.status,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  });
});

// ── Hostnames sub-router ────────────────────────────────────────────────────

app.get('/:id/hostnames', async (c) => {
  const tenantId = requireTenant(c);
  const siteId = c.req.param('id');
  const rows = await dbQuery(
    c.env.DB,
    `SELECT id, hostname, is_primary, status, cf_hostname_id, created_at
     FROM hostnames WHERE tenant_id = ?1 AND site_id = ?2 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at DESC`,
    [tenantId, siteId],
  );
  return c.json({ hostnames: rows });
});

app.post(
  '/:id/hostnames',
  zValidator(
    'json',
    z.object({
      hostname: z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
      is_primary: z.boolean().default(false),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = requireTenant(c);
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const cf = await attachCustomHostname(c.env, { hostname: body.hostname });
    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'hostnames', {
      id,
      tenant_id: tenantId,
      site_id: siteId,
      hostname: body.hostname.toLowerCase(),
      is_primary: body.is_primary ? 1 : 0,
      cf_hostname_id: cf.id,
      status: cf.status,
    });
    if (body.is_primary) {
      await dbExecute(
        c.env.DB,
        `UPDATE sites SET primary_hostname = ?1, updated_at = ?2 WHERE id = ?3`,
        [body.hostname.toLowerCase(), new Date().toISOString(), siteId],
      );
    }
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'hostname.add',
      target_type: 'hostname',
      target_id: id,
      metadata: { hostname: body.hostname, site_id: siteId },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ id, status: cf.status });
  },
);

// ── #14 Natural-language log search ────────────────────────────────────────
// POST /api/sites/:siteId/logs/search — translates a natural-language query
// to a D1 WHERE clause via Workers AI Llama 3.3, then runs the resulting
// statement against the platform `logs` table scoped to this site.

const NL_LOG_SYSTEM =
  'Translate this natural-language log query to a D1 SQL WHERE clause for ' +
  'table `logs(timestamp TEXT, level TEXT, source TEXT, message TEXT, ' +
  'request_id TEXT)`. ONLY output the WHERE clause text (no SELECT, no ' +
  'semicolon, no markdown). Use single-quoted string literals. Levels are ' +
  "one of: trace, debug, info, warn, error, fatal.";

/**
 * Lightweight allow-list validator. Rejects any DML/DDL keyword + balances
 * parens. The wrapper SQL prefixes its own `SELECT ... WHERE site_id = ?1
 * AND ({clause})`, so the clause must be a pure boolean expression.
 */
export function isSafeWhereClause(raw: string): boolean {
  if (!raw || raw.length > 800) return false;
  if (raw.includes(';')) return false;
  if (raw.includes('--')) return false;
  if (raw.includes('/*')) return false;
  const banned =
    /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|union|select|from|join)\b/i;
  if (banned.test(raw)) return false;
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

app.post(
  '/:siteId/logs/search',
  zValidator('json', z.object({ query: z.string().min(1).max(500) })),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = requireTenant(c);
    const siteId = c.req.param('siteId');
    const { query } = c.req.valid('json');

    // Authorize: site must belong to caller's tenant.
    const site = await dbQueryOne<{ id: string }>(
      c.env.DB,
      `SELECT id FROM sites WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
      [siteId, tenantId],
    );
    if (!site) throw new AppError(ErrorCode.NOT_FOUND, 'site');

    const whereClause = (
      await aiTextCompletion(c.env, {
        system: NL_LOG_SYSTEM,
        user: `Query: ${query}`,
        max_tokens: 256,
      })
    )
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^WHERE\s+/i, '')
      .trim();

    if (!isSafeWhereClause(whereClause)) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'generated WHERE clause failed safety validation', {
        clause: whereClause,
      });
    }

    // Execute against the platform logs table scoped to the site.
    const sql =
      `SELECT timestamp, level, source, message, request_id ` +
      `FROM logs WHERE site_id = ?1 AND (${whereClause}) ` +
      `ORDER BY timestamp DESC LIMIT 100`;
    let rows: ReadonlyArray<Record<string, unknown>> = [];
    try {
      rows = await dbQuery(c.env.DB, sql, [siteId]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(ErrorCode.BAD_REQUEST, `log search failed: ${msg}`, {
        clause: whereClause,
      });
    }

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.log_search',
      target_type: 'site',
      target_id: siteId,
      metadata: { query, clause: whereClause, hits: rows.length },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ where: whereClause, rows });
  },
);

// ── #43 SQL AI assistant (text-to-SQL, SELECT-only, dry-run gated) ──────────
/**
 * POST /api/sites/:siteId/sql/ai
 *
 * Translate a natural-language `intent` to a SELECT against the site's D1
 * schema. The model is told the live schema (introspected via PRAGMA), MUST
 * return SELECT only, and the result runs through `EXPLAIN QUERY PLAN` as a
 * dry-run before being returned to the UI for confirmation.
 *
 *  Returns: { proposal_id, sql, explanation, confidence, dry_run_plan }
 *
 * The UI shows the proposal in a confirm pane; the user runs it via the
 * existing SQL workbench `/execute` route — this endpoint NEVER runs the
 * query itself.
 */
const SQL_AI_SYSTEM = [
  'You translate analyst intent to a single Cloudflare D1 (SQLite) SELECT',
  'statement against the schema the user supplies. Constraints:',
  '1. Output ONLY a JSON object: {"sql": "...", "explanation": "...", "confidence": 0..1}.',
  '2. The `sql` field MUST start with SELECT or WITH (CTE-then-SELECT only).',
  '3. NEVER emit INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, DETACH,',
  '   PRAGMA, VACUUM, REPLACE, or any other mutating keyword.',
  '4. Always limit output rows to at most 200 unless the intent obviously',
  '   requires aggregation across the whole table.',
  '5. Use ONLY tables and columns from the supplied schema. No "SELECT *" —',
  '   always list explicit columns so the contract is auditable.',
  '6. Prefer SQLite functions (strftime, julianday, COALESCE) over engine-',
  '   specific ones. No window functions if a GROUP BY works.',
  '7. Confidence reflects how literal the SQL is vs the intent (0.9+ for',
  '   "count rows", 0.5 for ambiguous "show me trends").',
].join(' ');

interface D1ColRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/**
 * Reject anything other than a single SELECT (or WITH-then-SELECT) statement.
 * Last line of defense BEFORE the dry-run — the dry-run is a second line.
 */
export function isSafeSelect(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) return false;
  if (/--/.test(trimmed)) return false;
  if (/\/\*/.test(trimmed)) return false;
  const banned =
    /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|truncate|reindex|analyze)\b/i;
  if (banned.test(trimmed)) return false;
  return /^\s*(select|with)\b/i.test(trimmed);
}

interface SqlAiProposal {
  sql: string;
  explanation: string;
  confidence: number;
}

export function parseSqlAiResponse(raw: string): SqlAiProposal | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const sql = typeof obj['sql'] === 'string' ? obj['sql'].trim() : '';
    const explanation =
      typeof obj['explanation'] === 'string'
        ? obj['explanation'].trim().slice(0, 1_000)
        : '';
    const confidenceRaw = obj['confidence'];
    const confidence =
      typeof confidenceRaw === 'number'
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0.5;
    if (!sql) return null;
    return { sql, explanation, confidence };
  } catch {
    return null;
  }
}

app.post(
  '/:siteId/sql/ai',
  zValidator(
    'json',
    z.object({
      intent: z.string().min(4).max(1_000),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = requireTenant(c);
    const siteId = c.req.param('siteId');
    const { intent } = c.req.valid('json');

    // Authorize: site must belong to caller's tenant.
    const site = await dbQueryOne<{ id: string; d1_database_id: string | null }>(
      c.env.DB,
      `SELECT id, d1_database_id FROM sites
        WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
      [siteId, tenantId],
    );
    if (!site) throw new AppError(ErrorCode.NOT_FOUND, 'site');

    // Introspect the live schema via D1 sqlite_master + table_info.
    // (Worker control-plane DB is the same `c.env.DB` for now; in a full
    // tenant-D1 fan-out this would call out to the site's own DB binding.)
    const tables = await dbQuery<{ name: string }>(
      c.env.DB,
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );
    const schemaLines: string[] = [];
    for (const t of tables.slice(0, 64)) {
      const cols = await dbQuery<D1ColRow>(
        c.env.DB,
        `SELECT name, type, notnull, pk FROM pragma_table_info(?1)`,
        [t.name],
      );
      schemaLines.push(
        `TABLE ${t.name}(${cols
          .map((col) => `${col.name} ${col.type}${col.pk ? ' PK' : ''}${col.notnull ? ' NOT NULL' : ''}`)
          .join(', ')})`,
      );
    }
    const schemaText = schemaLines.join('\n');

    const userPrompt = `Schema:\n${schemaText}\n\nIntent: ${intent}\n\nReturn ONLY the JSON object.`;
    const rawResponse = await aiTextCompletion(c.env, {
      system: SQL_AI_SYSTEM,
      user: userPrompt,
      max_tokens: 600,
      cache: true,
    });
    const proposal = parseSqlAiResponse(rawResponse);
    if (!proposal) {
      throw new AppError(
        ErrorCode.AI_GENERATION_ERROR,
        'model did not return a JSON proposal',
        { raw: rawResponse.slice(0, 400) },
      );
    }
    if (!isSafeSelect(proposal.sql)) {
      const id = crypto.randomUUID();
      await dbInsert(c.env.DB, 'sql_ai_proposals', {
        id,
        tenant_id: tenantId,
        site_id: siteId,
        actor_user_id: userId,
        intent,
        proposed_sql: proposal.sql,
        explanation: proposal.explanation,
        confidence: proposal.confidence,
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        executed: 0,
        rejected_reason: 'unsafe_sql',
      });
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        'AI proposed a non-SELECT statement; rejected',
        { sql: proposal.sql.slice(0, 400) },
      );
    }

    // Dry-run via EXPLAIN QUERY PLAN. If parsing fails, surface the SQL error
    // back to the UI so the user can ask the model to retry.
    let dryRunPlan: string;
    try {
      const planRows = await dbQuery<{ id: number; parent: number; detail: string }>(
        c.env.DB,
        `EXPLAIN QUERY PLAN ${proposal.sql}`,
      );
      dryRunPlan = planRows.map((r) => `[${r.id}/${r.parent}] ${r.detail}`).join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const id = crypto.randomUUID();
      await dbInsert(c.env.DB, 'sql_ai_proposals', {
        id,
        tenant_id: tenantId,
        site_id: siteId,
        actor_user_id: userId,
        intent,
        proposed_sql: proposal.sql,
        explanation: proposal.explanation,
        confidence: proposal.confidence,
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        executed: 0,
        rejected_reason: `dry_run_failed: ${msg.slice(0, 240)}`,
      });
      throw new AppError(ErrorCode.BAD_REQUEST, `dry-run failed: ${msg}`, {
        sql: proposal.sql,
      });
    }

    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'sql_ai_proposals', {
      id,
      tenant_id: tenantId,
      site_id: siteId,
      actor_user_id: userId,
      intent,
      proposed_sql: proposal.sql,
      explanation: proposal.explanation,
      confidence: proposal.confidence,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      executed: 0,
      dry_run_plan: dryRunPlan,
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.sql_proposal',
      target_type: 'site',
      target_id: siteId,
      metadata: {
        intent,
        confidence: proposal.confidence,
        sql_preview: proposal.sql.slice(0, 200),
      },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      proposal_id: id,
      sql: proposal.sql,
      explanation: proposal.explanation,
      confidence: proposal.confidence,
      dry_run_plan: dryRunPlan,
    });
  },
);

app.delete('/:id/hostnames/:hostnameId', async (c) => {
  const userId = requireAuth(c);
  const tenantId = requireTenant(c);
  const id = c.req.param('hostnameId');
  await dbExecute(
    c.env.DB,
    `UPDATE hostnames SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'hostname.remove',
    target_type: 'hostname',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
