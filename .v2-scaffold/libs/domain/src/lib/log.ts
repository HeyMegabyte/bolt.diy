/**
 * Structured log-line SSOT. Used by the live SSE log feed
 * (`GET /api/apps/instances/:id/logs`).
 */
import { z } from 'zod';

export const LogLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogLineSchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }),
    level: LogLevelSchema,
    source: z.string().min(1),
    message: z.string(),
    request_id: z.string().min(1).nullable(),
    fields: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type LogLine = z.infer<typeof LogLineSchema>;
