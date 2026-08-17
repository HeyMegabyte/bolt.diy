/**
 * @module libs/features/prod_readiness_score/service
 * @description Business logic for the Production Readiness Score. Queries the D1
 * schema to determine per-site readiness across four weighted checks, then
 * aggregates them into a 0-100 score and a letter grade.
 *
 * @remarks All four checks are derived from data the platform already owns:
 * site status, hostname records, Lighthouse score, and a live R2 sitemap probe.
 * No external network calls are made except the R2 head request.
 *
 * @example
 * ```ts
 * const result = await computeReadiness(env, site);
 * // { score: 75, grade: 'C', checks: [...] }
 * ```
 */
import type { Env } from '../../../src/types/env.js';
import { dbQueryOne, dbQuery } from '../../../src/services/db.js';
import type { ReadinessCheck, ReadinessGrade, ReadinessResponse } from './schemas.js';

/** The D1 row shape we pull for the target site. */
export interface SiteRow {
  id: string;
  slug: string;
  status: string;
  lighthouse_score: number | null;
  current_build_version: string | null;
  org_id: string;
}

/** A resolved hostname row we check for custom domain status. */
interface HostnameRow {
  type: string;
  status: string;
}

/**
 * Fetches the site row for the given siteId + orgId pair.
 * Returns null when the site does not exist, is soft-deleted, or belongs to a
 * different org (ownership check).
 */
export async function fetchOwnedSite(
  env: Env,
  siteId: string,
  orgId: string,
): Promise<SiteRow | null> {
  return dbQueryOne<SiteRow>(
    env.DB,
    `SELECT id, slug, status, lighthouse_score, current_build_version, org_id
       FROM sites
      WHERE id = ?
        AND org_id = ?
        AND deleted_at IS NULL`,
    [siteId, orgId],
  );
}

/**
 * Maps a numeric score (0-100) to the letter grade the owner sees.
 *
 * @remarks Grade boundaries: A≥90, B≥80, C≥70, D≥60, F<60.
 */
export function scoreToGrade(score: number): ReadinessGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Runs all four weighted readiness checks against the site and returns the
 * structured result ready for the API response.
 *
 * The four checks and their weights (sum = 100):
 * - `published`    25 pts — site.status === 'published'
 * - `custom_domain` 25 pts — an active custom_cname hostname row exists
 * - `performance`  25 pts — lighthouse_score ≥ 90
 * - `sitemap`      25 pts — sitemap.xml exists in R2 under current build version
 *
 * @throws Never — R2 head errors are caught internally and treated as a fail.
 */
export async function computeReadiness(env: Env, site: SiteRow): Promise<ReadinessResponse> {
  // ── Check 1: published ──────────────────────────────────────────────────
  // Requires a real build: a `published` row with NULL current_build_version
  // serves a 503 (no R2 manifest) — it is not genuinely live, so it must not
  // earn the "published" points ("lying-published" class).
  const isPublished = site.status === 'published' && !!site.current_build_version;

  // ── Check 2: custom domain ──────────────────────────────────────────────
  const hostnamesResult = await dbQuery<HostnameRow>(
    env.DB,
    `SELECT type, status FROM hostnames
      WHERE site_id = ?
        AND type = 'custom_cname'
        AND status = 'active'
      LIMIT 1`,
    [site.id],
  );
  const hasCustomDomain = hostnamesResult.data.length > 0;

  // ── Check 3: performance ────────────────────────────────────────────────
  const hasGoodPerf = site.lighthouse_score !== null && site.lighthouse_score >= 90;

  // ── Check 4: sitemap present in R2 ─────────────────────────────────────
  let hasSitemap = false;
  if (site.current_build_version && env.SITES_BUCKET) {
    try {
      const key = `sites/${site.slug}/${site.current_build_version}/sitemap.xml`;
      const obj = await env.SITES_BUCKET.head(key);
      hasSitemap = obj !== null;
    } catch {
      hasSitemap = false;
    }
  }

  // ── Aggregate ───────────────────────────────────────────────────────────
  const checks: ReadinessCheck[] = [
    {
      name: 'published',
      pass: isPublished,
      weight: 25,
      hint: isPublished ? 'Site is live.' : 'Publish this site so visitors can reach it.',
    },
    {
      name: 'custom_domain',
      pass: hasCustomDomain,
      weight: 25,
      hint: hasCustomDomain
        ? 'Custom domain is active.'
        : 'Connect a custom domain to build credibility and improve SEO.',
    },
    {
      name: 'performance',
      pass: hasGoodPerf,
      weight: 25,
      hint: hasGoodPerf
        ? `Lighthouse score is ${site.lighthouse_score ?? 0}.`
        : `Lighthouse score is ${site.lighthouse_score ?? 'unknown'}. Aim for ≥90 to pass.`,
    },
    {
      name: 'sitemap',
      pass: hasSitemap,
      weight: 25,
      hint: hasSitemap
        ? 'sitemap.xml is present in the latest build.'
        : 'No sitemap.xml found in the current build — search engines may miss pages.',
    },
  ];

  const score = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);

  return { score, grade: scoreToGrade(score), checks };
}
