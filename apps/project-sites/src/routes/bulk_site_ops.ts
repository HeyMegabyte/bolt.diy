/**
 * @module routes/bulk_site_ops
 * @description Bulk Site Ops API — feature #17 (P1), slice 2 (plan/preview).
 *
 * Route (mounted at `/`, BEFORE the `api` catch-all so the literal `bulk`
 * segment isn't eaten by `/api/sites/:id`):
 *   POST /api/sites/bulk
 *     body: { operation: 'set_flag'|'republish'|'archive', siteIds?: string[], allSites?: boolean }
 *     → { ok, dryRun: true, plan } where plan = planBulkOperation(...) result.
 *
 * Gated by the `bulk_site_ops` flag (404 when off — never leak). The caller's
 * sites are resolved org-scoped from D1 (`WHERE org_id = ?`), so the planner
 * can only ever act on owned sites — a requested foreign id comes back as a
 * `not_owned` skip, never touched.
 *
 * This slice is PREVIEW-ONLY (`dryRun: true`): it returns the validated plan
 * (eligible + structured skips + batch cap) so the operator sees exactly what
 * a bulk apply WOULD do before committing. The mutating executor ships in a
 * dedicated slice (non-destructive archive ≠ the soft-delete path; flag
 * overrides + republish need handler tests + post-deploy verification).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { getDefaultFlag } from '../modules/feature_flags/registry.js';
import { dbQuery } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';
import { planBulkOperation, executeBulkArchive, executeBulkSetFlag } from '../services/bulk_site_ops.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

const BodySchema = z
  .object({
    operation: z.enum(['set_flag', 'republish', 'archive']),
    siteIds: z.array(z.string().min(1)).max(1000).optional(),
    allSites: z.boolean().optional(),
    /** Default true (preview). Set false to apply the operation to eligible sites. */
    dryRun: z.boolean().optional(),
    /** set_flag only: which flag + the value to set across eligible sites. */
    flagKey: z.string().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const bulkSiteOps = new Hono<{ Bindings: Env; Variables: Variables }>();

bulkSiteOps.post('/api/sites/bulk', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, 'bulk_site_ops', { orgId }))) return c.json(NOT_FOUND, 404);
  if (!orgId) return c.json(NOT_FOUND, 404);

  const parsed = BodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid bulk request', details: parsed.error.issues } },
      400,
    );
  }
  const { operation, siteIds, allSites, dryRun = true, flagKey, enabled } = parsed.data;

  const owned = (
    await dbQuery<{ id: string; status: string }>(
      c.env.DB,
      'SELECT id, status FROM sites WHERE org_id = ? AND deleted_at IS NULL',
      [orgId],
    )
  ).data;

  const requestedSiteIds = siteIds ?? (allSites ? owned.map((s) => s.id) : []);
  if (requestedSiteIds.length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Provide siteIds[] or allSites=true' } },
      400,
    );
  }

  const plan = planBulkOperation({ operation, requestedSiteIds, ownedSites: owned });

  // Preview: return the validated plan, mutate nothing.
  if (dryRun) return c.json({ ok: true, dryRun: true, plan });

  // Apply. `archive` + `set_flag` have verified executors; `republish` does not yet.
  if (operation === 'archive') {
    const results = await executeBulkArchive(c.env, orgId, plan.eligible);
    await writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId ?? null,
      action: 'bulk_site_ops.archive',
      message: `Bulk-archived ${results.archived.length} site(s) (${results.failed.length} failed)`,
      target_type: 'sites_bulk',
      metadata_json: {
        operation: 'archive',
        eligible: plan.eligible.length,
        archived: results.archived,
        failed: results.failed,
      },
      request_id: c.get('requestId'),
    });
    return c.json({ ok: true, dryRun: false, plan, results });
  }

  if (operation === 'set_flag') {
    // Guardrails: a known, non-core flag + an explicit value. Never let a typo
    // mint a phantom override, and never let a bulk op flip a core_* sentinel.
    if (!flagKey || !getDefaultFlag(flagKey)) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'set_flag requires a known flagKey' }, plan },
        400,
      );
    }
    if (flagKey.startsWith('core_')) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'core_* sentinel flags cannot be bulk-set' }, plan },
        400,
      );
    }
    if (typeof enabled !== 'boolean') {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'set_flag requires enabled (boolean)' }, plan },
        400,
      );
    }
    const results = await executeBulkSetFlag(c.env, plan.eligible, flagKey, enabled, userId ?? null);
    await writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId ?? null,
      action: 'bulk_site_ops.set_flag',
      message: `Bulk set flag '${flagKey}'=${enabled} on ${results.set.length} site(s) (${results.failed.length} failed)`,
      target_type: 'sites_bulk',
      metadata_json: {
        operation: 'set_flag',
        flagKey,
        enabled,
        set: results.set,
        failed: results.failed,
      },
      request_id: c.get('requestId'),
    });
    return c.json({ ok: true, dryRun: false, plan, results });
  }

  // republish executor lands in a follow-up slice — fail loudly (never silently no-op).
  return c.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Executor for "${operation}" is not available yet — re-request with dryRun:true to preview`,
      },
      plan,
    },
    400,
  );
});

export { bulkSiteOps };
