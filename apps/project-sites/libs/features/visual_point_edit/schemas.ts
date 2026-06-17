import { z } from 'zod';

export const PointEditRequestSchema = z.object({
  nodeId: z.string().min(1),
  instruction: z.string().min(1).max(2000),
  siteId: z.string().min(1),
}).strict();

export type PointEditRequest = z.infer<typeof PointEditRequestSchema>;

export const PointEditResponseSchema = z.object({
  ok: z.literal(true),
  patched: z.literal(true),
  node: z.string(),
}).strict();

export type PointEditResponse = z.infer<typeof PointEditResponseSchema>;
