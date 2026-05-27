/**
 * Site snapshot SSOT. Mirrors D1 `site_snapshots`, `iteration_snapshots`,
 * `snapshot_metrics`.
 */
import { z } from 'zod';

export const LighthouseCategorySchema = z.enum([
  'performance',
  'accessibility',
  'best_practices',
  'seo',
  'pwa',
] as const);
export type LighthouseCategory = z.infer<typeof LighthouseCategorySchema>;

export const LighthouseScoresSchema = z
  .object({
    performance: z.number().int().min(0).max(100),
    accessibility: z.number().int().min(0).max(100),
    best_practices: z.number().int().min(0).max(100),
    seo: z.number().int().min(0).max(100),
    pwa: z.number().int().min(0).max(100).nullable(),
  })
  .strict();

export type LighthouseScores = z.infer<typeof LighthouseScoresSchema>;

export const SnapshotSchema = z
  .object({
    id: z.string().min(1),
    site_id: z.string().min(1),
    iteration: z.number().int().nonnegative(),
    screenshot_url: z.url(),
    ai_description: z.string().nullable(),
    lighthouse_scores: LighthouseScoresSchema.nullable(),
    bundle_size_bytes: z.number().int().nonnegative().nullable(),
    d1_row_count: z.number().int().nonnegative().nullable(),
    r2_storage_bytes: z.number().int().nonnegative().nullable(),
    request_count_24h: z.number().int().nonnegative().nullable(),
    captured_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Snapshot = z.infer<typeof SnapshotSchema>;
