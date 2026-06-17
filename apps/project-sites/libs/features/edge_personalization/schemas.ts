import { z } from 'zod';

export const PersonalizationSignalsSchema = z.object({
  geo: z.string().optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  referrer: z.string().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  isReturn: z.boolean().optional(),
}).strict();
export type PersonalizationSignals = z.infer<typeof PersonalizationSignalsSchema>;

export const VariantRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: PersonalizationSignalsSchema,
  priority: z.number().int().default(0),
}).strict();
export type VariantRule = z.infer<typeof VariantRuleSchema>;

export const UpsertVariantsRequestSchema = z.object({
  variants: z.array(VariantRuleSchema).min(1).max(50),
}).strict();
export type UpsertVariantsRequest = z.infer<typeof UpsertVariantsRequestSchema>;

export const UpsertVariantsResponseSchema = z.object({
  siteId: z.string(),
  count: z.number(),
}).strict();
export type UpsertVariantsResponse = z.infer<typeof UpsertVariantsResponseSchema>;

export const ResolveVariantResponseSchema = z.object({
  siteId: z.string(),
  variantId: z.string(),
  variantName: z.string(),
}).strict();
export type ResolveVariantResponse = z.infer<typeof ResolveVariantResponseSchema>;
