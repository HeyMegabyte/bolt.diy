import { z } from 'zod';

export const ConciergeMessageRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().optional(),
}).strict();
export type ConciergeMessageRequest = z.infer<typeof ConciergeMessageRequestSchema>;

export const ConciergeMessageResponseSchema = z.object({
  reply: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), args: z.record(z.unknown()) })).optional(),
  groundedOn: z.array(z.string()).optional(),
}).strict();
export type ConciergeMessageResponse = z.infer<typeof ConciergeMessageResponseSchema>;

export const ConciergeConfigResponseSchema = z.object({
  siteId: z.string(),
  enabled: z.boolean(),
  greeting: z.string(),
}).strict();
export type ConciergeConfigResponse = z.infer<typeof ConciergeConfigResponseSchema>;
