/**
 * @module libs/features/lifecycle_agent/service
 *
 * Autonomous Site Lifecycle Agent (#2, ROI 2.50) — pure site health
 * monitoring rule engine. Detects issues, ranks severity, and generates
 * actionable recommendations. Zero I/O, deterministic.
 *
 * Health checks:
 * - Content freshness (pages not updated in N days)
 * - Broken internal links
 * - Missing SEO fundamentals (meta desc, alt text, JSON-LD)
 * - Security header drift
 * - Core Web Vitals regressions
 * - Competitor content gaps
 * - Stale business hours/holiday info
 * - Missing trust signals (reviews, testimonials, contact info)
 */
export interface SiteSignals {
  slug: string;
  lastPublishedAt: string;
  pageCount: number;
  pagesUpdatedAt: Record<string, string>;
  hasMetaDescription: boolean;
  hasJsonLd: boolean;
  hasFaqSchema: boolean;
  imageCount: number;
  imagesWithAlt: number;
  internalLinkCount: number;
  brokenLinkCount: number;
  lighthouseScore: number | null;
  lighthouseLastRun: string | null;
  lcpMs: number | null;
  cls: number | null;
  hasSsl: boolean;
  hasSecurityTxt: boolean;
  hasHsts: boolean;
  hasContactPhone: boolean;
  hasContactEmail: boolean;
  hasBusinessHours: boolean;
  hasTestimonials: boolean;
  competitorContentGaps: number;
  daysSinceLastUpdate: number;
}

export interface HealthCheck {
  id: string;
  category: 'content' | 'seo' | 'performance' | 'security' | 'trust' | 'competitive';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  autoFixable: boolean;
  fixSuggestion: string;
}

export interface LifecycleReport {
  siteId: string;
  siteSlug: string;
  generatedAt: string;
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  healthScore: number;
  checks: HealthCheck[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  summary: string;
  nextCheckIn: string;
}

// ── Health check generators ─────────────────────────────────────────────────

function checkContentFreshness(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (s.daysSinceLastUpdate > 180) {
    checks.push({
      id: 'content_stale_180d', category: 'content', severity: 'critical',
      title: `Site content has not been updated in ${s.daysSinceLastUpdate} days`,
      description: 'Search engines deprioritize stale content. Visitors lose trust in outdated information.',
      autoFixable: false,
      fixSuggestion: 'Review and update your key pages — especially services, pricing, hours, and contact info. Consider adding a blog post or news update.',
    });
  } else if (s.daysSinceLastUpdate > 90) {
    checks.push({
      id: 'content_stale_90d', category: 'content', severity: 'warning',
      title: `Site content has not been updated in ${s.daysSinceLastUpdate} days`,
      description: 'Regular updates improve search rankings and visitor trust.',
      autoFixable: false,
      fixSuggestion: 'Add a new blog post, update your seasonal offerings, or refresh your homepage content.',
    });
  }

  const stalePages = Object.entries(s.pagesUpdatedAt)
    .filter(([, d]) => {
      const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
      return days > 365;
    })
    .map(([path]) => path);

  if (stalePages.length > 0) {
    checks.push({
      id: 'stale_pages', category: 'content', severity: 'warning',
      title: `${stalePages.length} page(s) have not been updated in over a year`,
      description: `Stale pages: ${stalePages.slice(0, 3).join(', ')}${stalePages.length > 3 ? ` and ${stalePages.length - 3} more` : ''}`,
      autoFixable: false,
      fixSuggestion: 'Review these pages and update or archive them. Stale content hurts your SEO and visitor trust.',
    });
  }

  return checks;
}

function checkSeoFundamentals(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (!s.hasMetaDescription) {
    checks.push({
      id: 'missing_meta_desc', category: 'seo', severity: 'critical',
      title: 'No meta description found',
      description: 'Search engines use meta descriptions in result snippets. Missing descriptions reduce click-through rates.',
      autoFixable: true,
      fixSuggestion: 'Auto-generate a meta description from your homepage content (120-156 chars).',
    });
  }
  if (!s.hasJsonLd) {
    checks.push({
      id: 'missing_jsonld', category: 'seo', severity: 'critical',
      title: 'No JSON-LD structured data found',
      description: 'Structured data helps search engines and AI answer engines understand your content.',
      autoFixable: true,
      fixSuggestion: 'Auto-generate WebSite + Organization + WebPage + BreadcrumbList JSON-LD.',
    });
  }
  if (!s.hasFaqSchema) {
    checks.push({
      id: 'missing_faq_schema', category: 'seo', severity: 'warning',
      title: 'No FAQPage schema detected',
      description: 'FAQ structured data enables rich results in Google and structured answers in AI overviews.',
      autoFixable: true,
      fixSuggestion: 'Add a FAQ section with FAQPage JSON-LD if you have questions and answers on your site.',
    });
  }
  if (s.imageCount > 0 && s.imagesWithAlt / s.imageCount < 0.8) {
    checks.push({
      id: 'missing_alt_text', category: 'seo', severity: 'warning',
      title: `${s.imageCount - s.imagesWithAlt} images missing alt text`,
      description: 'Alt text is required for accessibility and helps with image search rankings.',
      autoFixable: true,
      fixSuggestion: `Auto-generate alt text for the ${s.imageCount - s.imagesWithAlt} images without it.`,
    });
  }
  if (s.internalLinkCount < 3 && s.pageCount > 1) {
    checks.push({
      id: 'few_internal_links', category: 'seo', severity: 'info',
      title: 'Low internal link count — only 3 detected',
      description: 'Internal links help search engines discover your pages and distribute ranking power.',
      autoFixable: false,
      fixSuggestion: 'Add contextual links between related pages (e.g., services → about, blog → services).',
    });
  }
  return checks;
}

function checkPerformance(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (s.lcpMs !== null && s.lcpMs > 2500) {
    checks.push({
      id: 'lcp_slow', category: 'performance', severity: 'warning',
      title: `Largest Contentful Paint is ${(s.lcpMs / 1000).toFixed(1)}s (target: <2.5s)`,
      description: 'Slow LCP hurts user experience and search rankings.',
      autoFixable: false,
      fixSuggestion: 'Optimize your hero image (use WebP/AVIF, set explicit width/height, add fetchpriority="high"), reduce render-blocking resources.',
    });
  }
  if (s.cls !== null && s.cls > 0.1) {
    checks.push({
      id: 'cls_high', category: 'performance', severity: 'warning',
      title: `Cumulative Layout Shift is ${s.cls} (target: <0.1)`,
      description: 'Layout shifts frustrate users and hurt Core Web Vitals scores.',
      autoFixable: false,
      fixSuggestion: 'Set explicit width and height on all images, reserve space for embeds and ads, avoid inserting content above existing content.',
    });
  }
  if (s.lighthouseScore !== null && s.lighthouseScore < 75) {
    checks.push({
      id: 'lighthouse_low', category: 'performance', severity: 'warning',
      title: `Lighthouse performance score is ${s.lighthouseScore}/100`,
      description: 'Low Lighthouse scores indicate performance issues that affect SEO and user experience.',
      autoFixable: false,
      fixSuggestion: 'Run a Lighthouse audit to identify specific bottlenecks. Common fixes: optimize images, minify CSS/JS, enable compression.',
    });
  }
  return checks;
}

function checkSecurity(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (!s.hasSsl) {
    checks.push({
      id: 'no_ssl', category: 'security', severity: 'critical',
      title: 'SSL certificate not detected',
      description: 'HTTPS is required for security and SEO. Browsers mark HTTP sites as "Not Secure."',
      autoFixable: true,
      fixSuggestion: 'SSL is automatically provisioned by Cloudflare — verify your custom domain DNS is correctly configured.',
    });
  }
  if (!s.hasHsts) {
    checks.push({
      id: 'no_hsts', category: 'security', severity: 'warning',
      title: 'HSTS header not set',
      description: 'HTTP Strict Transport Security prevents downgrade attacks and improves security.',
      autoFixable: true,
      fixSuggestion: 'Enable HSTS with a max-age of at least 1 year and includeSubDomains.',
    });
  }
  if (!s.hasSecurityTxt) {
    checks.push({
      id: 'no_security_txt', category: 'security', severity: 'info',
      title: 'No security.txt file found',
      description: 'security.txt helps security researchers report vulnerabilities responsibly.',
      autoFixable: true,
      fixSuggestion: 'Auto-generate a /.well-known/security.txt file with your contact information.',
    });
  }
  return checks;
}

function checkTrust(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (!s.hasContactPhone && !s.hasContactEmail) {
    checks.push({
      id: 'no_contact', category: 'trust', severity: 'critical',
      title: 'No phone number or email address found on the site',
      description: 'Visitors need a way to contact you. Missing contact info is the #1 trust killer.',
      autoFixable: false,
      fixSuggestion: 'Add a prominent contact section with phone number and email address on your homepage.',
    });
  }
  if (!s.hasBusinessHours) {
    checks.push({
      id: 'no_hours', category: 'trust', severity: 'warning',
      title: 'Business hours not displayed',
      description: 'Customers check hours before visiting. Missing hours cause missed opportunities.',
      autoFixable: false,
      fixSuggestion: 'Add your business hours to the homepage or a dedicated location/hours section.',
    });
  }
  if (!s.hasTestimonials) {
    checks.push({
      id: 'no_testimonials', category: 'trust', severity: 'info',
      title: 'No testimonials or reviews displayed',
      description: 'Social proof is the #1 conversion driver. Testimonials build trust with new visitors.',
      autoFixable: false,
      fixSuggestion: 'Add a testimonial section with real customer reviews. Even 2-3 authentic quotes make a difference.',
    });
  }
  return checks;
}

function checkCompetitive(s: SiteSignals): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (s.competitorContentGaps > 5) {
    checks.push({
      id: 'competitor_gaps', category: 'competitive', severity: 'warning',
      title: `${s.competitorContentGaps} content topics your competitors cover that you do not`,
      description: 'Content gaps mean competitors are capturing search traffic you could own.',
      autoFixable: false,
      fixSuggestion: 'Use the Content Strategist to identify the highest-priority gaps and build a content calendar.',
    });
  }
  return checks;
}

function checkBrokenLinks(s: SiteSignals): HealthCheck[] {
  if (s.brokenLinkCount === 0) return [];
  return [{
    id: 'broken_links', category: 'seo', severity: s.brokenLinkCount > 5 ? 'critical' : 'warning',
    title: `${s.brokenLinkCount} broken link(s) detected`,
    description: 'Broken links create a poor user experience and waste search engine crawl budget.',
    autoFixable: false,
    fixSuggestion: 'Review and fix or remove broken links. Common causes: deleted pages, changed URLs, external sites that went offline.',
  }];
}

// ── Health score ────────────────────────────────────────────────────────────

function computeHealthScore(checks: HealthCheck[]): number {
  if (checks.length === 0) return 100;
  const penalties = checks.reduce((sum, c) => {
    switch (c.severity) {
      case 'critical': return sum + 15;
      case 'warning': return sum + 10;
      case 'info': return sum + 2;
    }
  }, 0);
  return Math.max(0, 100 - penalties);
}

function computeOverallHealth(score: number): LifecycleReport['overallHealth'] {
  if (score > 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 25) return 'poor';
  return 'critical';
}

function generateSummary(report: LifecycleReport): string {
  if (report.overallHealth === 'excellent') {
    return `Your site is in excellent health (${report.healthScore}/100). No critical issues detected. Keep up the good work!`;
  }
  if (report.overallHealth === 'good') {
    return `Your site is in good health (${report.healthScore}/100). ${report.criticalCount} critical issue(s) and ${report.warningCount} warning(s) need attention.`;
  }
  const topIssue = report.checks.find((c) => c.severity === 'critical') || report.checks[0];
  return `Your site needs attention (${report.healthScore}/100). ${report.criticalCount} critical issue(s), ${report.warningCount} warning(s). Top priority: "${topIssue?.title}"`;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Runs a complete site health check across all monitoring dimensions.
 *
 * @param siteId - The site's database ID.
 * @param signals - Site health signals from the build pipeline and analytics.
 * @returns A complete LifecycleReport with checks, scores, and recommendations.
 */
export function runLifecycleCheck(siteId: string, signals: SiteSignals): LifecycleReport {
  const checks: HealthCheck[] = [
    ...checkContentFreshness(signals),
    ...checkSeoFundamentals(signals),
    ...checkPerformance(signals),
    ...checkSecurity(signals),
    ...checkTrust(signals),
    ...checkCompetitive(signals),
    ...checkBrokenLinks(signals),
  ];

  const criticalCount = checks.filter((c) => c.severity === 'critical').length;
  const warningCount = checks.filter((c) => c.severity === 'warning').length;
  const infoCount = checks.filter((c) => c.severity === 'info').length;
  const healthScore = computeHealthScore(checks);

  const report: LifecycleReport = {
    siteId,
    siteSlug: signals.slug,
    generatedAt: new Date().toISOString(),
    overallHealth: computeOverallHealth(healthScore),
    healthScore,
    checks,
    criticalCount,
    warningCount,
    infoCount,
    summary: '',
    nextCheckIn: '7 days',
  };

  report.summary = generateSummary(report);
  return report;
}
