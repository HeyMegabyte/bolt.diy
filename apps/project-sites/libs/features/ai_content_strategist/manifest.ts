/**
 * AI Content Strategist — feature module manifest.
 *
 * @remarks
 * Analyzes site content against competitor topics to detect gaps across
 * industry-specific content pillars, then generates a 90-day content
 * calendar with SEO-briefed outlines. Pure gap detection + calendar
 * engine — the LLM generates outline content at the route layer.
 */
export const manifest = {
  slug: 'ai_content_strategist',
  name: 'AI Content Strategist',
  description:
    'Content gap analysis against competitors + 90-day content calendar with SEO-briefed outlines. Covers 14 industries with tailored content pillars.',
  flagKey: 'ai_content_strategist',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
