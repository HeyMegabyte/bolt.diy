/**
 * @module services/notify
 *
 * Server-side Novu trigger — the worker arm of the Novu doctrine
 * ([[notifications-email-webhooks-supervisor]]). Fires a Novu workflow for a
 * subscriber so the in-app bell (and any email/push channels) light up on real
 * platform events (publish, build, domain, AI, billing). Pairs with the
 * frontend `notif-bell` which renders the same subscriber's feed.
 *
 * Safe by design: returns `{ ok: false }` (never throws) when the secret key is
 * absent or Novu errors, so callers can `c.executionCtx.waitUntil(notifyUser(...))`
 * fire-and-forget without risking the request. The subscriberId MUST match what
 * the bell uses for that user (their email / `session.identifier`).
 *
 * @example
 * c.executionCtx.waitUntil(
 *   notifyUser(c.env, { subscriberId: ownerEmail, subject: 'Site published 🎉', body: `${slug}.projectsites.dev is live.` })
 * );
 */
import type { Env } from '../types/env.js';
import { NovuEventSchema, renderNovuEvent } from './novu_triggers.js';

const NOVU_TRIGGER_URL = 'https://api.novu.co/v1/events/trigger';
const DEFAULT_WORKFLOW = 'ps-notify';

export interface NotifyInput {
  /** Novu subscriber id — must equal the bell's subscriberId (the user's email). */
  subscriberId: string;
  subject: string;
  body: string;
  /** Workflow trigger identifier; defaults to the shared `ps-notify` workflow. */
  workflowId?: string;
}

export interface NotifyResult {
  ok: boolean;
  /** Novu transactionId on success, or a short reason on skip/failure. */
  detail?: string;
}

/**
 * Trigger a Novu workflow for one subscriber. Never throws.
 *
 * @throws Never — all failures are caught and returned as `{ ok: false }`.
 */
export async function notifyUser(env: Env, input: NotifyInput): Promise<NotifyResult> {
  const key = env.NOVU_SECRET_KEY ?? env.NOVU_API_KEY;
  if (!key) return { ok: false, detail: 'no_key' };
  if (!input.subscriberId) return { ok: false, detail: 'no_subscriber' };

  try {
    const res = await fetch(NOVU_TRIGGER_URL, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Novu auto-suffixes trigger identifiers on creation (e.g.
        // `ps-notify-eiz1pyxe`), so the real identifier lives in the
        // `NOVU_WORKFLOW_ID` secret rather than a hardcoded literal. Falls back
        // to the bare `ps-notify` slug for local/dev where the env is unset.
        name: input.workflowId ?? env.NOVU_WORKFLOW_ID ?? DEFAULT_WORKFLOW,
        to: { subscriberId: input.subscriberId },
        payload: { subject: input.subject, body: input.body },
      }),
    });
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          event: 'notify.failed',
          status: res.status,
          subscriber: input.subscriberId,
        }),
      );
      return { ok: false, detail: `http_${res.status}` };
    }
    const json = (await res.json().catch(() => ({}))) as { data?: { transactionId?: string } };
    return { ok: true, detail: json?.data?.transactionId };
  } catch (err) {
    console.warn(JSON.stringify({ event: 'notify.error', message: (err as Error)?.message }));
    return { ok: false, detail: 'exception' };
  }
}

/**
 * Notify an org's owner by resolving their email from D1, then triggering Novu.
 * For server contexts WITHOUT an authenticated user (webhooks, workflow
 * callbacks) where only `orgId` is known. The resolved email matches the bell's
 * subscriberId for that user. Never throws.
 *
 * @example
 * c.executionCtx.waitUntil(
 *   notifySiteOwner(c.env, c.env.DB, { orgId, subject: 'Payment received', body: 'Your subscription is active.' })
 * );
 */
export async function notifySiteOwner(
  env: Env,
  db: D1Database,
  input: { orgId: string; subject: string; body: string; workflowId?: string },
): Promise<NotifyResult> {
  if (!input.orgId) return { ok: false, detail: 'no_org' };
  try {
    const row = await db
      .prepare(
        'SELECT u.email AS email FROM users u JOIN memberships m ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.created_at ASC LIMIT 1',
      )
      .bind(input.orgId)
      .first<{ email: string }>();
    if (!row?.email) return { ok: false, detail: 'no_owner' };
    return await notifyUser(env, {
      subscriberId: row.email,
      subject: input.subject,
      body: input.body,
      workflowId: input.workflowId,
    });
  } catch (err) {
    console.warn(
      JSON.stringify({ event: 'notify.owner_lookup_failed', message: (err as Error)?.message }),
    );
    return { ok: false, detail: 'lookup_failed' };
  }
}

/**
 * Fire a TYPED platform event for one subscriber: validate against
 * {@link NovuEventSchema}, render actionable bell copy via {@link renderNovuEvent},
 * and dispatch over the live `notifyUser` transport. The one-line call any worker
 * service uses to notify a user of a build/payment/domain/team/AI/browser/DB event
 * without hand-writing subject/body. Never throws.
 *
 * @param input.event - A payload matching one variant of {@link NovuEventSchema};
 *   an invalid shape returns `{ ok: false, detail: 'invalid_event' }` and never sends.
 * @example
 * c.executionCtx.waitUntil(
 *   notifyEvent(c.env, { subscriberId: ownerEmail, event: { event: 'domain.active', tenantId, hostname } })
 * );
 * @throws Never.
 */
export async function notifyEvent(
  env: Env,
  input: { subscriberId: string; event: unknown; workflowId?: string },
): Promise<NotifyResult> {
  const parsed = NovuEventSchema.safeParse(input.event);
  if (!parsed.success) return { ok: false, detail: 'invalid_event' };
  const { subject, body } = renderNovuEvent(parsed.data);
  return notifyUser(env, { subscriberId: input.subscriberId, subject, body, workflowId: input.workflowId });
}

/**
 * Org-scoped variant of {@link notifyEvent}: resolve the org owner's email from
 * D1, then dispatch the typed event. For webhook/workflow contexts where only
 * `orgId` is known. Never throws.
 *
 * @example
 * c.executionCtx.waitUntil(
 *   notifyOwnerEvent(c.env, c.env.DB, { orgId, event: { event: 'payment.succeeded', tenantId: orgId, amountCents, currency } })
 * );
 * @throws Never.
 */
export async function notifyOwnerEvent(
  env: Env,
  db: D1Database,
  input: { orgId: string; event: unknown; workflowId?: string },
): Promise<NotifyResult> {
  const parsed = NovuEventSchema.safeParse(input.event);
  if (!parsed.success) return { ok: false, detail: 'invalid_event' };
  const { subject, body } = renderNovuEvent(parsed.data);
  return notifySiteOwner(env, db, { orgId: input.orgId, subject, body, workflowId: input.workflowId });
}
