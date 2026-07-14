/**
 * Dittofeed wiring — connects existing ProjectSites services to Dittofeed events.
 *
 * @remarks
 * This is the "glue" layer. Each function wraps an existing service's output
 * and fires the corresponding Dittofeed track/identify call. All functions are
 * fire-and-forget — safe for ctx.waitUntil(). Never throws.
 *
 * Add new wiring functions here as services are integrated with Dittofeed.
 */

import type { Env } from '../types/env.js';
import { trackEvent, identifyUser, PS_EVENTS, type FetchImpl } from './dittofeed.js';
import { buildDittofeedConfig } from './dittofeed_dispatch.js';

// ---------------------------------------------------------------------------
// Helper — get a Dittofeed config or bail silently
// ---------------------------------------------------------------------------

function cfg(env: Env) {
  return buildDittofeedConfig(env);
}

// ---------------------------------------------------------------------------
// Abandoned Build Recovery (idea #10)
// ---------------------------------------------------------------------------

export interface AbandonedBuildSignal {
  orgId: string;
  siteId: string;
  userId: string;
  siteSlug: string;
  previewUrl: string;
  finishedAt: string;
  hoursSinceFinish: number;
}

export async function emitAbandonedBuildNudge(
  env: Env,
  signal: AbandonedBuildSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  const dUserId = `site:${signal.siteId}:owner`;
  await identifyUser(
    c,
    { userId: dUserId, traits: { orgId: signal.orgId, siteId: signal.siteId } },
    fetchImpl,
  );
  await trackEvent(
    c,
    {
      userId: dUserId,
      event: 'Abandoned Build Detected',
      properties: {
        siteId: signal.siteId,
        siteSlug: signal.siteSlug,
        previewUrl: signal.previewUrl,
        finishedAt: signal.finishedAt,
        hoursSinceFinish: signal.hoursSinceFinish,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// First Lead Celebration (idea #14)
// ---------------------------------------------------------------------------

export interface FirstLeadSignal {
  orgId: string;
  siteId: string;
  userId: string;
  businessName: string;
  conversionKind: string;
  sectionLabel?: string;
}

export async function emitFirstLeadCelebration(
  env: Env,
  signal: FirstLeadSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await identifyUser(
    c,
    {
      userId: `site:${signal.siteId}:owner`,
      traits: { orgId: signal.orgId, siteId: signal.siteId, businessName: signal.businessName },
    },
    fetchImpl,
  );
  await trackEvent(
    c,
    {
      userId: `site:${signal.siteId}:owner`,
      event: PS_EVENTS.FIRST_LEAD,
      properties: {
        siteId: signal.siteId,
        businessName: signal.businessName,
        conversionKind: signal.conversionKind,
        sectionLabel: signal.sectionLabel,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// Plan & Billing events (idea #16 + #18)
// ---------------------------------------------------------------------------

export interface PlanChangeSignal {
  orgId: string;
  userId: string;
  previousPlan: string;
  newPlan: string;
  isUpgrade: boolean;
}

export async function emitPlanChanged(
  env: Env,
  signal: PlanChangeSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await identifyUser(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      traits: { orgId: signal.orgId, plan: signal.newPlan },
    },
    fetchImpl,
  );
  await trackEvent(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      event: signal.isUpgrade ? PS_EVENTS.PLAN_UPGRADED : PS_EVENTS.PLAN_DOWNGRADED,
      properties: {
        previousPlan: signal.previousPlan,
        newPlan: signal.newPlan,
      },
    },
    fetchImpl,
  );
}

export interface InvoiceSignal {
  orgId: string;
  userId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed';
}

export async function emitInvoiceEvent(
  env: Env,
  signal: InvoiceSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await trackEvent(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      event: signal.status === 'paid' ? PS_EVENTS.INVOICE_PAID : PS_EVENTS.INVOICE_FAILED,
      properties: {
        invoiceId: signal.invoiceId,
        amount: signal.amount,
        currency: signal.currency,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

export interface CreditSignal {
  orgId: string;
  userId: string;
  remainingCredits: number;
  totalCredits: number;
  percentUsed: number;
}

export async function emitCreditEvent(
  env: Env,
  signal: CreditSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  const event = signal.percentUsed >= 100 ? PS_EVENTS.CREDIT_EXHAUSTED : PS_EVENTS.CREDIT_LOW;
  await trackEvent(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      event,
      properties: {
        remainingCredits: signal.remainingCredits,
        totalCredits: signal.totalCredits,
        percentUsed: signal.percentUsed,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// Lead Scanner (idea #12)
// ---------------------------------------------------------------------------

export interface LeadScannerSignal {
  orgId: string;
  userId: string;
  businessesFound: number;
  zipsScanned: number;
  tier?: string;
  contactRate?: number;
}

export async function emitLeadScannerRun(
  env: Env,
  signal: LeadScannerSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await trackEvent(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      event: PS_EVENTS.LEAD_SCANNER_RUN,
      properties: {
        businessesFound: signal.businessesFound,
        zipsScanned: signal.zipsScanned,
        tier: signal.tier,
        contactRate: signal.contactRate,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

export interface LeadScannerBusinessSignal {
  orgId: string;
  userId: string;
  businessName: string;
  businessAddress: string;
  hasWebsite: boolean;
  tier: string;
}

export async function emitLeadScannerBusinessFound(
  env: Env,
  signal: LeadScannerBusinessSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await trackEvent(
    c,
    {
      userId: `tenant:${signal.orgId}:owner`,
      event: PS_EVENTS.LEAD_SCANNER_BUSINESS_FOUND,
      properties: {
        businessName: signal.businessName,
        businessAddress: signal.businessAddress,
        hasWebsite: signal.hasWebsite,
        tier: signal.tier,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// Integration Health (idea #17) — Nango, Stripe, Google, social
// ---------------------------------------------------------------------------

export interface IntegrationHealthSignal {
  orgId: string;
  userId: string;
  siteId?: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'degraded';
  reason?: string;
}

export async function emitIntegrationHealthChange(
  env: Env,
  signal: IntegrationHealthSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  const event =
    signal.status === 'connected'
      ? PS_EVENTS.INTEGRATION_CONNECTED
      : signal.status === 'degraded'
        ? PS_EVENTS.INTEGRATION_HEALTH_DEGRADED
        : PS_EVENTS.INTEGRATION_DISCONNECTED;

  await trackEvent(
    c,
    {
      userId: `site:${signal.siteId}:owner`,
      event,
      properties: {
        provider: signal.provider,
        status: signal.status,
        reason: signal.reason,
        siteId: signal.siteId,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// Cloudflare-native events (idea #16)
// ---------------------------------------------------------------------------

export interface CfDeploySignal {
  orgId: string;
  userId: string;
  siteId?: string;
  workerName: string;
  versionId: string;
  status: 'success' | 'failed';
  durationMs?: number;
}

export async function emitCfDeployEvent(
  env: Env,
  signal: CfDeploySignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await trackEvent(
    c,
    {
      userId: `site:${signal.siteId}:owner`,
      event:
        signal.status === 'success' ? PS_EVENTS.CF_WORKER_DEPLOYED : PS_EVENTS.CF_DEPLOY_FAILED,
      properties: {
        workerName: signal.workerName,
        versionId: signal.versionId,
        durationMs: signal.durationMs,
        siteId: signal.siteId,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// Site lifecycle — build, publish, booking (idea #9 + #15)
// ---------------------------------------------------------------------------

export interface BookingSignal {
  orgId: string;
  userId: string;
  siteId: string;
  bookingId: string;
  customerName: string;
  serviceName: string;
  appointmentTime: string;
}

export async function emitBookingMade(
  env: Env,
  signal: BookingSignal,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const c = cfg(env);
  if (!c) return;

  await trackEvent(
    c,
    {
      userId: `site:${signal.siteId}:owner`,
      event: PS_EVENTS.BOOKING_MADE,
      properties: {
        bookingId: signal.bookingId,
        customerName: signal.customerName,
        serviceName: signal.serviceName,
        appointmentTime: signal.appointmentTime,
        siteId: signal.siteId,
        orgId: signal.orgId,
      },
    },
    fetchImpl,
  );
}
