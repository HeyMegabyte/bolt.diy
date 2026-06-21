import { z } from 'zod';

export const AudioSummaryGenerateRequestSchema = z.object({
  route: z.string().min(1).max(500),
  text: z.string().min(1).max(10000),
  voice: z.string().optional(),
}).strict();
export type AudioSummaryGenerateRequest = z.infer<typeof AudioSummaryGenerateRequestSchema>;

export const AudioSummaryGenerateResponseSchema = z.object({
  siteId: z.string(),
  route: z.string(),
  audioKey: z.string(),
  durationHint: z.string().optional(),
}).strict();
export type AudioSummaryGenerateResponse = z.infer<typeof AudioSummaryGenerateResponseSchema>;

export const AudioSummaryGetResponseSchema = z.object({
  siteId: z.string(),
  route: z.string(),
  audioUrl: z.string().nullable(),
}).strict();
export type AudioSummaryGetResponse = z.infer<typeof AudioSummaryGetResponseSchema>;
