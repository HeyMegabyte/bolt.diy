import { z } from 'zod';

export const SiteSearchQueryRequestSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(20).default(5),
}).strict();
export type SiteSearchQueryRequest = z.infer<typeof SiteSearchQueryRequestSchema>;

export const SiteSearchResultSchema = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number().optional(),
}).strict();
export type SiteSearchResult = z.infer<typeof SiteSearchResultSchema>;

export const SiteSearchQueryResponseSchema = z.object({
  results: z.array(SiteSearchResultSchema),
  query: z.string(),
}).strict();
export type SiteSearchQueryResponse = z.infer<typeof SiteSearchQueryResponseSchema>;

export const SiteReindexRequestSchema = z.object({
  chunks: z.array(z.object({
    id: z.string(),
    text: z.string(),
    metadata: z.record(z.string()).optional(),
  })),
}).strict();
export type SiteReindexRequest = z.infer<typeof SiteReindexRequestSchema>;

export const SiteReindexResponseSchema = z.object({
  indexed: z.number(),
  siteId: z.string(),
}).strict();
export type SiteReindexResponse = z.infer<typeof SiteReindexResponseSchema>;
