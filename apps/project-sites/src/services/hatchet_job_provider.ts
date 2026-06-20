/**
 * @module services/hatchet_job_provider
 *
 * @description
 * `HatchetJobProvider` — the `hatchet` backend adapter for the §20 job dispatch
 * port, completing the 3-plane set (CF Workflows · Inngest · Hatchet Cloud). Heavy
 * kinds (site-generation, lead-scan, screenshot, crawl, browser) push a trigger
 * event to Hatchet Cloud (ADR-0004 — Cloud, never Fly); the Hatchet workflow for
 * that event runs the long/stateful/browser work.
 *
 * Idempotency (§23): Hatchet's event push does NOT natively dedupe by an arbitrary
 * id, so the dedupe key rides in event metadata + payload and the CONSUMING Hatchet
 * workflow enforces once-only via an inbox/idempotency record (§18). The adapter
 * surfaces `jobId = ctx.idempotencyKey` for correlation.
 *
 * Depends on an injected {@link HatchetPusher} seam (binds `pushHatchetEvent` in
 * prod) → unit-testable with a fake. Refuses non-hatchet-routed kinds.
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 * @see docs/adr/0004-hatchet-cloud-not-flyio.md
 */

import { routeJob, type JobKind } from '../platform/workflow-router.js';
import {
  validateJobContext,
  type JobRef,
  type JobStatus,
  type ProjectSitesJobContext,
  type ProjectSitesJobProvider,
} from '../platform/job-provider.js';
import type { HatchetPushResult } from './hatchet.js';

/** Push a Hatchet event. Prod binds `pushHatchetEvent(env, ...)`; tests fake it. */
export type HatchetPusher = (
  key: string,
  data: Record<string, unknown>,
  opts?: { metadata?: Record<string, string> },
) => Promise<HatchetPushResult>;

/** Job kind → the Hatchet trigger event the durable workflow listens for. */
const KIND_TO_EVENT: Partial<Record<JobKind, string>> = {
  'site-generation': 'job/site-generation.requested',
  'lead-scan': 'job/lead-scan.requested',
  'screenshot-job': 'job/screenshot.requested',
  'crawl-job': 'job/crawl.requested',
  'browser-job': 'job/browser.requested',
};

/** Build the string-only metadata Hatchet attaches to the event run. */
function buildMetadata(ctx: ProjectSitesJobContext): Record<string, string> {
  const m: Record<string, string> = {
    idempotencyKey: ctx.idempotencyKey,
    traceId: ctx.traceId,
    requestId: ctx.requestId,
    source: ctx.source,
  };
  if (ctx.tenantId) m.tenantId = ctx.tenantId;
  if (ctx.siteId) m.siteId = ctx.siteId;
  if (ctx.plan) m.plan = ctx.plan;
  return m;
}

/**
 * Dispatches heavy jobs to Hatchet Cloud.
 *
 * @example
 * const provider = new HatchetJobProvider((k, d, o) => pushHatchetEvent(env, k, d, o));
 * await provider.start('site-generation', ctx, { slug });
 */
export class HatchetJobProvider implements ProjectSitesJobProvider {
  constructor(private readonly pusher: HatchetPusher) {}

  async start(kind: JobKind, ctx: ProjectSitesJobContext, payload?: unknown): Promise<JobRef> {
    if (routeJob(kind).backend !== 'hatchet') {
      throw new Error(`HatchetJobProvider cannot run "${kind}" (not a Hatchet job)`);
    }
    const eventKey = KIND_TO_EVENT[kind];
    if (!eventKey) throw new Error(`No Hatchet event mapped for job "${kind}"`);

    validateJobContext(kind, ctx);

    const result = await this.pusher(
      eventKey,
      {
        payload: payload ?? null,
        _ctx: {
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId: ctx.userId,
          requestId: ctx.requestId,
          traceId: ctx.traceId,
          source: ctx.source,
          plan: ctx.plan,
        },
      },
      { metadata: buildMetadata(ctx) },
    );
    if (!result.ok) {
      throw new Error(
        `Hatchet push failed for "${kind}": ${result.reason ?? 'unknown'}${result.status ? ` (${result.status})` : ''}`,
      );
    }

    return {
      jobId: ctx.idempotencyKey,
      kind,
      backend: 'hatchet',
      status: 'queued',
      idempotencyKey: ctx.idempotencyKey,
      createdAt: ctx.createdAt,
    };
  }

  /** Run status requires the Hatchet runs REST API (follow-on); read via dashboard/D1 mirror (§37). */
  async getJobStatus(_jobId: string): Promise<JobStatus | null> {
    return null;
  }

  /** Cancellation requires the Hatchet runs REST API (follow-on); no-op for now. */
  async cancelJob(_jobId: string): Promise<void> {
    // intentional no-op until the Hatchet cancel endpoint is wired
  }
}
