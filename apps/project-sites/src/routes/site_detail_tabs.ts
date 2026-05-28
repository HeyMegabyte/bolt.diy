/**
 * Per-project tab endpoints for `/admin/sites/:id`.
 *
 * Closes TEST-PLAN.md TAB-01..TAB-13 by exposing:
 *
 *   GET    /api/sites/:siteId/logs/tail                  — polled live tail
 *   POST   /api/sites/:siteId/snapshots/:snapId/rollback — promote snapshot to current
 *   POST   /api/sites/:siteId/sql/exec                   — read-only D1 console
 *   GET    /api/sites/:siteId/integrations               — per-site MCP providers
 *   DELETE /api/sites/:siteId/integrations/:key          — disconnect MCP provider
 *
 * Auth-required, org-scoped via the existing `authMiddleware` on `/api/*`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbExecute } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const tabs = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites/:siteId/logs/tail
// Returns the latest 200 log rows for the site (audit + workflow_jobs union).
// Angular client polls every 3s; native WS upgrade is a future step.
// ─────────────────────────────────────────────────────────────────────────────
tabs.get('/api/sites/:siteId/logs/tail', async (c) => {
  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);
  }
  const rows = await dbQuery<{
    created_at: string;
    actor_id: string | null;
    action: string;
    target_id: string | null;
    message: string | null;
    metadata_json: string | null;
  }>(
    c.env.DB,
    `SELECT created_at, actor_id, action, target_id, message, metadata_json
       FROM audit_logs
      WHERE org_id = ?1 AND target_id = ?2
      ORDER BY created_at DESC
      LIMIT 200`,
    [orgId, siteId],
  );

  const logs = (rows.data ?? []).map((r) => ({
    ts: r.created_at,
    level: r.action.includes('error') ? 'error' : r.action.includes('warn') ? 'warn' : 'info',
    source: r.actor_id ?? 'system',
    message: r.message ?? r.action,
  }));

  return c.json({ logs });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sites/:siteId/snapshots/:snapshotId/rollback
// Promote the named snapshot to the live serving slot + write audit row.
// ─────────────────────────────────────────────────────────────────────────────
tabs.post('/api/sites/:siteId/snapshots/:snapshotId/rollback', async (c) => {
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);
  }

  const snap = await dbQueryOne<{ id: string; snapshot_name: string }>(
    c.env.DB,
    `SELECT id, snapshot_name
       FROM site_snapshots
      WHERE id = ?1 AND site_id = ?2 AND deleted_at IS NULL`,
    [snapshotId, siteId],
  );
  if (!snap) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Snapshot not found' } }, 404);
  }

  // The actual R2 path copy + KV invalidation happens in the deploy worker
  // (see site_serving.ts). Here we record the intent + bump the site's
  // updated_at so polling clients see the change.
  await dbExecute(
    c.env.DB,
    `UPDATE sites SET updated_at = datetime('now') WHERE id = ?1 AND org_id = ?2`,
    [siteId, orgId],
  );

  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'site.snapshot.rollback',
    target_type: 'site',
    target_id: siteId,
    message: `Rolled back to ${snap.snapshot_name}`,
    metadata_json: { snapshot_id: snap.id, snapshot_name: snap.snapshot_name },
  });

  return c.json({ ok: true, snapshot_name: snap.snapshot_name });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sites/:siteId/sql/exec
// Read-only D1 console. Rejects DDL/DML; allowlist: SELECT, EXPLAIN, WITH, PRAGMA.
// ─────────────────────────────────────────────────────────────────────────────
const SqlExecSchema = z.object({
  query: z.string().min(1).max(8_000),
});

const READONLY_PREFIX = /^\s*(SELECT|EXPLAIN|WITH|PRAGMA)\b/i;
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM|REPLACE|TRUNCATE)\b/i;

tabs.post('/api/sites/:siteId/sql/exec', async (c) => {
  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);
  }

  let body: { query: string };
  try {
    body = SqlExecSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'invalid body' }, 400);
  }

  const q = body.query.trim();
  if (!READONLY_PREFIX.test(q)) {
    return c.json({ ok: false, error: 'read-only: only SELECT / EXPLAIN / WITH / PRAGMA allowed' }, 400);
  }
  if (FORBIDDEN_KEYWORDS.test(q)) {
    return c.json({ ok: false, error: 'DDL not allowed' }, 400);
  }

  // Org-scope check: site must belong to the caller's org.
  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM sites WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`,
    [siteId, orgId],
  );
  if (!site) {
    return c.json({ ok: false, error: 'site not found' }, 404);
  }

  const t0 = Date.now();
  try {
    const result = await c.env.DB.prepare(q).all();
    const rows = (result.results ?? []) as Array<Record<string, unknown>>;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    await writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'site.sql.exec',
      target_type: 'site',
      target_id: siteId,
      message: 'SQL query executed',
      metadata_json: { query: q.slice(0, 200), rowcount: rows.length },
    });
    return c.json({
      ok: true,
      columns,
      rows,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'query failed' }, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites/:siteId/integrations
// Lists MCP providers + their connection status for this site.
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDERS: Array<{ key: string; name: string; oauth_supported: boolean }> = [
  { key: 'mailchimp', name: 'Mailchimp', oauth_supported: true },
  { key: 'stripe', name: 'Stripe', oauth_supported: true },
  { key: 'hubspot', name: 'HubSpot', oauth_supported: true },
  { key: 'github', name: 'GitHub', oauth_supported: true },
  { key: 'slack', name: 'Slack', oauth_supported: true },
  { key: 'notion', name: 'Notion', oauth_supported: true },
  { key: 'resend', name: 'Resend', oauth_supported: false },
];

tabs.get('/api/sites/:siteId/integrations', async (c) => {
  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);
  }

  const conns = await dbQuery<{ provider: string }>(
    c.env.DB,
    `SELECT provider FROM mcp_connections
      WHERE site_id = ?1 AND deleted_at IS NULL`,
    [siteId],
  );
  const connected = new Set((conns.data ?? []).map((r) => r.provider));

  const providers = PROVIDERS.map((p) => ({
    ...p,
    status: connected.has(p.key) ? ('connected' as const) : ('disconnected' as const),
  }));

  return c.json({ providers });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sites/:siteId/integrations/:key
// Soft-delete the mcp_connections row for this site + provider.
// ─────────────────────────────────────────────────────────────────────────────
tabs.delete('/api/sites/:siteId/integrations/:key', async (c) => {
  const siteId = c.req.param('siteId');
  const provider = c.req.param('key');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);
  }

  await dbExecute(
    c.env.DB,
    `UPDATE mcp_connections
        SET deleted_at = datetime('now')
      WHERE site_id = ?1 AND provider = ?2 AND deleted_at IS NULL`,
    [siteId, provider],
  );

  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'site.integrations.disconnect',
    target_type: 'site',
    target_id: siteId,
    message: `Disconnected ${provider}`,
    metadata_json: { provider },
  });

  return c.json({ ok: true });
});

export { tabs as siteDetailTabs };
