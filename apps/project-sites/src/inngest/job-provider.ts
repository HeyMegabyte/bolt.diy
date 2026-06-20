/**
 * @module inngest/job-provider
 *
 * @description
 * `InngestJobProvider` — the first real `ProjectSitesJobProvider` backend adapter
 * (convergence §20). Implements the dispatch port for event-driven kinds by
 * sending a trigger event to the self-hosted Inngest plane (§13); the Inngest
 * function for that event runs the durable work.
 *
 * Idempotency (§23): the event is sent with `id = ctx.idempotencyKey` — Inngest
 * dedupes by event id, so re-dispatching the same key is a no-op on the server.
 * The provider depends on a narrow {@link InngestSender} (not the full SDK type)
 * so it's unit-testable with a fake and wraps the real `inngest` client in prod.
 *
 * Only event-driven kinds route here (per JOB_DEFINITIONS → `inngest`); starting
 * any other kind throws (the WorkflowRouter should never hand those to us).
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import {
  routeJob,
  type JobKind,
} from '../platform/workflow-router.js';
import {
  validateJobContext,
  type JobRef,
  type JobStatus,
  type ProjectSitesJobContext,
  type ProjectSitesJobProvider,
} from '../platform/job-provider.js';

/** Minimal slice of the Inngest client this adapter needs (testable seam). */
export interface InngestSender {
  send(event: {
    name: string;
    data: Record<string, unknown>;
    id?: string;
  }): Promise<{ ids: string[] }>;
}

/** Job kind → the Inngest trigger event the durable function listens for. */
const KIND_TO_EVENT: Partial<Record<JobKind, string>> = {
  'notification-workflow': 'job/notification.requested',
  'lifecycle-email': 'job/email.requested',
};

/**
 * Dispatches event-driven jobs to the self-hosted Inngest plane.
 *
 * @example
 * const provider = new InngestJobProvider(inngest); // real client in prod
 * await provider.start('notification-workflow', ctx, { template: 'site.published' });
 */
export class InngestJobProvider implements ProjectSitesJobProvider {
  constructor(private readonly sender: InngestSender) {}

  async start(kind: JobKind, ctx: ProjectSitesJobContext, payload?: unknown): Promise<JobRef> {
    if (routeJob(kind).backend !== 'inngest') {
      throw new Error(`InngestJobProvider cannot run "${kind}" (not an inngest-routed job)`);
    }
    const eventName = KIND_TO_EVENT[kind];
    if (!eventName) throw new Error(`No Inngest event mapped for job "${kind}"`);

    validateJobContext(kind, ctx);

    await this.sender.send({
      name: eventName,
      // dedupe key — Inngest ignores a repeat event with the same id (§23)
      id: ctx.idempotencyKey,
      data: {
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
    });

    return {
      jobId: ctx.idempotencyKey,
      kind,
      backend: 'inngest',
      status: 'queued',
      idempotencyKey: ctx.idempotencyKey,
      createdAt: ctx.createdAt,
    };
  }

  /**
   * Self-hosted Inngest does not expose per-run status via the send API; status
   * is read from the Inngest dashboard or a D1 mirror (admin Time Machine, §37).
   * Returns null so the dispatcher's cross-provider lookup falls through cleanly.
   */
  async getJobStatus(_jobId: string): Promise<JobStatus | null> {
    return null;
  }

  /** Cancellation requires the Inngest REST API (follow-on); no-op for now. */
  async cancelJob(_jobId: string): Promise<void> {
    // intentional no-op until the Inngest REST cancel endpoint is wired
  }
}
