import { z } from 'zod';

export const UiDescriptorSchema = z.object({
  component: z.string().min(1),
  props: z.record(z.unknown()),
}).strict();
export type UiDescriptor = z.infer<typeof UiDescriptorSchema>;

export const GenerativeUiRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  context: z.string().max(5000).optional(),
  siteId: z.string().optional(),
}).strict();
export type GenerativeUiRequest = z.infer<typeof GenerativeUiRequestSchema>;

export const GenerativeUiResponseSchema = z.object({
  descriptors: z.array(UiDescriptorSchema).min(1).max(20),
  model: z.string(),
}).strict();
export type GenerativeUiResponse = z.infer<typeof GenerativeUiResponseSchema>;
