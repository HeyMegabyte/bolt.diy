/**
 * @module libs/features/visitor_events_core/schemas
 * @description Zod schemas for Visitor Events Core — the pageview/session ingest
 * pipeline from published sites. Feeds `site_analytics`'s traffic block.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Event kinds a published-site beacon may emit. */
export const VisitorEventTypeSchema = z.enum(['pageview', 'click', 'conversion', 'custom']);
export type VisitorEventType = z.infer<typeof VisitorEventTypeSchema>;

/** Public ingest payload from a published site's beacon. Org/site resolved server-side. */
export const VisitorEventInputSchema = z
  .object({
    sessionId: z.string().min(8).max(128),
    eventType: VisitorEventTypeSchema.default('pageview'),
    path: z.string().max(2048).optional(),
    referrer: z.string().max(2048).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type VisitorEventInput = z.infer<typeof VisitorEventInputSchema>;

/** One `{ path, count }` row of the top-paths breakdown. */
export const PathCountSchema = z
  .object({ path: z.string(), count: z.number().int().min(0) })
  .strict();
/** One `{ type, count }` row of the by-type breakdown. */
export const TypeCountSchema = z
  .object({ type: z.string(), count: z.number().int().min(0) })
  .strict();

/** Aggregated traffic summary for one site over a window. */
export const TrafficSummarySchema = z
  .object({
    pageviews: z.number().int().min(0),
    uniqueSessions: z.number().int().min(0),
    conversions: z.number().int().min(0),
    topPaths: z.array(PathCountSchema),
    byType: z.array(TypeCountSchema),
    windowDays: z.number().int().positive(),
  })
  .strict();
export type TrafficSummary = z.infer<typeof TrafficSummarySchema>;
