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
