/**
 * Site creation — the reusable core extracted from `POST /api/sites`.
 *
 * @remarks
 * Builds the `sites` row, inserts it, writes the `site.created` audit log, and
 * fires the PostHog `created` event (fire-and-forget). Slug RESOLUTION (the
 * AI/user/derived slug) stays at the call site — this service takes the resolved
 * slug and persists. Extracted so the claimyour.site funnel can provision a site
 * from a lead profile the same way the manual `POST /api/sites` route does
 * (one site-creation definition, no drift).
 *
 * @example
 * ```ts
 * const site = await createSite(env, { orgId, slug, businessName }, { actorId, requestId, executionCtx });
 * ```
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import { dbInsert } from './db.js';
import { writeAuditLog } from './audit.js';
import { trackSite } from '../lib/posthog.js';
import { badRequest } from '@project-sites/shared';

/** The fields a caller provides to provision a site (slug already resolved). */
export interface CreateSiteInput {
  orgId: string;
  slug: string;
  businessName: string;
  businessPhone?: string | null;
  businessEmail?: string | null;
  businessAddress?: string | null;
  googlePlaceId?: string | null;
}

/** Request-scoped context for audit + analytics (optional outside a request). */
export interface CreateSiteCtx {
  actorId?: string | null;
  requestId?: string;
  executionCtx?: ExecutionContext;
}

/** The persisted `sites` row (the shape returned to API callers as `data`). */
export interface SiteRow {
  id: string;
  org_id: string;
  slug: string;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  business_address: string | null;
  google_place_id: string | null;
  bolt_chat_id: string | null;
  current_build_version: string | null;
  status: string;
  lighthouse_score: number | null;
  lighthouse_last_run: string | null;
  deleted_at: string | null;
}

/**
 * Persist a new site row + audit + analytics.
 *
 * @param env   - Worker env (uses `env.DB` + PostHog config).
 * @param input - The resolved site fields ({@link CreateSiteInput}).
 * @param ctx   - Optional audit/analytics context.
 * @returns The created {@link SiteRow}.
 * @throws {AppError} `BAD_REQUEST` when the D1 insert fails (typically a slug
 *   collision via the `sites.slug` unique index).
 */
export async function createSite(
  env: Env,
  input: CreateSiteInput,
  ctx: CreateSiteCtx = {},
): Promise<SiteRow> {
  const site: SiteRow = {
    id: crypto.randomUUID(),
    org_id: input.orgId,
    slug: input.slug,
    business_name: input.businessName,
    business_phone: input.businessPhone ?? null,
    business_email: input.businessEmail ?? null,
    business_address: input.businessAddress ?? null,
    google_place_id: input.googlePlaceId ?? null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'draft',
    lighthouse_score: null,
    lighthouse_last_run: null,
    deleted_at: null,
  };

  const result = await dbInsert(env.DB, 'sites', site as unknown as Record<string, unknown>);
  if (result.error) throw badRequest(`Failed to create site: ${result.error}`);

  await writeAuditLog(env.DB, {
    org_id: input.orgId,
    actor_id: ctx.actorId ?? null,
    action: 'site.created',
    message: `Site '${input.slug}' created for '${input.businessName}'`,
    target_type: 'site',
    target_id: site.id,
    metadata_json: { site_id: site.id, slug: input.slug, business_name: input.businessName },
    request_id: ctx.requestId,
  });

  // PostHog is fire-and-forget — analytics failures NEVER block site creation,
  // and a non-request caller (e.g. a workflow) without an executionCtx skips it.
  if (ctx.executionCtx) {
    try {
      trackSite(env, ctx.executionCtx, 'created', ctx.actorId || input.orgId, {
        site_id: site.id,
        slug: site.slug,
      });
    } catch {
      /* fire-and-forget */
    }
  }

  return site;
}
