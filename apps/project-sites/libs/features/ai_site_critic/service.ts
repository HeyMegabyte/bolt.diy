/**
 * @module libs/features/ai_site_critic/service
 *
 * Pure critique engine — takes per-dimension scores + findings and produces a
 * structured SiteCritique with A-F grading, priority-fix ranking, and industry
 * benchmarking. Zero I/O, deterministic.
 *
 * The vision scoring happens at the route layer (CF Browser Rendering + Workers
 * AI Llama 4 Scout). This module is the grade-derivation + fix-prioritization
 * engine that consumes those scores.
 */
import type { CriticDimension, SiteCritique } from './schemas.js';

// ── Grade mapping ───────────────────────────────────────────────────────────

const GRADE_THRESHOLDS: Array<{ min: number; grade: SiteCritique['grade'] }> = [
  { min: 9.5, grade: 'A+' },
  { min: 8.0, grade: 'A' },
  { min: 6.5, grade: 'B' },
  { min: 5.0, grade: 'C' },
  { min: 3.5, grade: 'D' },
  { min: 0, grade: 'F' },
];

function computeGrade(overallScore: number): SiteCritique['grade'] {
  for (const t of GRADE_THRESHOLDS) {
    if (overallScore >= t.min) return t.grade;
  }
  return 'F';
}

// ── Dimension labels ────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  layout: 'Layout & Structure',
  typography: 'Typography & Readability',
  color: 'Color & Contrast',
  imagery: 'Imagery & Media',
  whitespace: 'Whitespace & Density',
  distinctiveness: 'Brand Distinctiveness',
  trust: 'Trust Signals',
  copy: 'Copy & Messaging',
  seo: 'SEO Health',
  mobile: 'Mobile Experience',
};

// ── Default industry benchmarks (will be replaced by real data from deepcrawl) ─

const INDUSTRY_BENCHMARKS: Record<string, number> = {
  restaurant: 5.8,
  retail: 6.1,
  healthcare: 6.4,
  legal: 6.0,
  realestate: 6.2,
  construction: 5.5,
  salon: 5.7,
  fitness: 6.0,
  education: 6.8,
  nonprofit: 6.3,
  automotive: 5.9,
  finance: 7.0,
  technology: 7.2,
  hospitality: 6.5,
  default: 6.0,
};

// ── buildCritique ───────────────────────────────────────────────────────────

/**
 * Builds a structured site critique from per-dimension scores.
 *
 * @param siteId - The site being critiqued.
 * @param url - The site's URL.
 * @param dimensions - Per-dimension scores and findings (from AI vision or static analysis).
 * @param opts - Optional industry + competitor context.
 * @returns A complete SiteCritique with grade, priority fixes, and benchmarking.
 */
export function buildCritique(
  siteId: string,
  url: string,
  dimensions: CriticDimension[],
  opts: { industry?: string; competitorUrls?: string[] } = {},
): SiteCritique {
  // Overall score = weighted average (layout/typography/color weighted higher)
  const weights: Record<string, number> = {
    layout: 2.0,
    typography: 1.5,
    color: 1.5,
    imagery: 1.0,
    whitespace: 1.0,
    distinctiveness: 1.0,
    trust: 1.5,
    copy: 1.5,
    seo: 1.0,
    mobile: 1.5,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const d of dimensions) {
    const w = weights[d.name] ?? 1.0;
    weightedSum += d.score * w;
    weightTotal += w;
  }
  const overallScore = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;

  // Grade
  const grade = computeGrade(overallScore);

  // Add dimension labels
  const labeledDimensions = dimensions.map((d) => ({
    ...d,
    label: DIMENSION_LABELS[d.name] ?? d.name,
  }));

  // Industry benchmark
  const industryAvg = opts.industry
    ? (INDUSTRY_BENCHMARKS[opts.industry.toLowerCase()] ?? INDUSTRY_BENCHMARKS.default)
    : undefined;

  const competitiveRank = industryAvg !== undefined
    ? overallScore > industryAvg + 1.5
      ? 'Top 10%'
      : overallScore > industryAvg
        ? 'Above average'
        : overallScore > industryAvg - 1.0
          ? 'Average'
          : 'Below average'
    : undefined;

  // Priority fixes — all findings with severity critical/major, sorted by severity
  const priorityFixes = dimensions
    .flatMap((d) =>
      d.findings
        .filter((f) => f.severity === 'critical' || f.severity === 'major')
        .map((f) => ({
          dimension: DIMENSION_LABELS[d.name] ?? d.name,
          title: f.title,
          fix: f.fixSuggestion ?? 'Manual review recommended.',
          autoFixable: f.autoFixable,
        })),
    )
    .sort((a, b) => (a.autoFixable === b.autoFixable ? 0 : a.autoFixable ? -1 : 1));

  return {
    siteId,
    url,
    gradedAt: new Date().toISOString(),
    overallScore,
    grade,
    dimensions: labeledDimensions,
    industryAvg,
    competitiveRank,
    priorityFixes,
  };
}
