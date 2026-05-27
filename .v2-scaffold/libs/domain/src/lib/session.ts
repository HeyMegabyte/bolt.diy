/**
 * Session SSOT. Mirrors D1 `sessions`.
 */
import { z } from 'zod';

export const SessionSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    device_fingerprint: z.string().min(1).nullable(),
    ip: z.string().min(1).nullable(),
    ua: z.string().min(1).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    last_seen_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Session = z.infer<typeof SessionSchema>;
