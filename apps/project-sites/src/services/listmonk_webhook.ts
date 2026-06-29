/**
 * @module services/listmonk_webhook
 * @description Pure classifier for inbound Listmonk webhook payloads. Maps a
 * raw POST body (`Record<string, unknown>`) to a typed `ListmonkWebhook` or
 * returns `null` for unrecognised events or malformed payloads. Zero I/O,
 * deterministic, never throws.
 * @packageDocumentation
 */

/**
 * The recognised Listmonk webhook event types.
 *
 * See https://listmonk.app/docs/webhooks/ for the canonical schema.
 */
export const LISTMONK_EVENTS = [
  'subscribed',
  'unsubscribed',
  'email.opened',
  'email.clicked',
  'campaign.started',
  'campaign.finished',
  'bounce',
] as const satisfies readonly string[];

/** A known Listmonk webhook event name. */
export type ListmonkEvent = (typeof LISTMONK_EVENTS)[number];

/** A validated, typed Listmonk webhook payload. */
export interface ListmonkWebhook {
  readonly event: ListmonkEvent;
  readonly subscriber_id: number;
  readonly email: string;
  readonly campaign_id?: number;
  readonly url?: string;
  readonly timestamp: string;
}

/**
 * Attempt to classify a raw inbound webhook body as a recognised Listmonk
 * event. Returns a typed `ListmonkWebhook` on success or `null` when the
 * event type is unknown or the payload is structurally invalid.
 *
 * The payload may be shaped as:
 *   `{ event, data: { subscriber: { id, email }, campaign_id?, url? }, timestamp? }`
 * or the older flattened form:
 *   `{ event, subscriber_id, email, campaign_id?, url?, timestamp? }`.
 *
 * @param body - The raw parsed JSON body received from the Listmonk webhook.
 * @returns A validated webhook object, or `null` if the event type is unknown
 *   or required fields are missing.
 *
 * @example
 * ```ts
 * const wh = classifyEvent({
 *   event: 'subscribed',
 *   data: { subscriber: { id: 42, email: 'a@b.com' } },
 *   timestamp: '2026-06-29T12:00:00Z',
 * });
 * // → { event: 'subscribed', subscriber_id: 42, email: 'a@b.com', timestamp: '2026-06-29T12:00:00Z' }
 * ```
 *
 * @example
 * ```ts
 * classifyEvent({ event: 'unknown' });
 * // → null
 * ```
 *
 * @example
 * ```ts
 * classifyEvent({});
 * // → null
 * ```
 */
export function classifyEvent(body: Record<string, unknown>): ListmonkWebhook | null {
  if (!body || typeof body !== 'object') return null;

  const rawEvent = body['event'];
  if (typeof rawEvent !== 'string') return null;

  // Normalise to known event type.
  const event = rawEvent as ListmonkEvent;
  if (!LISTMONK_EVENTS.includes(event)) return null;

  // Extract subscriber info — Listmonk nests it under `data.subscriber`.
  const data = body['data'];
  const dataObj = isRecord(data) ? data : undefined;

  let subscriberId: number | undefined;
  let email: string | undefined;

  if (dataObj) {
    const sub = dataObj['subscriber'];
    if (isRecord(sub)) {
      subscriberId = typeof sub['id'] === 'number' ? (sub['id'] as number) : undefined;
      email = typeof sub['email'] === 'string' ? (sub['email'] as string) : undefined;
    }
    // Fallback: flat subscriber_id / email on data
    if (subscriberId === undefined && typeof dataObj['subscriber_id'] === 'number') {
      subscriberId = dataObj['subscriber_id'] as number;
    }
    if (email === undefined && typeof dataObj['email'] === 'string') {
      email = dataObj['email'] as string;
    }
  }

  // Fallback: flat subscriber_id / email on root body
  if (subscriberId === undefined && typeof body['subscriber_id'] === 'number') {
    subscriberId = body['subscriber_id'] as number;
  }
  if (email === undefined && typeof body['email'] === 'string') {
    email = body['email'] as string;
  }

  // subscriber_id and email are required
  if (subscriberId === undefined || email === undefined) return null;

  // Extract optional fields
  let campaignId: number | undefined;
  if (dataObj && typeof dataObj['campaign_id'] === 'number') {
    campaignId = dataObj['campaign_id'] as number;
  } else if (typeof body['campaign_id'] === 'number') {
    campaignId = body['campaign_id'] as number;
  }

  let url: string | undefined;
  if (dataObj && typeof dataObj['url'] === 'string') {
    url = dataObj['url'] as string;
  } else if (typeof body['url'] === 'string') {
    url = body['url'] as string;
  }

  // timestamp — prefer data.timestamp, fallback to body.timestamp, then now
  let timestamp: string;
  if (dataObj && typeof dataObj['timestamp'] === 'string') {
    timestamp = dataObj['timestamp'] as string;
  } else if (typeof body['timestamp'] === 'string') {
    timestamp = body['timestamp'] as string;
  } else {
    timestamp = new Date().toISOString();
  }

  return Object.freeze({
    campaign_id: campaignId,
    email,
    event,
    subscriber_id: subscriberId,
    timestamp,
    url,
  }) satisfies ListmonkWebhook;
}

/** Narrow type guard: is `v` a non-null `object` (not array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
