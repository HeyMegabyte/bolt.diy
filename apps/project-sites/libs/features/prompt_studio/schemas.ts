import { z } from 'zod';

export const PromptTemplateSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  variants: z.array(z.object({
    id: z.string(),
    weight: z.number().min(0).max(1),
  })).optional(),
}).strict();
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const PromptListResponseSchema = z.object({
  templates: z.array(PromptTemplateSchema),
  count: z.number(),
}).strict();
export type PromptListResponse = z.infer<typeof PromptListResponseSchema>;

export const VariantWeightRequestSchema = z.object({
  weights: z.record(z.number().min(0).max(1)),
}).strict();
export type VariantWeightRequest = z.infer<typeof VariantWeightRequestSchema>;

export const VariantWeightResponseSchema = z.object({
  key: z.string(),
  version: z.number(),
  weights: z.record(z.number()),
}).strict();
export type VariantWeightResponse = z.infer<typeof VariantWeightResponseSchema>;

export const RollbackResponseSchema = z.object({
  key: z.string(),
  rolledBackTo: z.number(),
}).strict();
export type RollbackResponse = z.infer<typeof RollbackResponseSchema>;
