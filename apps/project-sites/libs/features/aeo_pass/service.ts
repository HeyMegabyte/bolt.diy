/**
 * @module libs/features/aeo_pass/service
 * @description AEO Pass service — runs Answer Engine Optimization audits
 * against a published site and persists results to D1.
 *
 * @remarks Boundaries are Zod-validated by the handler; this layer assumes
 * validated input. The audit reads the site's published `index.html` from R2
 * and scores it with `auditAeoHtml` — a pure, deterministic analyzer of the
 * signals answer engines (ChatGPT, Perplexity, Google AI Overviews) rely on
 * to extract and cite a page.
 */

import type { Env } from '../../../src/types/env.js';
import { dbInsert, dbQueryOne } from '../../../src/services/db.js';
import type { AeoAudit } from './schemas.js';

/** Registry flag key gating this feature. */
export const FLAG_KEY = 'aeo_pass';

/** Result of analyzing one HTML document for AEO readiness. */
export interface AeoAuditResult {
  /** 0-100 readiness score, weighted sum of the checks below. */
  score: number;
  /** Human-readable, actionable gaps — one per failed check. */
  issues: string[];
}

/** One weighted AEO check: a predicate over the HTML plus the gap it reports when it fails. */
interface AeoCheck {
  /** Points awarded when `pass` is true. */
  weight: number;
  /** True when the page satisfies this signal. */
  pass: (html: string) => boolean;
  /** Actionable message surfaced when the check fails. */
  issue: string;
}

/** Strip HTML tags and collapse whitespace to measure visible text length. */
function visibleText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Count occurrences of a global regex without mutating shared state. */
function count(html: string, re: RegExp): number {
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

/**
 * True when a short, direct-answer paragraph (40-320 visible chars) follows a
 * heading — the "quotable answer block" answer engines lift verbatim.
 */
function hasQuotableAnswerBlock(html: string): boolean {
  const re = /<\/h[1-3]>[\s\S]{0,300}?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const len = visibleText(m[1] ?? '').length;
    if (len >= 40 && len <= 320) return true;
  }
  return false;
}

/**
 * The AEO rubric — eight weighted signals summing to 100. Order is the order
 * issues are reported in, most-impactful first.
 */
const CHECKS: readonly AeoCheck[] = [
  {
    weight: 20,
    pass: (h) => /@type"?\s*:\s*"?(FAQPage|Question)/i.test(h),
    issue:
      'Missing FAQ schema — add a FAQPage JSON-LD block so answer engines can extract your questions and answers directly.',
  },
  {
    weight: 15,
    pass: (h) => /<script[^>]*type=["']application\/ld\+json["']/i.test(h),
    issue:
      'Insufficient structured data — no JSON-LD found. Add Organization, WebPage, and BreadcrumbList blocks so AI search can understand the page.',
  },
  {
    weight: 15,
    pass: hasQuotableAnswerBlock,
    issue:
      'No quotable answer blocks — add a concise (1-3 sentence) direct-answer paragraph right under each main heading for answer engines to cite.',
  },
  {
    weight: 15,
    pass: (h) => {
      const m = h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
      return !!m && visibleText(m[1] ?? '').length >= 1;
    },
    issue:
      'Missing meta description — add a 120-156 character summary so AI search engines have a clean snippet to quote.',
  },
  {
    weight: 10,
    pass: (h) => count(h, /<h1[\s>]/gi) === 1,
    issue:
      'Page should have exactly one H1 — answer engines use the single H1 to identify the page topic.',
  },
  {
    weight: 10,
    pass: (h) => {
      const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return !!m && visibleText(m[1] ?? '').length >= 1;
    },
    issue: 'Missing or empty <title> tag — answer engines weight the title heavily when ranking sources.',
  },
  {
    weight: 10,
    pass: (h) => count(h, /<h[23][\s>]/gi) >= 2,
    issue:
      'Thin heading structure — add at least two H2/H3 sections so answers map to clearly-titled topics.',
  },
  {
    weight: 5,
    pass: (h) => /<(main|article)[\s>]/i.test(h),
    issue: 'No <main> or <article> landmark — add semantic regions so answer engines can locate the primary content.',
  },
];

/**
 * Analyze one HTML document for Answer Engine Optimization readiness.
 *
 * @remarks Pure + deterministic — same input always yields the same score and
 * issue list. No I/O, no DB. This is the testable core of the audit.
 *
 * @param html - The page HTML (e.g. a site's published `index.html`).
 * @returns A 0-100 score and the list of actionable gaps for the failed checks.
 * @example
 * auditAeoHtml('<html><title>x</title>...')
 * // → { score: 100, issues: [] } for a fully-optimized page
 */
export function auditAeoHtml(html: string): AeoAuditResult {
  const source = html ?? '';
  let score = 0;
  const issues: string[] = [];

  for (const check of CHECKS) {
    if (check.pass(source)) {
      score += check.weight;
    } else {
      issues.push(check.issue);
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

/**
 * Run an AEO audit for `siteId`: read the site's published HTML from R2, score
 * it with {@link auditAeoHtml}, and persist the result to D1.
 *
 * @remarks The D1 row is inserted via `dbInsert`, which auto-populates
 * `created_at` / `updated_at`, so those columns must NOT be passed in the row
 * object. When the site has no published version (or its HTML is missing), the
 * audit returns score 0 with an explanatory issue rather than throwing.
 *
 * @returns Typed `AeoAudit` with the freshly-created record.
 */
export async function runAeoAudit(env: Env, siteId: string): Promise<AeoAudit> {
  const id = crypto.randomUUID();

  const site = await dbQueryOne<{
    slug: string;
    current_build_version: string | null;
    org_id: string | null;
  }>(
    env.DB,
    'SELECT slug, current_build_version, org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );

  let result: AeoAuditResult;
  if (!site || !site.current_build_version) {
    result = {
      score: 0,
      issues: ['Site has no published HTML to audit yet — publish the site, then re-run the AEO audit.'],
    };
  } else {
    const object = await env.SITES_BUCKET.get(`sites/${site.slug}/${site.current_build_version}/index.html`);
    if (!object) {
      result = {
        score: 0,
        issues: ['Published HTML not found in storage — re-publish the site, then re-run the AEO audit.'],
      };
    } else {
      const html = await object.text();
      result = auditAeoHtml(html);
    }
  }

  const orgId = site?.org_id ?? null;

  await dbInsert(env.DB, 'aeo_audits', {
    id,
    site_id: siteId,
    org_id: orgId,
    score: result.score,
    issues: JSON.stringify(result.issues),
  });

  return {
    id,
    siteId,
    orgId,
    score: result.score,
    issues: result.issues,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Fetch the most recent AEO audit for `siteId`, or `null` when none exist.
 *
 * @returns `AeoAudit` shaped from the D1 row, or `null`.
 */
export async function getLatestAeoAudit(
  env: Env,
  siteId: string,
): Promise<AeoAudit | null> {
  const row = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string | null;
    score: number;
    issues: string;
    created_at: string;
  }>(
    env.DB,
    'SELECT id, site_id, org_id, score, issues, created_at FROM aeo_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1',
    [siteId],
  );

  if (!row) return null;

  return {
    id: row.id,
    siteId: row.site_id,
    orgId: row.org_id,
    score: row.score,
    issues: JSON.parse(row.issues) as string[],
    createdAt: row.created_at,
  };
}
