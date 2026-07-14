/**
 * Dittofeed site lifecycle hooks — register resources on create, clean up on delete.
 *
 * @remarks
 * Per the architecture decision: when a site is created, provision the site_id
 * and register default Dittofeed resource mappings. When deleted, pause journeys,
 * delete templates/segments, suppress contacts, stop events, and purge resources.
 *
 * All functions are fire-and-forget — safe for ctx.waitUntil(). Never throw.
 */

import type { Env } from '../types/env.js';
import { identifyUser, trackEvent, PS_EVENTS } from './dittofeed.js';
import { buildDittofeedConfig } from './dittofeed_dispatch.js';

// ---------------------------------------------------------------------------
// Site creation
// ---------------------------------------------------------------------------

export interface SiteCreateSignal {
  orgId: string;
  siteId: string;
  siteSlug: string;
  businessName?: string;
  template?: string;
  pageCount?: number;
}

/**
 * Register a new site in the shared Dittofeed workspace.
 * Called when a site is generated/claimed.
 *
 * @remarks
 * Identifies the site owner with traits (org, template, page count),
 * then tracks a Site Published event. Does NOT create a separate
 * Dittofeed workspace — the shared workspace model uses site-scoped
 * userIds and properties for segmentation.
 */
export async function registerSiteInDittofeed(env: Env, signal: SiteCreateSignal): Promise<void> {
  const cfg = buildDittofeedConfig(env);
  if (!cfg) return;

  const dittoUserId = `site:${signal.siteId}:owner`;

  // Identify the site owner with traits for segmentation
  await identifyUser(cfg, {
    userId: dittoUserId,
    traits: {
      orgId: signal.orgId,
      siteId: signal.siteId,
      siteSlug: signal.siteSlug,
      businessName: signal.businessName,
      template: signal.template,
      pageCount: signal.pageCount,
      lifecycle: 'active',
    },
  });

  // Track site creation event
  await trackEvent(cfg, {
    userId: dittoUserId,
    event: PS_EVENTS.SITE_PUBLISHED,
    properties: {
      siteId: signal.siteId,
      siteSlug: signal.siteSlug,
      businessName: signal.businessName,
      template: signal.template,
      pageCount: signal.pageCount,
      orgId: signal.orgId,
    },
  });
}

// ---------------------------------------------------------------------------
// Site deletion / deprovisioning
// ---------------------------------------------------------------------------

export interface SiteDeleteSignal {
  orgId: string;
  siteId: string;
  siteSlug: string;
  reason?: string;
}

/**
 * Deprovision a site from the shared Dittofeed workspace.
 * Called when a site is deleted.
 *
 * @remarks
 * In the shared workspace model, "deprovisioning" means:
 * 1. Track a Site Unpublished event (marks the site as inactive in Dittofeed)
 * 2. Update traits to lifecycle='deleted' so segments/journeys can filter it out
 * 3. Note: actual journey pausing, template deletion, and contact suppression
 *    are manual Dittofeed UI steps OR future Admin API automation.
 */
export async function deprovisionSiteInDittofeed(
  env: Env,
  signal: SiteDeleteSignal,
): Promise<void> {
  const cfg = buildDittofeedConfig(env);
  if (!cfg) return;

  const dittoUserId = `site:${signal.siteId}:owner`;

  // Update traits to mark as deleted
  await identifyUser(cfg, {
    userId: dittoUserId,
    traits: {
      orgId: signal.orgId,
      siteId: signal.siteId,
      lifecycle: 'deleted',
      deletedReason: signal.reason,
    },
  });

  // Track site deletion event
  await trackEvent(cfg, {
    userId: dittoUserId,
    event: PS_EVENTS.SITE_DELETED,
    properties: {
      siteId: signal.siteId,
      siteSlug: signal.siteSlug,
      reason: signal.reason,
      orgId: signal.orgId,
    },
  });
}

// ---------------------------------------------------------------------------
// Domain lifecycle
// ---------------------------------------------------------------------------

export interface DomainSignal {
  orgId: string;
  siteId: string;
  domain: string;
  status: 'verified' | 'failed';
}

export async function emitDomainEvent(env: Env, signal: DomainSignal): Promise<void> {
  const cfg = buildDittofeedConfig(env);
  if (!cfg) return;

  const dittoUserId = `site:${signal.siteId}:owner`;
  const event = signal.status === 'verified' ? PS_EVENTS.DOMAIN_VERIFIED : PS_EVENTS.DOMAIN_FAILED;

  await trackEvent(cfg, {
    userId: dittoUserId,
    event,
    properties: {
      domain: signal.domain,
      status: signal.status,
      siteId: signal.siteId,
      orgId: signal.orgId,
    },
  });
}
