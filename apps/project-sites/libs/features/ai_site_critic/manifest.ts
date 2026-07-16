/**
 * AI Website Critic — feature module manifest.
 *
 * @remarks
 * Upload a screenshot or URL → AI returns a structured critique: layout,
 * typography, color, imagery, trust signals, copy, SEO, mobile experience.
 * Compares against industry benchmarks, generates A-F grade + prioritized
 * fix list with auto-fix suggestions. Extends the site_doctor grading
 * infrastructure with AI vision scoring from vision_qa.ts.
 */
export const manifest = {
  slug: 'ai_site_critic',
  name: 'AI Website Critic',
  description:
    'AI-powered site critique with per-dimension scoring, A-F grading, industry benchmarking, and prioritized auto-fix suggestions. Uses CF Browser Rendering + Workers AI vision.',
  flagKey: 'ai_site_critic',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
