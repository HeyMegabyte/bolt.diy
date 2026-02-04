/**
 * Analytics and metrics schemas
 */
import { z } from 'zod';
import { uuidSchema, timestampsSchema } from './base.js';

// ============================================================================
// ANALYTICS DAILY ROLLUP
// ============================================================================

export const analyticsDailySchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  page_views: z.number().int().nonnegative(),
  unique_visitors: z.number().int().nonnegative(),
  bandwidth_bytes: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  cache_hit_ratio: z.number().min(0).max(1).nullable().optional(),
  avg_response_time_ms: z.number().nonnegative().nullable().optional(),
  error_count: z.number().int().nonnegative().nullable().optional(),
  top_countries: z.record(z.number().int()).nullable().optional(),
  top_referrers: z.record(z.number().int()).nullable().optional(),
  top_paths: z.record(z.number().int()).nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// FUNNEL EVENTS
// ============================================================================

export const funnelEventTypeSchema = z.enum([
  'signup_started',
  'signup_completed',
  'site_created',
  'first_publish',
  'first_payment',
  'invite_sent',
  'invite_accepted',
  'churned',
]);

export const funnelEventSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema.nullable().optional(),
  user_id: uuidSchema.nullable().optional(),
  site_id: uuidSchema.nullable().optional(),
  event_type: funnelEventTypeSchema,
  properties: z.record(z.unknown()).nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().max(500).nullable().optional(),
  referrer: z.string().url().nullable().optional(),
  utm_source: z.string().max(100).nullable().optional(),
  utm_medium: z.string().max(100).nullable().optional(),
  utm_campaign: z.string().max(100).nullable().optional(),
  created_at: z.string().datetime(),
});

export const createFunnelEventInputSchema = z.object({
  event_type: funnelEventTypeSchema,
  org_id: uuidSchema.optional(),
  user_id: uuidSchema.optional(),
  site_id: uuidSchema.optional(),
  properties: z.record(z.unknown()).optional(),
});

// ============================================================================
// METRICS (North Star + Supporting)
// ============================================================================

export const metricsSnapshotSchema = z.object({
  timestamp: z.string().datetime(),

  // North star metric
  active_paid_sites_7d: z.number().int().nonnegative(),

  // Activation metrics
  t_first_publish_minutes_p50: z.number().nonnegative(),
  t_first_publish_minutes_p95: z.number().nonnegative(),
  sites_published_under_5_minutes_pct: z.number().min(0).max(100),

  // Retention metrics
  paid_churn_30d: z.number().min(0).max(100),

  // Revenue metrics
  mrr_cents: z.number().int().nonnegative(),
  arpa_cents: z.number().int().nonnegative(),
  net_revenue_retention_pct: z.number().min(0),

  // Volume metrics
  total_sites: z.number().int().nonnegative(),
  total_paid_sites: z.number().int().nonnegative(),
  total_orgs: z.number().int().nonnegative(),
  total_users: z.number().int().nonnegative(),
});

// ============================================================================
// COHORT ANALYSIS
// ============================================================================

export const cohortSchema = z.object({
  cohort_month: z.string().regex(/^\d{4}-\d{2}$/),
  initial_count: z.number().int().nonnegative(),
  retention_by_month: z.array(z.number().min(0).max(100)),
});

// ============================================================================
// DASHBOARD QUERIES
// ============================================================================

export const analyticsQuerySchema = z.object({
  org_id: uuidSchema.optional(),
  site_id: uuidSchema.optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
});

export const analyticsResponseSchema = z.object({
  data: z.array(analyticsDailySchema),
  summary: z.object({
    total_page_views: z.number().int().nonnegative(),
    total_unique_visitors: z.number().int().nonnegative(),
    total_bandwidth_bytes: z.number().int().nonnegative(),
    avg_response_time_ms: z.number().nonnegative().nullable().optional(),
  }),
});

// ============================================================================
// REAL-TIME STATS (from Cloudflare Analytics Engine)
// ============================================================================

export const realtimeStatsSchema = z.object({
  site_id: uuidSchema,
  timestamp: z.string().datetime(),
  visitors_last_5_min: z.number().int().nonnegative(),
  requests_per_minute: z.number().nonnegative(),
  error_rate: z.number().min(0).max(100),
  cache_hit_rate: z.number().min(0).max(100),
  bandwidth_per_minute_bytes: z.number().int().nonnegative(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AnalyticsDaily = z.infer<typeof analyticsDailySchema>;
export type FunnelEventType = z.infer<typeof funnelEventTypeSchema>;
export type FunnelEvent = z.infer<typeof funnelEventSchema>;
export type CreateFunnelEventInput = z.infer<typeof createFunnelEventInputSchema>;
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;
export type Cohort = z.infer<typeof cohortSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;
export type RealtimeStats = z.infer<typeof realtimeStatsSchema>;
