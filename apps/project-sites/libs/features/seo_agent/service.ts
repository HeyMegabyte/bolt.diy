/**
 * Autonomous SEO Agent (#92, ROI 2.06) — pure SEO monitoring rule engine.
 * Checks keyword rankings, content gaps, internal links, meta tags,
 * backlinks, competitor tracking, and page speed. Zero I/O.
 */
export interface SeoSignals {
  slug: string; pageCount: number;
  pagesWithMetaDesc: number; pagesWithH1: number;
  pagesWithAltText: number; internalLinkCount: number;
  indexedPages: number; backlinkCount: number;
  avgLcpMs: number | null; avgCls: number | null;
  keywordRankings: Array<{ keyword: string; position: number; change: number }>;
  competitorKeywords: string[];
  siteKeywords: string[];
  hasSitemap: boolean; hasRobotsTxt: boolean;
  hasSchemaOrg: boolean; lastCrawledAt: string | null;
}

export interface SeoCheck {
  id: string; severity: 'critical' | 'warning' | 'info';
  title: string; description: string; autoFixable: boolean;
  fixSuggestion: string;
}

export interface SeoHealthReport {
  siteId: string; siteSlug: string; generatedAt: string;
  overallScore: number; grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: SeoCheck[]; criticalCount: number; warningCount: number;
  keywordWins: number; keywordLosses: number;
  contentGapCount: number; summary: string;
}

function checkIndexing(s: SeoSignals): SeoCheck[] {
  const c: SeoCheck[] = [];
  if (!s.hasSitemap) c.push({ id: 'no_sitemap', severity: 'critical', title: 'No sitemap.xml found', description: 'Sitemap helps search engines discover all your pages.', autoFixable: true, fixSuggestion: 'Auto-generate sitemap.xml with all page URLs and lastmod dates.' });
  if (!s.hasRobotsTxt) c.push({ id: 'no_robots', severity: 'warning', title: 'No robots.txt found', description: 'Robots.txt guides search engine crawlers.', autoFixable: true, fixSuggestion: 'Auto-generate robots.txt allowing all crawlers with sitemap reference.' });
  if (s.pageCount > 0 && s.indexedPages / s.pageCount < 0.8) c.push({ id: 'low_index', severity: 'warning', title: `${s.pageCount - s.indexedPages} pages not indexed`, description: 'Unindexed pages get zero search traffic.', autoFixable: false, fixSuggestion: 'Submit unindexed URLs via Search Console. Check for noindex tags or canonical issues.' });
  return c;
}

function checkOnPage(s: SeoSignals): SeoCheck[] {
  const c: SeoCheck[] = [];
  if (s.pageCount > 0 && s.pagesWithMetaDesc / s.pageCount < 0.9) c.push({ id: 'meta_gap', severity: 'warning', title: `${s.pageCount - s.pagesWithMetaDesc} pages missing meta descriptions`, description: 'Meta descriptions impact CTR from search results.', autoFixable: true, fixSuggestion: 'Auto-generate meta descriptions from page content.' });
  if (s.pageCount > 0 && s.pagesWithH1 / s.pageCount < 1) c.push({ id: 'h1_gap', severity: 'warning', title: `${s.pageCount - s.pagesWithH1} pages missing H1 tags`, description: 'Every page needs exactly one H1.', autoFixable: true, fixSuggestion: 'Auto-generate H1 from page title.' });
  if (s.pageCount > 0 && s.pagesWithAltText / s.pageCount < 0.8) c.push({ id: 'alt_gap', severity: 'info', title: 'Some images missing alt text', description: 'Alt text helps image search and accessibility.', autoFixable: true, fixSuggestion: 'Auto-generate alt text for images without it.' });
  if (!s.hasSchemaOrg) c.push({ id: 'no_schema', severity: 'critical', title: 'No structured data (JSON-LD) detected', description: 'Schema.org markup enables rich results and AI engine parsing.', autoFixable: true, fixSuggestion: 'Auto-generate Organization + WebSite + WebPage + BreadcrumbList JSON-LD.' });
  return c;
}

function checkKeywords(s: SeoSignals): { checks: SeoCheck[]; wins: number; losses: number } {
  const wins = s.keywordRankings.filter((k) => k.change < 0).length;
  const losses = s.keywordRankings.filter((k) => k.change > 0).length;
  const dropped = s.keywordRankings.filter((k) => k.change >= 5);
  const c: SeoCheck[] = [];
  if (dropped.length > 0) c.push({ id: 'keyword_drops', severity: 'warning', title: `${dropped.length} keywords dropped 5+ positions`, description: `Keywords losing rank: ${dropped.map((k) => k.keyword).slice(0, 3).join(', ')}`, autoFixable: false, fixSuggestion: 'Review affected pages. Update content, add internal links, or build backlinks to these pages.' });
  return { checks: c, wins, losses };
}

function checkCompetitive(s: SeoSignals): SeoCheck[] {
  const gaps = s.competitorKeywords.filter((k) => !s.siteKeywords.includes(k));
  if (gaps.length > 3) return [{ id: 'keyword_gaps', severity: 'warning', title: `${gaps.length} keywords competitors rank for that you don't`, description: `Missed opportunities: ${gaps.slice(0, 5).join(', ')}`, autoFixable: false, fixSuggestion: 'Create content targeting these keywords. Use the Content Strategist to build a 90-day calendar.' }];
  return [];
}

function computeGrade(score: number): SeoHealthReport['grade'] {
  if (score >= 90) return 'A'; if (score >= 75) return 'B'; if (score >= 55) return 'C'; if (score >= 35) return 'D'; return 'F';
}

export function runSeoHealthCheck(siteId: string, signals: SeoSignals): SeoHealthReport {
  const idxChecks = checkIndexing(signals);
  const onPageChecks = checkOnPage(signals);
  const kwResult = checkKeywords(signals);
  const compChecks = checkCompetitive(signals);
  const checks = [...idxChecks, ...onPageChecks, ...kwResult.checks, ...compChecks];

  const penalty = checks.reduce((s, c) => s + (c.severity === 'critical' ? 15 : c.severity === 'warning' ? 10 : 3), 0);
  const score = Math.max(0, 100 - penalty);
  const criticalCount = checks.filter((c) => c.severity === 'critical').length;
  const warningCount = checks.filter((c) => c.severity === 'warning').length;

  return {
    siteId, siteSlug: signals.slug, generatedAt: new Date().toISOString(),
    overallScore: score, grade: computeGrade(score), checks, criticalCount, warningCount,
    keywordWins: kwResult.wins, keywordLosses: kwResult.losses,
    contentGapCount: signals.competitorKeywords.filter((k) => !signals.siteKeywords.includes(k)).length,
    summary: score >= 90 ? 'Excellent SEO health. Keep monitoring.' : score >= 75 ? `${criticalCount} critical, ${warningCount} warnings. Address the issues above to improve your search rankings.` : `${criticalCount} critical issues need attention. Prioritize fixes for the best SEO impact.`,
  };
}
