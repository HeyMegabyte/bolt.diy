import { z } from 'zod';
export const SiteCompareSchema = z.object({ siteIdA: z.string().uuid(), siteIdB: z.string().uuid() }).strict();
export type SiteCompareInput = z.infer<typeof SiteCompareSchema>;
export const DiffRowSchema = z.object({ metric: z.string(), valueA: z.string(), valueB: z.string(), diff: z.string().nullable() });
export const CompareResponseSchema = z.object({ siteA: z.object({ slug: z.string(), name: z.string() }), siteB: z.object({ slug: z.string(), name: z.string() }), rows: z.array(DiffRowSchema) });

export type CompareResponse = z.infer<typeof CompareResponseSchema>;
export type DiffRow = z.infer<typeof DiffRowSchema>;
