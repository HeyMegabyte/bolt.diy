import { z } from 'zod';

export const GuardrailCheckRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  threshold: z.number().min(0).max(1).default(0.85),
}).strict();
export type GuardrailCheckRequest = z.infer<typeof GuardrailCheckRequestSchema>;

export const GuardrailCheckResponseSchema = z.object({
  safe: z.boolean(),
  score: z.number(),
  category: z.string().nullable(),
  blocked: z.boolean(),
}).strict();
export type GuardrailCheckResponse = z.infer<typeof GuardrailCheckResponseSchema>;
