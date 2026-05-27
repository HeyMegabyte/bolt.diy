/**
 * WebSocket / SSE envelope SSOT.
 *
 * The v2 admin multiplexes every live update over a single connection.
 * This discriminated union is the source of truth for every frame
 * the client knows how to handle. Adding a new frame type means:
 *
 *  1. extend this union
 *  2. teach the multiplexed-socket operator to demux by `type`
 *  3. wire the feature lib's reducer
 *
 * @remarks Even though the worker today (AUDIT.md §3.4) ships SSE not
 * WebSockets, this envelope is transport-agnostic so the same shape
 * works for both.
 */
import { z } from 'zod';
import { BillingEventSchema } from './billing.js';
import { JobSchema, JobLocationSchema } from './job.js';
import { LogLineSchema } from './log.js';
import { NotificationSchema } from './notification.js';

export const ChatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(['system', 'user', 'assistant', 'tool'] as const),
    content: z.string(),
    /** Free-form widget payload emitted by the dashboard chat stream. */
    widget: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const WSEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('log_line'), topic: z.string(), payload: LogLineSchema }).strict(),
  z.object({ type: z.literal('job_update'), topic: z.string(), payload: JobSchema }).strict(),
  z.object({ type: z.literal('job_location'), topic: z.string(), payload: JobLocationSchema }).strict(),
  z.object({ type: z.literal('chat_message'), topic: z.string(), payload: ChatMessageSchema }).strict(),
  z.object({ type: z.literal('billing_event'), topic: z.string(), payload: BillingEventSchema }).strict(),
  z.object({ type: z.literal('notification_new'), topic: z.string(), payload: NotificationSchema }).strict(),
  z
    .object({
      type: z.literal('heartbeat'),
      topic: z.string(),
      payload: z.object({ at: z.iso.datetime({ offset: true }) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      topic: z.string(),
      payload: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          request_id: z.string().min(1).nullable(),
        })
        .strict(),
    })
    .strict(),
]);

export type WSEnvelope = z.infer<typeof WSEnvelopeSchema>;
export type WSEnvelopeType = WSEnvelope['type'];
