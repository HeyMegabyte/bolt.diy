/**
 * @module libs/features/ai_content_strategist/service
 *
 * Pure content strategy engine — analyzes site content against competitor
 * topics to identify gaps, then generates a 90-day content calendar with
 * SEO-briefed outlines. Zero I/O, deterministic.
 *
 * The LLM (Workers AI Llama 3.3) generates the actual outline content at
 * the route layer. This module is the gap-detection + calendar-structuring
 * engine that feeds the LLM with structured prompts.
 */
import type { CalendarEntry, ContentGap, ContentStrategy } from './schemas.js';

// ── Industry-specific content pillars ───────────────────────────────────────

const INDUSTRY_PILLARS: Record<string, string[]> = {
  restaurant: ['Menu highlights', 'Chef stories', 'Local ingredients', 'Events & catering', 'Customer favorites', 'Seasonal specials'],
  retail: ['Product guides', 'Style tips', 'New arrivals', 'Gift guides', 'Behind the brand', 'Customer stories'],
  healthcare: ['Treatment guides', 'Patient stories', 'Wellness tips', 'Insurance info', 'Meet the team', 'Prevention'],
  legal: ['Legal guides', 'Case studies', 'FAQs by practice area', 'Client rights', 'Cost explainers', 'Recent wins'],
  realestate: ['Market reports', 'Neighborhood guides', 'Buying/selling tips', 'Home maintenance', 'Mortgage guides', 'Success stories'],
  construction: ['Project spotlights', 'Material guides', 'Cost estimates', 'Permit guides', 'Before/after galleries', 'Safety tips'],
  salon: ['Style guides', 'Treatment explainers', 'Before/after galleries', 'Product guides', 'Trend reports', 'Client transformations'],
  fitness: ['Workout guides', 'Nutrition tips', 'Success stories', 'Class schedules', 'Equipment guides', 'Wellness blog'],
  education: ['Course guides', 'Student success', 'Learning tips', 'Curriculum overview', 'Career outcomes', 'Faculty spotlights'],
  nonprofit: ['Impact stories', 'Volunteer spotlights', 'Donor recognition', 'Program updates', 'Community needs', 'How to help'],
  automotive: ['Maintenance guides', 'Model comparisons', 'Buying guides', 'Repair tips', 'Safety features', 'Customer rides'],
  finance: ['Market insights', 'Planning guides', 'Product explainers', 'Tax tips', 'Retirement planning', 'Client success'],
  technology: ['Product deep-dives', 'Integration guides', 'Case studies', 'Industry trends', 'How-to guides', 'Release notes'],
  hospitality: ['Local attractions', 'Guest stories', 'Room guides', 'Event hosting', 'Seasonal packages', 'Travel tips'],
};

const DEFAULT_PILLARS = ['Service overview', 'How-to guides', 'Customer stories', 'Industry insights', 'FAQs', 'Company updates'];

// ── Gap detection ───────────────────────────────────────────────────────────

/**
 * Detects content gaps by comparing the site's existing topics against
 * competitor topics and industry content pillars.
 *
 * A gap exists when a competitor covers a topic the site doesn't, AND
 * that topic is in the site's industry content pillars.
 */
export function detectContentGaps(
  industry: string,
  siteTopics: string[],
  competitorTopics: string[],
): ContentGap[] {
  const pillars = INDUSTRY_PILLARS[industry.toLowerCase()] ?? DEFAULT_PILLARS;
  const siteLower = siteTopics.map((t) => t.toLowerCase());
  const competitorLower = competitorTopics.map((t) => t.toLowerCase());

  const gaps: ContentGap[] = [];

  for (const pillar of pillars) {
    // Check if the site has content covering this pillar
    const siteCovers = siteLower.some((t) =>
      pillar.toLowerCase().includes(t) || t.includes(pillar.toLowerCase()),
    );

    if (siteCovers) continue;

    // Count how many competitors cover this pillar
    const competitorCoverage = competitorLower.filter((t) =>
      pillar.toLowerCase().includes(t) || t.includes(pillar.toLowerCase()),
    ).length;

    if (competitorCoverage === 0) continue;

    gaps.push({
      topic: pillar,
      competitorCount: Math.min(competitorCoverage, 5),
      searchVolume: competitorCoverage >= 3 ? 'high' : competitorCoverage >= 2 ? 'medium' : 'low',
      difficulty: competitorCoverage >= 4 ? 'hard' : competitorCoverage >= 2 ? 'moderate' : 'easy',
      suggestedTitle: `${pillar} — A Complete Guide`,
      suggestedKeywords: [pillar.toLowerCase(), `${pillar.toLowerCase()} guide`, `${pillar.toLowerCase()} tips`],
      outline: [
        `Introduction to ${pillar}`,
        `Key things to know about ${pillar}`,
        `Common questions about ${pillar}`,
        `How we approach ${pillar}`,
        `Next steps for ${pillar}`,
      ],
    });
  }

  // Sort by competitor count descending (biggest gaps first)
  return gaps.sort((a, b) => b.competitorCount - a.competitorCount);
}

// ── Calendar generation ─────────────────────────────────────────────────────

/**
 * Generates a 90-day content calendar from detected gaps.
 *
 * Assigns each gap to a week, spreading high-priority gaps across the
 * first 4 weeks and lower-priority gaps across weeks 5-13. Each week
 * gets exactly one content entry.
 */
export function generateCalendar(
  siteName: string,
  gaps: ContentGap[],
  startDate: Date = new Date(),
): CalendarEntry[] {
  const calendar: CalendarEntry[] = [];
  let week = 1;

  // Sort gaps: high competitor count first
  const sorted = [...gaps].sort((a, b) => b.competitorCount - a.competitorCount);

  for (const gap of sorted) {
    if (week > 13) break;

    const entryDate = new Date(startDate);
    entryDate.setDate(entryDate.getDate() + (week - 1) * 7);

    const contentType: CalendarEntry['contentType'] =
      gap.competitorCount >= 3 ? 'blog_post' :
      gap.competitorCount >= 2 ? 'service_page' :
      'faq';

    calendar.push({
      week,
      date: entryDate.toISOString().split('T')[0],
      topic: gap.topic,
      title: `${gap.suggestedTitle} | ${siteName}`,
      contentType,
      targetKeywords: gap.suggestedKeywords,
      outline: gap.outline,
      priority: gap.competitorCount >= 3 ? 'high' : gap.competitorCount >= 2 ? 'medium' : 'low',
    });

    week++;
  }

  return calendar;
}

// ── Strategy summary ────────────────────────────────────────────────────────

function generateSummary(gaps: ContentGap[], calendar: CalendarEntry[], siteName: string): string {
  const highPriority = calendar.filter((c) => c.priority === 'high').length;
  const totalGaps = gaps.length;

  if (totalGaps === 0) {
    return `${siteName} has strong content coverage across all industry pillars. No critical gaps detected. Maintain publishing cadence.`;
  }

  const topGap = gaps[0];
  return `${siteName} has ${totalGaps} content gaps vs competitors. ${highPriority} high-priority items in the 90-day calendar. Top gap: "${topGap.topic}" — ${topGap.competitorCount} competitors cover this, you don't. Address this first for maximum SEO impact.`;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Builds a complete 90-day content strategy from site and competitor data.
 *
 * @param siteId - The site being analyzed.
 * @param siteName - Business name.
 * @param industry - Business industry (restaurant, retail, healthcare, etc).
 * @param siteTopics - Topics the site currently covers.
 * @param competitorTopics - Topics competitors cover.
 * @param startDate - Calendar start date (defaults to today).
 * @returns A complete ContentStrategy with gaps, calendar, and summary.
 */
export function buildContentStrategy(
  siteId: string,
  siteName: string,
  industry: string,
  siteTopics: string[],
  competitorTopics: string[],
  startDate: Date = new Date(),
): ContentStrategy {
  const gaps = detectContentGaps(industry, siteTopics, competitorTopics);
  const calendar = generateCalendar(siteName, gaps, startDate);
  const summary = generateSummary(gaps, calendar, siteName);

  return {
    siteId,
    generatedAt: new Date().toISOString(),
    totalGaps: gaps.length,
    gaps,
    calendar,
    calendarWeeks: 13,
    summary,
  };
}
