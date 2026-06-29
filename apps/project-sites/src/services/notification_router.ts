/**
 * @module services/notification_router
 * @description Pure channel router for outbound notifications. Determines which
 * channels a notification should be sent on based on user preferences and
 * priority level — critical notifications always deliver via email, others
 * are filtered by the recipient's enabled preferences. Zero I/O — the caller
 * resolves prefs + persists the delivery.
 *
 * @packageDocumentation
 */

/** Supported outbound notification channels. */
export type Channel = 'email' | 'push' | 'in_app' | 'sms';

/** Notification priority — scales urgency of delivery guarantees. */
export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** An outbound notification to be routed. */
export interface Notification {
  readonly id: string;
  readonly channel: Channel;
  readonly priority: Priority;
  readonly title: string;
  readonly body: string;
  readonly recipient: string;
}

/**
 * Per-channel rate limits (messages per hour). The caller enforces
 * these against its own send history — this module only declares them.
 */
export const CHANNEL_LIMITS: Record<Channel, number> = {
  email: 10,
  in_app: 50,
  push: 5,
  sms: 3,
};

/**
 * Whether a channel supports batching — true for email and push (multiple
 * notifications can be coalesced into a single send), false for in_app
 * and sms (each delivered individually).
 *
 * @param channel - The channel to check.
 * @returns `true` when the channel should batch sends.
 *
 * @example
 * shouldBatch('email'); // true
 * shouldBatch('in_app'); // false
 */
export function shouldBatch(channel: Channel): boolean {
  return channel === 'email' || channel === 'push';
}

/**
 * Route a notification to the channels it should be delivered on.
 *
 * - If the original channel is enabled in the user's preferences, the result
 *   includes that channel.
 * - **Critical** notifications **always** include `email` as an override,
 *   regardless of whether email appears in the recipient's preferences
 *   (safety override for password resets, billing failures, security alerts).
 * - Non-critical notifications are filtered to only the channels the
 *   recipient has enabled.
 *
 * @param n - The outbound notification.
 * @param prefs - Per-channel boolean of what the recipient has enabled.
 * @returns The ordered list of channels this notification should be sent on.
 *
 * @example
 * routeNotification(
 *   { id:'n1', channel:'push', priority:'normal', title:'New lead', body:'…', recipient:'usr_1' },
 *   { email:true, push:true, in_app:false, sms:false },
 * );
 * // ['push']
 *
 * @example
 * // Critical always adds email even when email is not the original channel
 * routeNotification(
 *   { id:'n2', channel:'sms', priority:'critical', title:'SEV-1', body:'…', recipient:'usr_1' },
 *   { email:false, push:false, in_app:false, sms:true },
 * );
 * // ['sms', 'email']
 */
export function routeNotification(n: Notification, prefs: Record<Channel, boolean>): Channel[] {
  const channels: Channel[] = [];

  // If the notification's own channel is enabled, ship on it.
  if (prefs[n.channel]) {
    channels.push(n.channel);
  }

  // Critical priority always also delivers via email, regardless of prefs.
  if (n.priority === 'critical' && !channels.includes('email')) {
    channels.push('email');
  }

  return channels;
}
