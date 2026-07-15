/**
 * @module libs/features/ai_content_strategist/schemas
 *
 * Zod schemas for AI Content Strategist (#3, ROI 2.70).
 * Analyzes site content gaps and generates 90-day content calendars.
 */
import { z } from 'zod';

export const ContentGapSchema = z.object({
  topic: z.string(),
  competitorCount: z.number().int().min(0).max(5),
  searchVolume: z.enum(['high', 'medium', 'low', 'unknown']),
  difficulty: z.enum(['easy', 'moderate', 'hard']),
  suggestedTitle: z.string(),
  suggestedKeywords: z.array(z.string()),
  outline: z.array(z.string()),
});

export type ContentGap = z.infer<typeof ContentGapSchema>;

export const CalendarEntrySchema = z.object({
  week: z.number().int().min(1).max(13),
  date: z.string(),
  topic: z.string(),
  title: z.string(),
  contentType: z.enum(['blog_post', 'service_page', 'faq', 'case_study', 'landing_page', 'news']),
  targetKeywords: z.array(z.string()),
  outline: z.array(z.string()),
  priority: z.enum(['high', 'medium', 'low']),
});

export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;

export const ContentStrategySchema = z.object({
  siteId: z.string(),
  generatedAt: z.string(),
  totalGaps: z.number().int().nonnegative(),
  gaps: z.array(ContentGapSchema),
  calendar: z.array(CalendarEntrySchema),
  calendarWeeks: z.number().int(),
  summary: z.string(),
});

export type ContentStrategy = z.infer<typeof ContentStrategySchema>;
