/**
 * @module libs/features/integration_directory/schemas
 * @description Zod schemas for the Integration Directory Generator (idea #30).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const IntegrationServiceSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(80),
  category: z.string().max(40).optional(),
  homepageUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  configJson: z.unknown().optional(),
});
export type IntegrationService = z.infer<typeof IntegrationServiceSchema>;

export const IntegrationSeedRequestSchema = z.object({
  services: z.array(IntegrationServiceSchema).min(1).max(50),
});

export const IntegrationGenerateRequestSchema = z.object({
  /** Optional explicit pair list; when omitted, generate full cross-product. */
  pairs: z
    .array(z.tuple([z.string(), z.string()]))
    .max(200)
    .optional(),
  /** Cap on auto-generated pairs (cross-product). Default 200. */
  maxPairs: z.number().int().positive().max(500).default(200),
});
export type IntegrationGenerateRequest = z.infer<typeof IntegrationGenerateRequestSchema>;

export const IntegrationPublishRequestSchema = z.object({
  pageIds: z.array(z.string()).min(1).max(100),
});

/** Build a consistent /integrations/{a}/{b} route. Alphabetical for canonicalization. */
export function integrationRouteSlug(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `/integrations/${first}/${second}`;
}
