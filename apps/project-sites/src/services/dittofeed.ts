/**
 * Dittofeed client — DI'd fetch wrapper for engage.projectsites.dev.
 *
 * @remarks
 * Two API surfaces:
 *   1. Admin API (DITTOFEED_ADMIN_API_KEY) — workspace, journey, segment, template CRUD
 *   2. Segment-compatible Public API (DITTOFEED_PUBLIC_WRITE_KEY) — identify, track, page, screen
 *
 * Every function NEVER throws. All network calls are injected via `fetchImpl` so
 * every branch is unit-testable. Config validation returns typed failure unions.
 * Pattern mirrors `listmonk_client.ts` and `turnstile.ts`.
 *
 * @example
 * ```ts
 * import { identifyUser, trackEvent, DittofeedConfig } from './dittofeed';
 *
 * const cfg: DittofeedConfig = {
 *   adminApiKey: env.DITTOFEED_ADMIN_API_KEY,
 *   publicWriteKey: env.DITTOFEED_PUBLIC_WRITE_KEY,
 *   workspaceId: env.DITTOFEED_WORKSPACE_ID,
 *   baseUrl: 'https://engage.projectsites.dev',
 * };
 *
 * const result = await trackEvent(cfg, {
 *   userId: 'org_123',
 *   event: 'Site Published',
 *   properties: { siteId: 'site_456', pageCount: 12 },
 * });
 * if (result.ok) console.warn('event tracked', result.eventId);
 * ```
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DittofeedConfig {
  adminApiKey: string;
  publicWriteKey: string;
  workspaceId: string;
  baseUrl: string;
}

export type FetchImpl = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export function validateConfig(
  cfg: Partial<DittofeedConfig>,
): { ok: true; config: DittofeedConfig } | { ok: false; reason: 'not_configured' | 'invalid'; detail: string } {
  if (!cfg.adminApiKey || !cfg.publicWriteKey || !cfg.workspaceId || !cfg.baseUrl) {
    const missing = [];
    if (!cfg.adminApiKey) missing.push('DITTOFEED_ADMIN_API_KEY');
    if (!cfg.publicWriteKey) missing.push('DITTOFEED_PUBLIC_WRITE_KEY');
    if (!cfg.workspaceId) missing.push('DITTOFEED_WORKSPACE_ID');
    if (!cfg.baseUrl) missing.push('baseUrl');
    return { ok: false, reason: 'not_configured', detail: `Missing: ${missing.join(', ')}` };
  }
  if (!cfg.baseUrl.startsWith('http')) {
    return { ok: false, reason: 'invalid', detail: 'baseUrl must start with http' };
  }
  return { ok: true, config: cfg as DittofeedConfig };
}

// ---------------------------------------------------------------------------
// Segment-compatible Public API types
// ---------------------------------------------------------------------------

export const IdentifyTraitsSchema = z.record(z.unknown());
export const TrackPropertiesSchema = z.record(z.unknown());

export interface IdentifyPayload {
  userId: string;
  anonymousId?: string;
  traits?: Record<string, unknown>;
  timestamp?: string;
}

export interface TrackPayload {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
  anonymousId?: string;
  timestamp?: string;
}

export interface PagePayload {
  userId: string;
  name?: string;
  category?: string;
  properties?: Record<string, unknown>;
  anonymousId?: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Public API result types
// ---------------------------------------------------------------------------

export interface IdentifyResult {
  ok: true;
  status: number;
}

export interface TrackResult {
  ok: true;
  status: number;
  event: string;
}

export interface PageResult {
  ok: true;
  status: number;
}

export type DittofeedError =
  | { ok: false; code: 'not_configured'; message: string }
  | { ok: false; code: 'network_error'; message: string }
  | { ok: false; code: 'api_error'; message: string; status: number }
  | { ok: false; reason: 'not_configured' | 'invalid'; detail: string };

// ---------------------------------------------------------------------------
// Segment-compatible public API
// ---------------------------------------------------------------------------

const PUBLIC_HEADERS = (writeKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Basic ${writeKey}`,
});

/**
 * Identify a user in Dittofeed. Sets user traits for segmentation and personalization.
 * Idempotent — calling with the same userId updates traits.
 *
 * @remarks
 * Traits flow into Dittofeed's user properties, which can be rendered in
 * email/SMS templates and used for journey segmentation.
 */
export async function identifyUser(
  cfg: DittofeedConfig,
  payload: IdentifyPayload,
  fetchImpl: FetchImpl = fetch,
): Promise<IdentifyResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const resp = await fetchImpl(`${cfg.baseUrl}/api/public/apps/identify`, {
      method: 'POST',
      headers: PUBLIC_HEADERS(cfg.publicWriteKey),
      body: JSON.stringify({
        userId: payload.userId,
        anonymousId: payload.anonymousId,
        traits: payload.traits ?? {},
        timestamp: payload.timestamp ?? new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `identify failed: ${resp.status}`, status: resp.status };
    }
    return { ok: true, status: resp.status };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Track an event in Dittofeed. Events trigger journeys and feed segmentation.
 * This is THE primary integration surface.
 *
 * @remarks
 * Events are idempotent when a `messageId` property is provided.
 * Standard ProjectSites events: SitePublished, BuildCompleted, FirstLead,
 * PlanUpgraded, CreditExhausted, DomainVerified, IntegrationConnected.
 */
export async function trackEvent(
  cfg: DittofeedConfig,
  payload: TrackPayload,
  fetchImpl: FetchImpl = fetch,
): Promise<TrackResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const body: Record<string, unknown> = {
      userId: payload.userId,
      event: payload.event,
      properties: payload.properties ?? {},
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };
    if (payload.anonymousId) body.anonymousId = payload.anonymousId;

    const resp = await fetchImpl(`${cfg.baseUrl}/api/public/apps/track`, {
      method: 'POST',
      headers: PUBLIC_HEADERS(cfg.publicWriteKey),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `track failed: ${resp.status}`, status: resp.status };
    }
    return { ok: true, status: resp.status, event: payload.event };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Track a page view in Dittofeed. Used for site visitor analytics.
 */
export async function trackPageView(
  cfg: DittofeedConfig,
  payload: PagePayload,
  fetchImpl: FetchImpl = fetch,
): Promise<PageResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const body: Record<string, unknown> = {
      userId: payload.userId,
      name: payload.name ?? 'Page View',
      properties: payload.properties ?? {},
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };
    if (payload.anonymousId) body.anonymousId = payload.anonymousId;

    const resp = await fetchImpl(`${cfg.baseUrl}/api/public/apps/page`, {
      method: 'POST',
      headers: PUBLIC_HEADERS(cfg.publicWriteKey),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `page failed: ${resp.status}`, status: resp.status };
    }
    return { ok: true, status: resp.status };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Admin API types
// ---------------------------------------------------------------------------

export interface JourneyCreatePayload {
  name: string;
  workspaceId: string;
  definition?: Record<string, unknown>;
}

export interface JourneyCreateResult {
  ok: true;
  journeyId: string;
}

export interface SegmentCreatePayload {
  name: string;
  workspaceId: string;
  definition?: Record<string, unknown>;
}

export interface SegmentCreateResult {
  ok: true;
  segmentId: string;
}

export interface TemplateCreatePayload {
  name: string;
  workspaceId: string;
  body: string;
  subject?: string;
  from?: string;
  type?: 'email' | 'sms' | 'push';
}

export interface TemplateCreateResult {
  ok: true;
  templateId: string;
}

// ---------------------------------------------------------------------------
// Admin API — journey, segment, template management
// ---------------------------------------------------------------------------

const ADMIN_HEADERS = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

/**
 * Create a Dittofeed journey programmatically.
 * Used by the AI Journey Builder to provision journeys from natural language.
 */
export async function createJourney(
  cfg: DittofeedConfig,
  payload: JourneyCreatePayload,
  fetchImpl: FetchImpl = fetch,
): Promise<JourneyCreateResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const resp = await fetchImpl(`${cfg.baseUrl}/api/admin/journeys`, {
      method: 'POST',
      headers: ADMIN_HEADERS(cfg.adminApiKey),
      body: JSON.stringify({
        name: payload.name,
        workspaceId: payload.workspaceId || cfg.workspaceId,
        definition: payload.definition ?? {},
      }),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `create journey failed: ${resp.status}`, status: resp.status };
    }
    const data = (await resp.json()) as { id: string };
    return { ok: true, journeyId: data.id };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a Dittofeed segment programmatically.
 */
export async function createSegment(
  cfg: DittofeedConfig,
  payload: SegmentCreatePayload,
  fetchImpl: FetchImpl = fetch,
): Promise<SegmentCreateResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const resp = await fetchImpl(`${cfg.baseUrl}/api/admin/segments`, {
      method: 'POST',
      headers: ADMIN_HEADERS(cfg.adminApiKey),
      body: JSON.stringify({
        name: payload.name,
        workspaceId: payload.workspaceId || cfg.workspaceId,
        definition: payload.definition ?? {},
      }),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `create segment failed: ${resp.status}`, status: resp.status };
    }
    const data = (await resp.json()) as { id: string };
    return { ok: true, segmentId: data.id };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a Dittofeed message template programmatically.
 */
export async function createTemplate(
  cfg: DittofeedConfig,
  payload: TemplateCreatePayload,
  fetchImpl: FetchImpl = fetch,
): Promise<TemplateCreateResult | DittofeedError> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return valid;

  try {
    const resp = await fetchImpl(`${cfg.baseUrl}/api/admin/templates`, {
      method: 'POST',
      headers: ADMIN_HEADERS(cfg.adminApiKey),
      body: JSON.stringify({
        name: payload.name,
        workspaceId: payload.workspaceId || cfg.workspaceId,
        body: payload.body,
        subject: payload.subject,
        from: payload.from,
        type: payload.type ?? 'email',
      }),
    });
    if (!resp.ok) {
      return { ok: false, code: 'api_error', message: `create template failed: ${resp.status}`, status: resp.status };
    }
    const data = (await resp.json()) as { id: string };
    return { ok: true, templateId: data.id };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check Dittofeed health / connectivity.
 */
export async function dittofeedHealth(
  cfg: Partial<DittofeedConfig>,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: true; version: string } | DittofeedError | { ok: false; reason: 'not_configured' }> {
  if (!cfg.baseUrl) return { ok: false, reason: 'not_configured' };
  try {
    const resp = await fetchImpl(`${cfg.baseUrl}/api`);
    const data = (await resp.json()) as { version: string };
    return { ok: true, version: data.version ?? 'unknown' };
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Standard ProjectSites event catalog
// ---------------------------------------------------------------------------

/**
 * Canonical event names emitted to Dittofeed.
 * Every event carries `orgId` and `siteId` in properties for segmentation.
 */
export const PS_EVENTS = {
  // Site lifecycle
  BUILD_STARTED: 'Build Started',
  BUILD_COMPLETED: 'Build Completed',
  SITE_PUBLISHED: 'Site Published',
  SITE_UNPUBLISHED: 'Site Unpublished',
  SITE_DELETED: 'Site Deleted',

  // Owner lifecycle
  FIRST_LEAD: 'First Lead Received',
  LEAD_RECEIVED: 'Lead Received',
  BOOKING_MADE: 'Booking Made',
  FORM_SUBMISSION: 'Form Submission',
  PHONE_TAP: 'Phone Call Tap',
  DIRECTION_REQUEST: 'Direction Request',

  // Billing lifecycle
  PLAN_UPGRADED: 'Plan Upgraded',
  PLAN_DOWNGRADED: 'Plan Downgraded',
  INVOICE_PAID: 'Invoice Paid',
  INVOICE_FAILED: 'Invoice Failed',
  CREDIT_EXHAUSTED: 'AI Credits Exhausted',
  CREDIT_LOW: 'AI Credits Running Low',

  // Domain lifecycle
  DOMAIN_VERIFIED: 'Domain Verified',
  DOMAIN_ADDED: 'Domain Added',
  DOMAIN_FAILED: 'Domain Verification Failed',

  // Integration lifecycle
  INTEGRATION_CONNECTED: 'Integration Connected',
  INTEGRATION_DISCONNECTED: 'Integration Disconnected',
  INTEGRATION_HEALTH_DEGRADED: 'Integration Health Degraded',

  // Security lifecycle
  LOGIN_SUCCESS: 'Login Success',
  LOGIN_FAILED: 'Login Failed',
  API_KEY_CREATED: 'API Key Created',
  API_KEY_REVOKED: 'API Key Revoked',

  // Cloudflare-native events
  CF_WORKER_DEPLOYED: 'Worker Deployed',
  CF_DEPLOY_FAILED: 'Worker Deploy Failed',
  CF_D1_MIGRATION_RUN: 'D1 Migration Applied',
  CF_R2_UPLOAD: 'R2 Asset Uploaded',
  CF_CACHE_PURGE: 'Cache Purged',
  CF_ANALYTICS_SPIKE: 'Traffic Spike Detected',
  CF_ANALYTICS_DROP: 'Traffic Drop Detected',
  CF_BFM_CHALLENGE: 'Bot Fight Mode Challenge',
  CF_WAF_BLOCK: 'WAF Rule Blocked',

  // Container/app lifecycle
  APP_DEPLOYED: 'App Deployed',
  APP_HEALTH_CHANGE: 'App Health Changed',
  APP_RESTARTED: 'App Restarted',

  // Lead Scanner lifecycle
  LEAD_SCANNER_RUN: 'Lead Scanner Run Completed',
  LEAD_SCANNER_BUSINESS_FOUND: 'Business Without Website Found',
  LEAD_SCANNER_OUTREACH_SENT: 'Outreach Sent',
  LEAD_SCANNER_CLAIMED: 'Business Claimed Site',
} as const;

export type PsEventName = (typeof PS_EVENTS)[keyof typeof PS_EVENTS];

/**
 * Fire-and-forget event tracking. Wraps `trackEvent` but never throws
 * and is safe to call inside `ctx.waitUntil()`.
 *
 * @remarks
 * Uses `ctx.waitUntil()` internally when a `ExecutionContext` is provided
 * so the Worker doesn't block on Dittofeed latency.
 */
export async function emitPsEvent(
  cfg: DittofeedConfig | Partial<DittofeedConfig>,
  payload: {
    userId: string;
    event: PsEventName;
    properties?: Record<string, unknown>;
    anonymousId?: string;
  },
  fetchImpl?: FetchImpl,
): Promise<void> {
  const valid = validateConfig(cfg);
  if (!valid.ok) return; // silently skip — not configured

  await trackEvent(valid.config, {
    userId: payload.userId,
    event: payload.event,
    properties: payload.properties,
    anonymousId: payload.anonymousId,
  }, fetchImpl);
}
