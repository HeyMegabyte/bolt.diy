/**
 * @module libs/features/site_analytics/schemas
 * @description Zod schemas for Site Analytics — an owner-facing dashboard that
 * aggregates the lead/engagement data the platform ALREADY captures (contacts,
 * form submissions, newsletter subscribers, donations) per site. No new event
 * pipeline; it reads existing tables, so it ships value immediately and a
 * `visitor_events_core` (pageviews/sessions) can extend it later.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { TrafficSummarySchema } from '../visitor_events_core/schemas.js';

/** One `{ source, count }` slice of the contacts breakdown. */
export const SourceCountSchema = z
  .object({ source: z.string(), count: z.number().int().min(0) })
  .strict();
export type SourceCount = z.infer<typeof SourceCountSchema>;

/** Owner-facing analytics summary for a single site. */
export const SiteAnalyticsSummarySchema = z
  .object({
    siteId: z.string().min(1),
    windowDays: z.number().int().positive(),
    contacts: z
      .object({
        total: z.number().int().min(0),
        newInWindow: z.number().int().min(0),
        bySource: z.array(SourceCountSchema),
      })
      .strict(),
    formSubmissions: z
      .object({ total: z.number().int().min(0), newInWindow: z.number().int().min(0) })
      .strict(),
    newsletter: z
      .object({ confirmed: z.number().int().min(0), total: z.number().int().min(0) })
      .strict(),
    donations: z
      .object({ raisedCents: z.number().int().min(0), count: z.number().int().min(0) })
      .strict(),
    traffic: TrafficSummarySchema,
    generatedAt: z.string(),
  })
  .strict();
export type SiteAnalyticsSummary = z.infer<typeof SiteAnalyticsSummarySchema>;
