/**
 * Notification SSOT. Mirrors D1 `notifications`.
 */
import { z } from 'zod';

export const NotificationTypeSchema = z.enum([
  'system',
  'billing',
  'security',
  'job',
  'booking',
  'crew',
  'mention',
  'comment',
  'broadcast',
  'ai_task',
  'workflow',
] as const);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    tenant_id: z.string().min(1).nullable(),
    type: NotificationTypeSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(2000),
    deeplink_url: z.url().nullable(),
    read_at: z.iso.datetime({ offset: true }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Notification = z.infer<typeof NotificationSchema>;
