/**
 * @module libs/features/conversational_analytics/schemas
 *
 * Zod schemas for Conversational Analytics (#58, ROI 2.70).
 * Natural language → analytics query intent parser.
 */
import { z } from 'zod';

export const MetricIntentSchema = z.object({
  metric: z.enum(['visitors', 'pageviews', 'leads', 'conversions', 'bounce_rate', 'revenue', 'top_pages', 'traffic_sources', 'social_engagement', 'email_opens', 'search_queries']),
  timeRange: z.enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'this_year']),
  groupBy: z.enum(['none', 'day', 'week', 'month', 'source', 'page']).default('none'),
  limit: z.number().int().min(1).max(100).default(10),
  confidence: z.number().min(0).max(1),
});

export type MetricIntent = z.infer<typeof MetricIntentSchema>;

export const AnalyticsQuerySchema = z.object({
  query: z.string(),
  intent: MetricIntentSchema,
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().optional(),
  suggestedQuery: z.string().optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
