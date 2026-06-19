/**
 * @module services/production_readiness
 *
 * Production-Readiness Score (backlog #9) — turns a build's {@link ValidationReport}
 * into a single letter grade + 0-100 score for the admin "is this site safe to
 * ship?" widget. Pure + deterministic: it scores the violations the existing
 * `build_validators` already produce (security, SEO, assets, a11y-adjacent),
 * weighting security/correctness errors hardest. The #1 vibe-coded-app gap is
 * exactly this surface — a visible readiness grade before a site goes live.
 */

import type { ValidationReport, Violation } from './build_validators.js';

/** A→F letter grade. */
export type ReadinessGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Per-category rollup for the dashboard breakdown. */
export interface ReadinessCategory {
  category: string;
  errors: number;
  warnings: number;
}

export interface ReadinessScore {
  /** 0-100, higher is safer. */
  score: number;
  grade: ReadinessGrade;
  /** True only at grade A/B with zero security errors — safe to publish. */
  passing: boolean;
  /** One-line human summary. */
  summary: string;
  /** Violations grouped by code prefix (e.g. "security", "meta", "asset"). */
  breakdown: ReadinessCategory[];
}

/** Security errors are the most dangerous → heaviest penalty. */
const SECURITY_ERROR_PENALTY = 25;
const ERROR_PENALTY = 10;
const WARNING_PENALTY = 2;

/** Code prefix before the first dot (e.g. `security.client_secret_exposed` → `security`). */
function categoryOf(v: Violation): string {
  const dot = v.code.indexOf('.');
  return dot === -1 ? v.code : v.code.slice(0, dot);
}

function gradeFor(score: number): ReadinessGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Score a validation report for production readiness.
 *
 * @param report - The {@link ValidationReport} from `validateBuild`/`validateBuildAst`.
 * @returns A {@link ReadinessScore} with grade, passing flag, and per-category breakdown.
 * @example
 * scoreReadiness(validateBuild(files)); // → { score: 85, grade: 'B', passing: true, … }
 */
export function scoreReadiness(report: ValidationReport): ReadinessScore {
  const errors = report.errors ?? [];
  const warnings = report.warnings ?? [];

  let securityErrors = 0;
  let penalty = 0;
  for (const e of errors) {
    if (categoryOf(e) === 'security') {
      securityErrors += 1;
      penalty += SECURITY_ERROR_PENALTY;
    } else {
      penalty += ERROR_PENALTY;
    }
  }
  penalty += warnings.length * WARNING_PENALTY;

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade = gradeFor(score);

  // Build the per-category breakdown.
  const byCat = new Map<string, ReadinessCategory>();
  const bump = (v: Violation, kind: 'errors' | 'warnings') => {
    const c = categoryOf(v);
    const row = byCat.get(c) ?? { category: c, errors: 0, warnings: 0 };
    row[kind] += 1;
    byCat.set(c, row);
  };
  for (const e of errors) bump(e, 'errors');
  for (const w of warnings) bump(w, 'warnings');
  const breakdown = Array.from(byCat.values()).sort(
    (a, b) => b.errors - a.errors || b.warnings - a.warnings || a.category.localeCompare(b.category),
  );

  // Publishable only at A/B with NO secret/security errors — never ship a site
  // that leaks credentials regardless of how good the rest of the grade is.
  const passing = securityErrors === 0 && (grade === 'A' || grade === 'B');

  const summary = securityErrors > 0
    ? `Not ready (${grade}): ${securityErrors} security issue${securityErrors === 1 ? '' : 's'} must be fixed before publishing.`
    : passing
      ? `Ready to publish (${grade}, ${score}/100).`
      : `Grade ${grade} (${score}/100): ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} to address.`;

  return { score, grade, passing, summary, breakdown };
}
