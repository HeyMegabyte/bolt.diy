/**
 * Email (Resend primary, SendGrid fallback) + push via the per-user NotificationHub DO.
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(env: Env, input: EmailInput): Promise<void> {
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    });
    if (!res.ok) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Resend failed: ${await res.text()}`);
    }
    return;
  }
  if (env.SENDGRID_API_KEY) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: env.EMAIL_FROM },
        subject: input.subject,
        content: [{ type: 'text/html', value: input.html }],
      }),
    });
    if (!res.ok) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `SendGrid failed: ${await res.text()}`);
    }
    return;
  }
  throw new AppError(ErrorCode.INTERNAL_ERROR, 'No email provider configured');
}

/** Push a notification to a single user via the NotificationHub DO. */
export async function pushNotification(
  env: Env,
  args: { userId: string; payload: unknown },
): Promise<void> {
  const id = env.NOTIFICATION_HUB.idFromName(args.userId);
  const stub = env.NOTIFICATION_HUB.get(id);
  await stub.fetch('https://do/append', {
    method: 'POST',
    body: JSON.stringify(args.payload),
  });
}
