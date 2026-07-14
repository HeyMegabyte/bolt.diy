/**
 * Dittofeed event dispatcher — translates ProjectSites outbox events
 * into Dittofeed identify/track calls for customer engagement automation.
 *
 * @remarks
 * Reads from the outbox_events table and fans out to Dittofeed's Segment-compatible
 * API. Events are translated to Dittofeed's standard event catalog (PS_EVENTS).
 * Non-blocking — runs in ctx.waitUntil(). Never throws.
 *
 * Wires into the existing event_bus outbox processor in outbox_processor.ts.
 */

import type { Env } from '../types/env.js';
import {
  identifyUser,
  trackEvent,
  validateConfig,
  type DittofeedConfig,
  type FetchImpl,
  PS_EVENTS,
} from './dittofeed.js';

// ---------------------------------------------------------------------------
// Event → Dittofeed mapping
// ---------------------------------------------------------------------------

/**
 * Map ProjectSites event types to Dittofeed track event names.
 */
const EVENT_TO_DITTOFEED: Record<string, string> = {
  'site.created': PS_EVENTS.BUILD_STARTED,
  'site.claim.started': PS_EVENTS.BUILD_STARTED,
  'site.claim.completed': PS_EVENTS.BUILD_COMPLETED,
  'site.generated': PS_EVENTS.BUILD_COMPLETED,
  'site.published': PS_EVENTS.SITE_PUBLISHED,
  'site.publish.failed': 'Site Publish Failed',
  'subscription.active': PS_EVENTS.PLAN_UPGRADED,
  'subscription.past_due': PS_EVENTS.INVOICE_FAILED,
  'subscription.canceled': PS_EVENTS.PLAN_DOWNGRADED,
  'invoice.paid': PS_EVENTS.INVOICE_PAID,
  'invoice.failed': PS_EVENTS.INVOICE_FAILED,
  'entitlement.updated': 'Entitlement Updated',
  'lead.discovered': PS_EVENTS.LEAD_SCANNER_BUSINESS_FOUND,
};

/**
 * Build a Dittofeed config from Worker env vars. Returns undefined when not configured.
 */
export function buildDittofeedConfig(env: Env): DittofeedConfig | undefined {
  if (!env.DITTOFEED_ADMIN_API_KEY || !env.DITTOFEED_PUBLIC_WRITE_KEY || !env.DITTOFEED_WORKSPACE_ID) {
    return undefined;
  }
  return {
    adminApiKey: env.DITTOFEED_ADMIN_API_KEY,
    publicWriteKey: env.DITTOFEED_PUBLIC_WRITE_KEY,
    workspaceId: env.DITTOFEED_WORKSPACE_ID,
    baseUrl: env.DITTOFEED_BASE_URL ?? 'https://engage.projectsites.dev',
  };
}

/**
 * Dispatch a single ProjectSites outbox event to Dittofeed.
 * Safe to call inside ctx.waitUntil() — never throws.
 */
export async function dispatchToDittofeed(
  env: Env,
  event: { type: string; tenantId: string; siteId?: string; userId?: string; data: Record<string, unknown> },
  fetchImpl?: FetchImpl,
): Promise<void> {
  const cfg = buildDittofeedConfig(env);
  if (!cfg) return;

  const eventName = EVENT_TO_DITTOFEED[event.type];
  if (!eventName) return; // unlisted events pass through silently

  // User ID follows the site-scoped pattern per architecture decision:
  // site:{site_id}:owner (site-scoped) or tenant:{tenant_id} (org-scoped fallback)
  const dittoUserId = event.siteId
    ? `site:${event.siteId}:owner`
    : `tenant:${event.tenantId}`;

  // Identify the site/org first so traits are available for segmentation
  await identifyUser(cfg, {
    userId: dittoUserId,
    traits: {
      tenantId: event.tenantId,
      siteId: event.siteId,
      eventSource: 'project_sites_worker',
    },
  }, fetchImpl);

  // Track the event
  await trackEvent(cfg, {
    userId: dittoUserId,
    event: eventName,
    properties: {
      ...event.data,
      tenantId: event.tenantId,
      siteId: event.siteId,
    },
  }, fetchImpl);
}

/**
 * Identify a site owner in Dittofeed for segmentation and personalization.
 * Called on site creation, claim, and owner profile updates.
 */
export async function identifySiteOwner(
  env: Env,
  payload: {
    userId: string;
    orgId: string;
    email?: string;
    siteId?: string;
    plan?: string;
    siteCount?: number;
  },
  fetchImpl?: FetchImpl,
): Promise<void> {
  const cfg = buildDittofeedConfig(env);
  if (!cfg) return;

  await identifyUser(cfg, {
    userId: payload.userId,
    traits: {
      orgId: payload.orgId,
      email: payload.email,
      siteId: payload.siteId,
      plan: payload.plan,
      siteCount: payload.siteCount,
    },
  }, fetchImpl);
}
