/**
 * @module libs/features/site_doctor/service
 * @description Pure scoring + lock logic for the Site Doctor owner health report.
 *
 * `buildSiteDoctorReport` is a PURE function (no env, no I/O): it takes the
 * platform's readiness signals + the caller plan and produces an owner-facing
 * A–F report with prioritized fixes. The free plan sees the top issue; the rest
 * are `locked` (the analytics_pro / paid power-up). Paid plans see everything.
 *
 * Voice: sharp & professional — concise, confident, results-focused.
 *
 * @packageDocumentation
 */

import {
  SiteDoctorReportSchema,
  type PlanTier,
  type Grade,
  type Severity,
  type Signal,
  type SiteDoctorIssue,
  type SiteDoctorReport,
} from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'site_doctor';

/** Sort rank for severities (higher = shown first). */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/** Owner-facing copy per readiness signal name. Sharp, results-focused fixes. */
interface IssueTemplate {
  severity: Severity;
  title: string;
  fix: string;
}

const ISSUE_COPY: Record<string, IssueTemplate> = {
  published: {
    severity: 'critical',
    title: 'Site is not published',
    fix: 'Publish the site so visitors and search engines can reach it.',
  },
  custom_domain: {
    severity: 'high',
    title: 'No custom domain connected',
    fix: 'Connect a custom domain to lift first-visit trust and SEO.',
  },
  performance: {
    severity: 'high',
    title: 'Performance below target',
    fix: 'Cut image weight and unused scripts to clear Lighthouse 90.',
  },
  sitemap: {
    severity: 'medium',
    title: 'Sitemap missing',
    fix: 'Generate sitemap.xml so search engines index every page.',
  },
};

/** Fallback copy for an unrecognized signal name (forward-compatible). */
function templateFor(name: string): IssueTemplate {
  return (
    ISSUE_COPY[name] ?? {
      severity: 'low' as Severity,
      title: `Check failed: ${name}`,
      fix: 'Review this item to improve your site.',
    }
  );
}

/** Map a 0-100 score to the letter grade an owner sees. A≥90 B≥80 C≥70 D≥60 F<60. */
export function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Compute a 0-100 score from signals: passed weight / total weight.
 * Returns 100 when there are no weighted signals (nothing to fail).
 */
function scoreFromSignals(signals: readonly Signal[]): number {
  const total = signals.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 100;
  const passed = signals.filter((s) => s.pass).reduce((sum, s) => sum + s.weight, 0);
  return Math.round((passed / total) * 100);
}

/** Build the sharp, one-line summary for a grade + open-issue count. */
function buildSummary(grade: Grade, openIssues: number): string {
  if (openIssues === 0) return 'Your site passes every check. Grade A — nothing to fix.';
  const noun = openIssues === 1 ? 'fix' : 'fixes';
  return `Grade ${grade}. ${openIssues} ${noun} stand between your site and an A.`;
}

/**
 * Build the owner-facing Site Doctor report.
 *
 * Pure: no env, no I/O. The result is Zod-validated against
 * {@link SiteDoctorReportSchema} so callers can trust the shape.
 *
 * Free-plan lock: failing signals become issues sorted by severity; on the free
 * plan only the top issue is unlocked, the rest carry `locked: true` (the upsell
 * hook). Paid plans (`starter`/`pro`) unlock every issue.
 *
 * @param signals - Readiness signals `{ name, pass, weight }` (e.g. from computeReadiness).
 * @param plan    - The caller's plan tier.
 * @returns A validated {@link SiteDoctorReport}.
 *
 * @example
 * ```ts
 * const report = buildSiteDoctorReport(readiness.checks, 'free');
 * // { grade: 'C', score: 75, issues: [{locked:false}, {locked:true}, ...], locked_count: 2 }
 * ```
 */
export function buildSiteDoctorReport(
  signals: readonly Signal[],
  plan: PlanTier,
): SiteDoctorReport {
  const score = scoreFromSignals(signals);
  const grade = scoreToGrade(score);

  const failing = signals.filter((s) => !s.pass);
  const sorted = [...failing].sort((a, b) => {
    const ta = templateFor(a.name);
    const tb = templateFor(b.name);
    const sevDelta = SEVERITY_RANK[tb.severity] - SEVERITY_RANK[ta.severity];
    if (sevDelta !== 0) return sevDelta;
    return b.weight - a.weight; // heavier (more impactful) first within a severity
  });

  const isPaid = plan !== 'free';
  const issues: SiteDoctorIssue[] = sorted.map((s, index) => {
    const tpl = templateFor(s.name);
    // Free plan: only the top issue (index 0) is unlocked.
    const locked = !isPaid && index > 0;
    return {
      id: s.name,
      severity: tpl.severity,
      title: tpl.title,
      fix: tpl.fix,
      locked,
    };
  });

  const lockedCount = issues.filter((i) => i.locked).length;

  return SiteDoctorReportSchema.parse({
    grade,
    score,
    summary: buildSummary(grade, issues.length),
    issues,
    locked_count: lockedCount,
  });
}
