/**
 * @module services/plugin_marketplace
 * @description Plugin / Integration Marketplace service (IDEAS-50 #41).
 *
 * Webflow-style 70/30 split. Plugins declare install hooks via a JSON manifest
 * the site-build pipeline reads. Per-site activation lives in `plugin_installs`.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne, dbUpdate } from './db.js';
import {
  computePluginRevenueSplit,
  PluginManifestSchema,
  PluginRowSchema,
  type PluginInstallInput,
  type PluginRow,
  type PluginSubmission,
} from '../../libs/features/plugin_marketplace/feature.schemas.js';

function uuid(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant ownership.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the owning org of a site, for multi-tenant isolation checks.
 *
 * @remarks Defensive read — a missing/soft-deleted site returns `undefined`
 * (callers map that to a 404/throw, never trust the supplied id). Used so a
 * caller can never install a plugin onto, or list installs of, another org's
 * site by passing a foreign `site_id`.
 * @param env    - Worker env (D1 binding).
 * @param siteId - The site whose owner is being resolved.
 * @returns The owning `org_id`, or `undefined` when the site does not exist.
 * @example
 * ```ts
 * const owner = await siteOrgId(env, siteId);
 * if (!owner || owner !== orgId) throw new Error('SITE_NOT_OWNED');
 * ```
 */
export async function siteOrgId(env: Env, siteId: string): Promise<string | undefined> {
  const row = await dbQueryOne<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return row?.org_id ?? undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog reads.
// ─────────────────────────────────────────────────────────────────────────────

export interface ListPluginsOptions {
  category?: string;
  creatorUserId?: string;
  includeUnapproved?: boolean;
  limit?: number;
}

export interface PluginSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  install_count: number;
  rating_avg: number | null;
  rating_count: number;
  status: string;
  thumbnail_url: string | null;
  creator_user_id: string | null;
}

export async function listPlugins(
  env: Env,
  opts: ListPluginsOptions = {},
): Promise<PluginSummary[]> {
  const where = ['deleted_at IS NULL'];
  const params: unknown[] = [];

  if (!opts.includeUnapproved) {
    where.push("status = 'live'");
  }
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.creatorUserId) {
    where.push('creator_user_id = ?');
    params.push(opts.creatorUserId);
  }

  const limit = Math.min(opts.limit ?? 200, 500);
  params.push(limit);

  const { data } = await dbQuery<PluginSummary>(
    env.DB,
    `SELECT id, slug, name, description, category, price_cents,
            install_count, rating_avg, rating_count, status,
            thumbnail_url, creator_user_id
       FROM plugins
       WHERE ${where.join(' AND ')}
       ORDER BY install_count DESC, name ASC
       LIMIT ?`,
    params,
  );
  return data ?? [];
}

export async function getPlugin(env: Env, id: string): Promise<PluginRow | null> {
  const row = await dbQueryOne<Record<string, unknown>>(
    env.DB,
    `SELECT id, slug, name, description, creator_user_id, category,
            manifest_json, price_cents, install_count, sales_count,
            total_revenue_cents, rating_avg, rating_count, status,
            thumbnail_url, repository_url, created_at, updated_at
       FROM plugins
       WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;
  const parsed = PluginRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission.
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginSubmitResult {
  ok: true;
  id: string;
  slug: string;
  status: 'pending';
}

export async function submitPlugin(
  env: Env,
  submission: PluginSubmission,
  creatorUserId: string,
): Promise<PluginSubmitResult> {
  const existing = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM plugins WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
    [submission.slug],
  );
  if (existing) throw new Error('SLUG_TAKEN');

  // Validate manifest at the boundary — never trust client-supplied JSON.
  const manifest = PluginManifestSchema.parse(submission.manifest);

  const id = `plg_${uuid()}`;
  const { error } = await dbInsert(env.DB, 'plugins', {
    id,
    slug: submission.slug,
    name: submission.name,
    description: submission.description,
    creator_user_id: creatorUserId,
    category: submission.category,
    manifest_json: JSON.stringify(manifest),
    price_cents: submission.price_cents,
    install_count: 0,
    sales_count: 0,
    total_revenue_cents: 0,
    rating_avg: 0,
    rating_count: 0,
    status: 'pending',
    thumbnail_url: submission.thumbnail_url ?? null,
    repository_url: submission.repository_url ?? null,
  });
  if (error) throw new Error(`DB_INSERT_FAILED: ${error}`);

  return { ok: true, id, slug: submission.slug, status: 'pending' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Install.
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginInstallResult {
  ok: true;
  install_id: string;
  plugin_id: string;
  site_id: string;
  price_paid_cents: number;
  creator_share_cents: number;
  platform_share_cents: number;
}

export async function installPlugin(
  env: Env,
  input: PluginInstallInput,
  installerUserId: string,
  orgId: string,
): Promise<PluginInstallResult> {
  const plugin = await getPlugin(env, input.plugin_id);
  if (!plugin) throw new Error('PLUGIN_NOT_FOUND');
  if (plugin.status !== 'live') throw new Error('PLUGIN_NOT_LIVE');

  if (plugin.price_cents > 0 && !input.stripe_payment_intent) {
    throw new Error('PAYMENT_REQUIRED');
  }

  // Tenant isolation: the target site MUST belong to the installer's org —
  // otherwise a caller could install a plugin onto another org's site by
  // passing a foreign `site_id` in the body.
  const owner = await siteOrgId(env, input.site_id);
  if (!owner || owner !== orgId) throw new Error('SITE_NOT_OWNED');

  const split = computePluginRevenueSplit(plugin.price_cents);

  const id = `plgi_${uuid()}`;
  const { error } = await dbInsert(env.DB, 'plugin_installs', {
    id,
    plugin_id: plugin.id,
    site_id: input.site_id,
    org_id: orgId,
    config_json: JSON.stringify(input.config ?? {}),
    price_paid_cents: plugin.price_cents,
    stripe_payment_intent: input.stripe_payment_intent ?? null,
    installed_by: installerUserId,
  });
  if (error) throw new Error(`DB_INSERT_FAILED: ${error}`);

  // Best-effort aggregate update.
  await dbExecute(
    env.DB,
    `UPDATE plugins
        SET install_count = install_count + 1,
            sales_count = sales_count + (CASE WHEN ? > 0 THEN 1 ELSE 0 END),
            total_revenue_cents = total_revenue_cents + ?,
            updated_at = ?
      WHERE id = ?`,
    [plugin.price_cents, plugin.price_cents, new Date().toISOString(), plugin.id],
  );

  return {
    ok: true,
    install_id: id,
    plugin_id: plugin.id,
    site_id: input.site_id,
    price_paid_cents: plugin.price_cents,
    creator_share_cents: split.creator_share_cents,
    platform_share_cents: split.platform_share_cents,
  };
}

export async function listSiteInstalls(
  env: Env,
  siteId: string,
): Promise<
  Array<{
    install_id: string;
    plugin_id: string;
    plugin_name: string;
    plugin_slug: string;
    installed_at: string;
    config: Record<string, unknown>;
  }>
> {
  const { data } = await dbQuery<{
    install_id: string;
    plugin_id: string;
    plugin_name: string;
    plugin_slug: string;
    installed_at: string;
    config_json: string;
  }>(
    env.DB,
    `SELECT pi.id AS install_id, pi.plugin_id, p.name AS plugin_name, p.slug AS plugin_slug,
            pi.installed_at, pi.config_json
       FROM plugin_installs pi
       JOIN plugins p ON p.id = pi.plugin_id
      WHERE pi.site_id = ?
        AND pi.deleted_at IS NULL
        AND pi.uninstalled_at IS NULL
      ORDER BY pi.installed_at DESC`,
    [siteId],
  );
  return (data ?? []).map((r) => ({
    install_id: r.install_id,
    plugin_id: r.plugin_id,
    plugin_name: r.plugin_name,
    plugin_slug: r.plugin_slug,
    installed_at: r.installed_at,
    config: safeParseJson(r.config_json),
  }));
}

export async function uninstallPlugin(
  env: Env,
  installId: string,
  orgId: string,
): Promise<{ ok: true; install_id: string }> {
  const row = await dbQueryOne<{ id: string; org_id: string; uninstalled_at: string | null }>(
    env.DB,
    'SELECT id, org_id, uninstalled_at FROM plugin_installs WHERE id = ? AND deleted_at IS NULL',
    [installId],
  );
  // Tenant isolation: treat an install owned by another org as not-found (never
  // 403 — don't leak that the install id exists). Prevents cross-org uninstall
  // by id-guessing; the previous `uninstallerUserId` arg was never enforced.
  if (!row || row.org_id !== orgId) throw new Error('INSTALL_NOT_FOUND');
  if (row.uninstalled_at) throw new Error('ALREADY_UNINSTALLED');

  await dbUpdate(
    env.DB,
    'plugin_installs',
    { uninstalled_at: new Date().toISOString() },
    'id = ?',
    [installId],
  );
  return { ok: true, install_id: installId };
}

function safeParseJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
