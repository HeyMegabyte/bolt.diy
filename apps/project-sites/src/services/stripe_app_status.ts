/**
 * @module services/stripe_app_status
 *
 * Persistence + business logic for the Stripe App Marketplace
 * install-analytics surface ([[libs/features/stripe_app_status]]).
 */

import type { Env } from '../types/env.js';
import {
  StripeAppInstallSchema,
  type StripeAppInstall,
  type StripeAppLifecycleEvent,
  type StripeAppSummary,
  summarizeInstalls,
} from '../../libs/features/stripe_app_status/feature.schemas.js';

interface InstallRow {
  id: string;
  org_id: string | null;
  stripe_account: string;
  install_source: string;
  status: string;
  installed_at: string;
  uninstalled_at: string | null;
  last_event_at: string | null;
  metadata_json: string | null;
}

function safeJsonObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function rowToInstall(row: InstallRow): StripeAppInstall {
  return StripeAppInstallSchema.parse({
    id: row.id,
    org_id: row.org_id,
    stripe_account: row.stripe_account,
    install_source: row.install_source,
    status: row.status,
    installed_at: row.installed_at,
    uninstalled_at: row.uninstalled_at,
    last_event_at: row.last_event_at,
    metadata: safeJsonObject(row.metadata_json),
  });
}

/**
 * List installs visible to an org. Returns ALL rows when `orgId` is null —
 * useful for the super-admin view (the route layer enforces who is allowed
 * to call this).
 */
export async function listInstalls(
  env: Env,
  args: { orgId?: string | null; limit?: number; offset?: number } = {},
): Promise<StripeAppInstall[]> {
  const limit = Math.min(args.limit ?? 100, 500);
  const offset = args.offset ?? 0;

  const result = args.orgId
    ? await env.DB.prepare(
        `SELECT id, org_id, stripe_account, install_source, status,
                installed_at, uninstalled_at, last_event_at, metadata_json
           FROM stripe_app_installations
          WHERE deleted_at IS NULL AND org_id = ?
          ORDER BY installed_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(args.orgId, limit, offset)
        .all<InstallRow>()
        .catch(() => ({ results: [] as InstallRow[] }))
    : await env.DB.prepare(
        `SELECT id, org_id, stripe_account, install_source, status,
                installed_at, uninstalled_at, last_event_at, metadata_json
           FROM stripe_app_installations
          WHERE deleted_at IS NULL
          ORDER BY installed_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(limit, offset)
        .all<InstallRow>()
        .catch(() => ({ results: [] as InstallRow[] }));

  return (result.results ?? []).map(rowToInstall);
}

export async function getInstallSummary(
  env: Env,
  orgId?: string | null,
): Promise<StripeAppSummary> {
  const installs = await listInstalls(env, { orgId, limit: 500 });
  return summarizeInstalls(installs);
}

/**
 * Upsert a lifecycle event from the marketplace OAuth callback. Idempotent
 * on `stripe_account` — duplicate events update status + last_event_at.
 */
export async function recordLifecycleEvent(
  env: Env,
  event: StripeAppLifecycleEvent,
): Promise<StripeAppInstall> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status =
    event.event_type === 'uninstalled'
      ? 'uninstalled'
      : event.event_type === 'paused'
        ? 'paused'
        : 'installed';
  const uninstalledAt =
    event.event_type === 'uninstalled' ? now : null;
  const metadataJson = event.metadata
    ? JSON.stringify(event.metadata)
    : null;

  await env.DB.prepare(
    `INSERT INTO stripe_app_installations (
       id, org_id, stripe_account, install_source, status,
       installed_at, uninstalled_at, last_event_at, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(stripe_account)
     WHERE deleted_at IS NULL
     DO UPDATE SET
       org_id          = COALESCE(excluded.org_id, stripe_app_installations.org_id),
       install_source  = excluded.install_source,
       status          = excluded.status,
       uninstalled_at  = excluded.uninstalled_at,
       last_event_at   = excluded.last_event_at,
       metadata_json   = COALESCE(excluded.metadata_json, stripe_app_installations.metadata_json),
       updated_at      = datetime('now')`,
  )
    .bind(
      id,
      event.org_id ?? null,
      event.stripe_account,
      event.install_source,
      status,
      now,
      uninstalledAt,
      now,
      metadataJson,
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT id, org_id, stripe_account, install_source, status,
            installed_at, uninstalled_at, last_event_at, metadata_json
       FROM stripe_app_installations
      WHERE stripe_account = ? AND deleted_at IS NULL
      LIMIT 1`,
  )
    .bind(event.stripe_account)
    .first<InstallRow>();
  if (!row) {
    throw new Error('recordLifecycleEvent: failed to read back persisted row');
  }
  return rowToInstall(row);
}
