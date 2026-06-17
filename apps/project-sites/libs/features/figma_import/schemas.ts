import { z } from 'zod';

export const FigmaImportRequestSchema = z.object({
  token: z.string().min(10, 'Figma personal-access token must be at least 10 characters'),
  fileKey: z.string().min(3, 'Figma file key must be at least 3 characters'),
}).strict();

export type FigmaImportRequest = z.infer<typeof FigmaImportRequestSchema>;

export const FigmaImportResponseSchema = z.object({
  ok: z.literal(true),
  tokens: z.record(z.string(), z.string()),
  components: z.array(z.string()),
}).strict();

export type FigmaImportResponse = z.infer<typeof FigmaImportResponseSchema>;
