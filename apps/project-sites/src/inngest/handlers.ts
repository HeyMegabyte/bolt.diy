/**
 * @module inngest/handlers
 *
 * @description
 * Pure consumer logic for the job-trigger events the `InngestJobProvider` sends
 * (§20). Each handler takes `env` + the event `data` (+ injectable deps) and does
 * the real work, so it is unit-tested without the Inngest harness. The thin
 * Inngest function wrappers (functions.ts) call these; env reaches them via the
 * serve middleware.
 *
 * `handleEmailRequested` closes the loop dispatched by the §13 plane:
 *   POST /api/jobs {kind:'notification-workflow'|'lifecycle-email'}
 *     → InngestJobProvider.send('job/email.requested')
 *       → this handler → getEmailProvider(env).sendTransactional → SES (ADR-0019).
 *
 * @see docs/adr/0019-amazon-ses-plus-listmonk-email.md
 */

import type { Env } from '../types/env.js';
import { getEmailProvider, type EmailDeps } from '../platform/email-router.js';
import type { EmailKind, EmailResult } from '../platform/email.js';

/** Shape the `job/email.requested` event carries in its `data`. */
export interface EmailRequestedData {
  payload?: {
    to?: string | string[];
    subject?: string;
    html?: string;
    kind?: EmailKind;
  } | null;
  _ctx?: { idempotencyKey?: string };
}

/** Thrown when an email-request event is missing required payload fields. */
export class EmailEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailEventError';
  }
}

/**
 * Handle a `job/email.requested` event: send the transactional email through the
 * env-selected rail (SES, or fake locally).
 *
 * @throws {EmailEventError} when the event payload lacks to/subject/html.
 * @example await handleEmailRequested(env, event.data);
 */
export async function handleEmailRequested(
  env: Env,
  data: EmailRequestedData,
  deps: EmailDeps = {},
): Promise<EmailResult> {
  const p = data.payload;
  if (!p || !p.to || !p.subject || !p.html) {
    throw new EmailEventError('email-request event requires payload.to/subject/html');
  }
  return getEmailProvider(env, deps).sendTransactional({
    kind: p.kind ?? 'transactional',
    to: p.to,
    subject: p.subject,
    html: p.html,
    idempotencyKey: data._ctx?.idempotencyKey,
  });
}
