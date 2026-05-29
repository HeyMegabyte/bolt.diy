/**
 * @module libs/features/pseo_matrix/schemas
 * @description Zod schemas for pSEO Matrix v2 (idea #29).
 *
 * v2 differs from v1 by being USER-TASK-keyed (not keyword-keyed) and enforcing
 * a hard >=40% unique-data floor sourced from live Google Places / real reviews
 * / real pricing.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const UNIQUE_DATA_FLOOR_PCT = 40;
export const MAX_PAGES_PER_AXIS = 200;

/** A single axis the matrix iterates on. Common names: user_task, city, service_offering. */
export const PseoAxisSchema = z.object({
  axisName: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/),
  values: z.array(z.string().min(1).max(80)).min(1).max(MAX_PAGES_PER_AXIS),
  cap: z.number().int().positive().max(MAX_PAGES_PER_AXIS).default(MAX_PAGES_PER_AXIS),
});
export type PseoAxis = z.infer<typeof PseoAxisSchema>;

/** Real-data attribution per page — must hit >=40% combined to publish. */
export const DataSourcesSchema = z.object({
  googlePlaces: z.number().int().min(0).default(0),
  reviews: z.number().int().min(0).default(0),
  pricing: z.number().int().min(0).default(0),
  other: z.number().int().min(0).default(0),
});
export type DataSources = z.infer<typeof DataSourcesSchema>;

/** A generated page row (mirrors pseo_pages_v2 D1). */
export const PseoPageV2Schema = z.object({
  id: z.string().uuid().optional(),
  siteId: z.string().min(1),
  axisCombo: z.record(z.string(), z.string()),
  slug: z.string().regex(/^\/[a-z0-9\/-]+$/),
  contentJson: z.unknown().optional(),
  wordCount: z.number().int().min(0).default(0),
  uniqueDataPct: z.number().int().min(0).max(100).default(0),
  dataSources: DataSourcesSchema.default({ googlePlaces: 0, reviews: 0, pricing: 0, other: 0 }),
  status: z
    .enum(['draft', 'approved', 'published', 'rejected', 'below_floor'])
    .default('draft'),
});
export type PseoPageV2 = z.infer<typeof PseoPageV2Schema>;

/** POST /api/sites/:id/pseo/v2/generate body */
export const PseoGenerateRequestSchema = z.object({
  axes: z.array(PseoAxisSchema).min(1).max(5),
  maxPages: z.number().int().positive().max(MAX_PAGES_PER_AXIS).default(MAX_PAGES_PER_AXIS),
});
export type PseoGenerateRequest = z.infer<typeof PseoGenerateRequestSchema>;

/** POST /api/sites/:id/pseo/v2/publish body */
export const PseoPublishRequestSchema = z.object({
  pageIds: z.array(z.string()).min(1).max(50),
});

/** Helper: compute axis combo hash deterministically. */
export function axisComboHash(combo: Record<string, string>): string {
  const sortedKeys = Object.keys(combo).sort();
  const canonical = sortedKeys.map((k) => `${k}=${combo[k]}`).join('|');
  // Simple stable hash — production uses crypto.subtle.digest; this is
  // adequate for D1 unique-index dedupe of small (axis_name,value) pairs.
  let h = 0;
  for (let i = 0; i < canonical.length; i++) {
    h = (h * 31 + canonical.charCodeAt(i)) | 0;
  }
  return `c_${(h >>> 0).toString(16)}_${canonical.length}`;
}

/** Helper: derive slug from axis combo + base prefix. */
export function comboToSlug(combo: Record<string, string>, prefix = '/tasks'): string {
  const parts = Object.values(combo)
    .map((v) =>
      v
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean);
  return `${prefix}/${parts.join('/')}`;
}

/** Compute uniqueDataPct from raw data-source counts vs word count. */
export function computeUniqueDataPct(sources: DataSources, wordCount: number): number {
  if (wordCount <= 0) return 0;
  const totalSourcePoints =
    sources.googlePlaces * 25 +
    sources.reviews * 15 +
    sources.pricing * 20 +
    sources.other * 5;
  const pct = Math.round((totalSourcePoints / Math.max(wordCount, 200)) * 100);
  return Math.min(pct, 100);
}
