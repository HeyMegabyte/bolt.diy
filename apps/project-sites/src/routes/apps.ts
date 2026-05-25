/**
 * @module routes/apps
 *
 * @description
 * Worker routes powering the `/admin/apps` tab. Surfaces the curated
 * `APPS_CATALOG` of self-hostable open-source apps and the per-org
 * `app_instances` CRUD lifecycle.
 *
 * ## Routes
 *
 * | Method | Path                                     | Purpose                                |
 * | ------ | ---------------------------------------- | -------------------------------------- |
 * | GET    | /api/apps/catalog                        | List all catalog apps (public, cached) |
 * | GET    | /api/apps/catalog/:id                    | Detail for one catalog app             |
 * | GET    | /api/apps/instances                      | List the current org's instances       |
 * | POST   | /api/apps/instances                      | Provision aux infra + create instance  |
 * | GET    | /api/apps/instances/:id                  | Fetch one instance (incl. decrypted env) |
 * | POST   | /api/apps/instances/:id/restart          | Bounce container                       |
 * | POST   | /api/apps/instances/:id/stop             | Graceful shutdown                      |
 * | PATCH  | /api/apps/instances/:id/env              | Update env vars + schedule restart     |
 * | DELETE | /api/apps/instances/:id                  | Destroy + deprovision aux infra        |
 * | GET    | /api/apps/instances/:id/logs?tail=N      | SSE stream of container logs           |
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { APPS_CATALOG, type CatalogApp } from '../data/apps-catalog.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { decrypt, encrypt } from '../services/ai_crypto.js';
import { deprovisionInfra, provisionInfra } from '../services/app_provisioner.js';
import {
  MissingEnvError,
  resolveAppEnv,
} from '../services/app_env_resolver.js';
import { MissingNeonKeyError } from '../services/neon_provisioner.js';
import { MissingUpstashKeyError } from '../services/upstash_provisioner.js';
import * as dispatcher from '../services/container_dispatcher.js';
import * as auditService from '../services/audit.js';
import { isSupportedSlug } from '../durable_objects/app_runtime_subclasses.js';

export const apps = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ─────────────────────────────────────────────────

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const createInstanceBody = z.object({
  app_id: z.string().min(1).max(64),
  subdomain: z
    .string()
    .min(2)
    .max(63)
    .regex(SUBDOMAIN_RE, 'subdomain must be lowercase alphanumeric + hyphen, not starting/ending with hyphen'),
  env_overrides: z.record(z.string().max(8_000)).optional(),
});

const patchEnvBody = z.object({
  env_overrides: z.record(z.string().max(8_000)),
});

// ─── DB shape ────────────────────────────────────────────────

interface AppInstanceRow {
  id: string;
  org_id: string;
  created_by: string;
  app_slug: string;
  subdomain: string;
  status: string;
  env_encrypted: string | null;
  env_iv: string | null;
  neon_project_id: string | null;
  upstash_database_id: string | null;
  r2_bucket_name: string | null;
  do_instance_id: string | null;
  last_started_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function requireAuth(c: { get: (k: string) => string | undefined }): { userId: string; orgId: string } {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId) throw unauthorized('Sign in to use the Apps tab.');
  if (!orgId) throw forbidden('No organization is associated with this session.');
  return { userId, orgId };
}

function catalogById(id: string): CatalogApp | undefined {
  return APPS_CATALOG.find((a) => a.id === id);
}

async function loadInstance(env: Env, orgId: string, id: string): Promise<AppInstanceRow | null> {
  return dbQueryOne<AppInstanceRow>(
    env.DB,
    `SELECT * FROM app_instances WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
}

function sanitizeInstance(row: AppInstanceRow): Omit<AppInstanceRow, 'env_encrypted' | 'env_iv'> & { env: null } {
  // Default list/get does NOT include the decrypted env — separate detail
  // route requires admin role.
  const { env_encrypted: _ee, env_iv: _ev, ...rest } = row;
  return { ...rest, env: null };
}

async function decryptEnv(env: Env, row: AppInstanceRow): Promise<Record<string, string>> {
  if (!row.env_encrypted) return {};
  try {
    const plain = await decrypt(env, row.env_encrypted);
    return JSON.parse(plain) as Record<string, string>;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'apps',
        message: 'decryptEnv failed',
        instance_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {};
  }
}

// ─── Catalog routes (public, cacheable) ─────────────────────

/**
 * `GET /api/apps/catalog` — List every catalog app.
 *
 * @remarks
 * No auth — the catalog drives signup conversion. Cached at the edge.
 */
apps.get('/api/apps/catalog', (c) => {
  // `?supported=true` filters to apps whose per-image DO subclass is wired
  // up in wrangler.toml (the live-bootable top-10). Used by the catalog UI
  // to surface a "Live" pill on supported cards + a "Coming soon" pill on
  // the rest. Default (no flag) returns the full curated set.
  const supportedFilter = c.req.query('supported');
  const items =
    supportedFilter === 'true'
      ? APPS_CATALOG.filter((a) => isSupportedSlug(a.id))
      : APPS_CATALOG;
  const decorated = items.map((a) => ({ ...a, supported: isSupportedSlug(a.id) }));
  return c.json(
    {
      apps: decorated,
      count: decorated.length,
    },
    200,
    { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  );
});

/**
 * `GET /api/apps/catalog/:id` — Detail page for one catalog app
 * (description, ports, env requirements, screenshots).
 *
 * @throws 404 NOT_FOUND when the id isn't in {@link APPS_CATALOG}.
 */
apps.get('/api/apps/catalog/:id', (c) => {
  const app = catalogById(c.req.param('id'));
  if (!app) throw notFound(`No app with id '${c.req.param('id')}' in catalog`);
  return c.json(
    { app: { ...app, supported: isSupportedSlug(app.id) } },
    200,
    { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  );
});

// ─── Instance list ───────────────────────────────────────────

/**
 * `GET /api/apps/instances` — List the current org's running app instances.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 */
apps.get('/api/apps/instances', async (c) => {
  const { orgId } = requireAuth(c);
  const { data, error } = await dbQuery<AppInstanceRow>(
    c.env.DB,
    `SELECT * FROM app_instances
       WHERE org_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    [orgId],
  );
  if (error) throw badRequest(error);
  return c.json({ instances: data.map(sanitizeInstance) });
});

// ─── Instance create ─────────────────────────────────────────

/**
 * `POST /api/apps/instances` — Provision aux infra (Neon DB, Upstash KV,
 * etc.) and create a new container instance.
 *
 * @remarks
 * Body: {@link createInstanceBody}. Calls {@link provisionInfra} to
 * mint any required cloud resources, encrypts the resulting credentials,
 * persists them on the `app_instances` row, then schedules the container
 * boot. Audit-logged. The hostname follows `{subdomain}.app.projectsites.dev`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails, subdomain is
 *   malformed, or app slug isn't supported.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 409 CONFLICT when the subdomain is already taken.
 * @throws 502 BAD_GATEWAY when upstream provisioning (Neon, Upstash) fails.
 */
apps.post('/api/apps/instances', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const body = createInstanceBody.parse(await c.req.json());
  const app = catalogById(body.app_id);
  if (!app) throw badRequest(`Unknown app id '${body.app_id}'`);

  // Preflight: only the apps with a per-image DO subclass + matching
  // `[[containers]]` block in wrangler.toml can actually boot. Everything
  // else 424s with a "coming soon" message so the UI can surface it as a
  // queued catalog entry rather than provisioning Neon/Upstash + leaving a
  // useless "coming soon" container running.
  if (!isSupportedSlug(app.id)) {
    return c.json(
      {
        error: 'app_not_supported',
        app_id: app.id,
        message:
          'Coming soon — this catalog app is queued for a future subclass registration.',
      },
      424,
    );
  }

  // Subdomain uniqueness — global namespace.
  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM app_instances WHERE subdomain = ? AND deleted_at IS NULL`,
    [body.subdomain],
  );
  if (existing) throw conflict(`Subdomain '${body.subdomain}' is already taken.`);

  const instanceId = crypto.randomUUID();

  // Provision aux infra. The provisioner rolls back already-created resources
  // if any step fails, so callers either get fully provisioned or fully clean.
  let infra;
  try {
    infra = await provisionInfra(c.env, app.infra, { instanceId, slug: app.id });
  } catch (err) {
    if (err instanceof MissingNeonKeyError || err instanceof MissingUpstashKeyError) {
      return c.json(
        {
          error: err.code,
          service: err.service,
          deeplink: err.deeplink,
          message: err.message,
        },
        424,
      );
    }
    throw err;
  }

  // Resolve env vars (auto-fill + secrets + user overrides).
  let envMap: Record<string, string>;
  try {
    envMap = resolveAppEnv(app, infra, body.subdomain, body.env_overrides ?? {});
  } catch (err) {
    // Roll back the infra we just provisioned so we don't strand resources.
    await deprovisionInfra(c.env, {
      neonProjectId: infra.postgres?.projectId,
      upstashDatabaseId: infra.redis?.databaseId,
      r2BucketName: infra.s3?.bucketName,
    });
    if (err instanceof MissingEnvError) {
      return c.json({ error: err.code, key: err.key, app_id: err.appId, message: err.message }, 400);
    }
    throw err;
  }

  const encrypted = await encrypt(c.env, JSON.stringify(envMap));
  const now = new Date().toISOString();

  const { error: insertErr } = await dbInsert(c.env.DB, 'app_instances', {
    id: instanceId,
    org_id: orgId,
    created_by: userId,
    app_slug: app.id,
    subdomain: body.subdomain,
    status: 'provisioning',
    env_encrypted: encrypted,
    env_iv: 'inline',
    neon_project_id: infra.postgres?.projectId ?? null,
    upstash_database_id: infra.redis?.databaseId ?? null,
    r2_bucket_name: infra.s3?.bucketName ?? null,
    do_instance_id: instanceId,
    last_started_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  });
  if (insertErr) {
    await deprovisionInfra(c.env, {
      neonProjectId: infra.postgres?.projectId,
      upstashDatabaseId: infra.redis?.databaseId,
      r2BucketName: infra.s3?.bucketName,
    });
    throw badRequest(insertErr);
  }

  // Fire-and-forget the container start so the API call returns fast. The
  // dispatcher writes a final `status` via the build-status callback (out of
  // scope here — sibling agent owns the DO).
  c.executionCtx.waitUntil(
    (async () => {
      const start = await dispatcher.startContainer(c.env, {
        instanceId,
        image: app.image,
        port: app.port,
        memoryMB: app.memoryMB,
        env: envMap,
        volumeMB: app.volumeMB,
        appSlug: app.id,
      });
      await dbUpdate(
        c.env.DB,
        'app_instances',
        start.ok
          ? { status: 'starting', last_started_at: new Date().toISOString(), last_error: null }
          : { status: 'error', last_error: start.detail ?? 'start_failed' },
        'id = ?',
        [instanceId],
      );
    })(),
  );

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'apps.instance.created',
    target_type: 'app_instance',
    target_id: instanceId,
    metadata_json: { app_slug: app.id, subdomain: body.subdomain },
    request_id: c.get('requestId'),
  });

  return c.json({ instance_id: instanceId, status: 'provisioning', subdomain: body.subdomain }, 201);
});

// ─── Instance detail (decrypted env, admin only) ────────────

/**
 * `GET /api/apps/instances/:id` — Fetch one instance with decrypted env
 * vars for display in the admin UI.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.get('/api/apps/instances/:id', async (c) => {
  const { orgId } = requireAuth(c);
  const role = c.get('userRole');
  if (role && !['owner', 'admin'].includes(role)) {
    throw forbidden('Only owners/admins can read decrypted env vars.');
  }
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const decryptedEnv = await decryptEnv(c.env, row);
  return c.json({ instance: { ...sanitizeInstance(row), env: decryptedEnv } });
});

// ─── Instance lifecycle ─────────────────────────────────────

/**
 * `POST /api/apps/instances/:id/restart` — Bounce the container without
 * dropping its persistent state.
 *
 * @remarks
 * Calls {@link dispatcher.restartInstance}. Capped at 3 restarts per
 * rolling minute (enforced inside the container DO) to prevent crash
 * loops. Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 * @throws 429 RATE_LIMITED when the restart budget is exhausted.
 */
apps.post('/api/apps/instances/:id/restart', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const r = await dispatcher.restartContainer(c.env, row.id, row.app_slug);
  await dbUpdate(
    c.env.DB,
    'app_instances',
    r.ok
      ? { status: 'starting', last_started_at: new Date().toISOString(), last_error: null }
      : { status: 'error', last_error: r.detail ?? 'restart_failed' },
    'id = ?',
    [row.id],
  );
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'apps.instance.restarted',
    target_type: 'app_instance',
    target_id: row.id,
    request_id: c.get('requestId'),
  });
  return c.json({ ok: r.ok, detail: r.detail ?? null });
});

/**
 * `POST /api/apps/instances/:id/stop` — Graceful container shutdown
 * (does not deprovision aux infra; `DELETE` for that).
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.post('/api/apps/instances/:id/stop', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const r = await dispatcher.stopContainer(c.env, row.id, row.app_slug);
  await dbUpdate(
    c.env.DB,
    'app_instances',
    r.ok ? { status: 'stopped' } : { status: 'error', last_error: r.detail ?? 'stop_failed' },
    'id = ?',
    [row.id],
  );
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'apps.instance.stopped',
    target_type: 'app_instance',
    target_id: row.id,
    request_id: c.get('requestId'),
  });
  return c.json({ ok: r.ok, detail: r.detail ?? null });
});

/**
 * `PATCH /api/apps/instances/:id/env` — Update encrypted env vars and
 * schedule a restart for the new values to take effect.
 *
 * @remarks
 * Body: `{ env: Record<string, string> }`. Values are re-encrypted via
 * {@link encrypt} (AES-GCM per-record IV) before persisting. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.patch('/api/apps/instances/:id/env', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const body = patchEnvBody.parse(await c.req.json());
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const app = catalogById(row.app_slug);
  if (!app) throw badRequest(`Catalog entry '${row.app_slug}' no longer exists`);

  const current = await decryptEnv(c.env, row);
  const merged = { ...current, ...body.env_overrides };
  const encrypted = await encrypt(c.env, JSON.stringify(merged));
  await dbUpdate(c.env.DB, 'app_instances', { env_encrypted: encrypted, env_iv: 'inline' }, 'id = ?', [row.id]);

  // Schedule a restart so the new env-var values take effect.
  c.executionCtx.waitUntil(
    dispatcher.restartContainer(c.env, row.id, row.app_slug).then((r) =>
      dbUpdate(
        c.env.DB,
        'app_instances',
        r.ok
          ? { status: 'starting', last_started_at: new Date().toISOString(), last_error: null }
          : { status: 'error', last_error: r.detail ?? 'restart_failed' },
        'id = ?',
        [row.id],
      ),
    ),
  );

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'apps.instance.env_updated',
    target_type: 'app_instance',
    target_id: row.id,
    metadata_json: { keys: Object.keys(body.env_overrides) },
    request_id: c.get('requestId'),
  });
  return c.json({ ok: true, status: 'starting' });
});

/**
 * `DELETE /api/apps/instances/:id` — Destroy the instance and deprovision
 * its aux infra (Neon DB, Upstash KV, R2 bucket, …).
 *
 * @remarks
 * Calls {@link deprovisionInfra} which is best-effort — partial failures
 * are logged but never block the row deletion. Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.delete('/api/apps/instances/:id', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');

  // Best-effort destroy in the container layer first so volume + DO state are freed.
  await dispatcher.destroyContainer(c.env, row.id, row.app_slug);

  const cleanup = await deprovisionInfra(c.env, {
    neonProjectId: row.neon_project_id,
    upstashDatabaseId: row.upstash_database_id,
    r2BucketName: row.r2_bucket_name,
  });

  await dbExecute(
    c.env.DB,
    `UPDATE app_instances SET status = 'destroyed', deleted_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), row.id],
  );

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'apps.instance.destroyed',
    target_type: 'app_instance',
    target_id: row.id,
    metadata_json: {
      neon_cleaned: cleanup.neon,
      upstash_cleaned: cleanup.upstash,
      r2_cleaned: cleanup.r2,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ ok: true, cleanup });
});

// ─── Logs (SSE proxy) ───────────────────────────────────────

/**
 * `GET /api/apps/instances/:id/logs?tail=N` — Tail the last N log lines
 * from the container's SQLite ring buffer (max 1000).
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.get('/api/apps/instances/:id/logs', async (c) => {
  const { orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const tail = Math.max(1, Math.min(1000, Number(c.req.query('tail') ?? '100')));
  const r = await dispatcher.getContainerLogs(c.env, row.id, tail, row.app_slug);
  return c.json({ instance_id: row.id, tail, lines: r.lines ?? [] });
});

// ─── SSE log stream ─────────────────────────────────────────
//
// EventSource clients connect here for a live tail. The dispatcher returns
// a streamed Response sourced from the DO's own SSE pump. When the
// APP_RUNTIME binding is missing we emit a single `info` event so the
// client gets a deterministic message instead of hanging.

/**
 * `GET /api/apps/instances/:id/logs/stream` — SSE stream of live container
 * logs (newline-delimited).
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.get('/api/apps/instances/:id/logs/stream', async (c) => {
  const { orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const tail = Math.max(1, Math.min(500, Number(c.req.query('tail') ?? '50')));
  return dispatcher.tailContainerLogs(c.env, row.id, tail, row.app_slug);
});

// ─── Health (admin polling) ─────────────────────────────────
//
// Returns `{db_status, runtime: {state, uptime_seconds, memory_mb_used,
// last_error, restart_count, image}}`. Used by the admin UI to poll every
// 5-10s while a container is booting / recovering from a crash.

/**
 * `GET /api/apps/instances/:id/health` — Probe the container's `/health`
 * endpoint and return its response + latency.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 403 FORBIDDEN when the instance isn't owned by the caller's org.
 * @throws 404 NOT_FOUND when the id doesn't exist.
 */
apps.get('/api/apps/instances/:id/health', async (c) => {
  const { orgId } = requireAuth(c);
  const row = await loadInstance(c.env, orgId, c.req.param('id'));
  if (!row) throw notFound('app_instance not found');
  const r = await dispatcher.getContainerStatus(c.env, row.id, row.app_slug);
  return c.json({
    instance_id: row.id,
    app_slug: row.app_slug,
    subdomain: row.subdomain,
    db_status: row.status,
    last_error: row.last_error,
    runtime: r.ok
      ? r.status
      : { state: 'unknown', uptime_seconds: 0, memory_mb_used: 0, last_error: r.detail },
  });
});
