/**
 * @module services/year_in_review
 *
 * @description
 * Pure stat-rollup engine: given a year of analytics events per site, produce
 * the personalised highlight reel. Zero I/O, never throws. Used once a year by
 * the retention-loop cron to generate "Year in Review" emails.
 *
 * Every number is comma-formatted or shortened (1.2K, 3.5M). Every highlight
 * is fact-based, never marketing slop. Every report ends with "Here's to
 * another great year".
 *
 * @see services/analytics_events.ts (event shapes consumed upstream)
 */

/** Raw stat rollups for a single site over one calendar year. */
export interface YearInReviewInput {
  readonly siteName: string;
  readonly year: number;
  readonly totalVisitors: number;
  readonly totalPageviews: number;
  readonly topReferrers: readonly string[];
  readonly topPages: readonly string[];
  readonly conversionCount: number;
  readonly busiestDay: { date: string; count: number } | null;
  readonly busiestHour: number | null;
  readonly peakSeason: string | null;
}

/** The generated personal highlight reel. */
export interface YearInReview {
  readonly highlights: readonly string[];
  readonly stats: readonly { label: string; value: string }[];
  readonly headline: string;
  readonly shareText: string;
}

/**
 * Generate the year-in-review report from raw rollup stats.
 *
 * @param input - Verified stat rollups for a site/year. All fields may be zero
 *   or empty; the function always produces a valid, minimal report.
 * @returns A structured report with fact-based highlights, a stats table,
 *   a branded headline, and a social-friendly share-text.
 *
 * @example buildYearInReview({
 *   siteName: "Vito's",
 *   year: 2026,
 *   totalVisitors: 12340,
 *   totalPageviews: 89000,
 *   topReferrers: ["google.com", "facebook.com"],
 *   topPages: ["/services", "/about"],
 *   conversionCount: 312,
 *   busiestDay: { date: "2026-06-15", count: 480 },
 *   busiestHour: 18,
 *   peakSeason: "Summer",
 * }) // → YearInReview with 5-7 highlights, 6 stats, headline, shareText
 */
export function buildYearInReview(input: YearInReviewInput): YearInReview {
  const highlights: string[] = [];

  if (input.totalVisitors > 0) {
    highlights.push(`${formatCount(input.totalVisitors)} people visited your site this year.`);
  }

  if (input.totalPageviews > 0) {
    highlights.push(`Your pages were viewed ${formatCount(input.totalPageviews)} times.`);
  }

  if (input.topPages.length > 0) {
    highlights.push(`Your most popular page was ${input.topPages[0]}.`);
  }

  if (input.topReferrers.length > 0) {
    highlights.push(`Your top referrer was ${input.topReferrers[0]}.`);
  }

  if (input.conversionCount > 0) {
    highlights.push(`${formatCount(input.conversionCount)} leads came through your site.`);
  }

  if (input.busiestDay !== null) {
    let msg = `Your busiest day was ${input.busiestDay.date} with ${formatCount(input.busiestDay.count)} visits`;
    if (input.busiestHour !== null) {
      msg += `, peaking at ${formatHour(input.busiestHour)}.`;
    } else {
      msg += '.';
    }
    highlights.push(msg);
  } else if (input.busiestHour !== null) {
    highlights.push(`Your busiest hour was ${formatHour(input.busiestHour)}.`);
  }

  if (input.peakSeason !== null) {
    highlights.push(`Your peak season was ${input.peakSeason}.`);
  }

  // Always close on a positive note
  highlights.push("Here's to another great year ahead.");

  const stats: { label: string; value: string }[] = [
    { label: 'Visitors', value: formatCount(input.totalVisitors) },
    { label: 'Pageviews', value: formatCount(input.totalPageviews) },
    { label: 'Leads', value: formatCount(input.conversionCount) },
    { label: 'Busiest Day', value: input.busiestDay !== null ? input.busiestDay.date : '—' },
    { label: 'Top Referrer', value: input.topReferrers.length > 0 ? input.topReferrers[0] : '—' },
    { label: 'Peak Season', value: input.peakSeason ?? '—' },
  ];

  const headline = `${input.siteName} — ${input.year} in Review`;

  const shareText = generateShareText(input);

  return { highlights, stats, headline, shareText };
}

/**
 * Format a number for display: small numbers get commas, medium gets "X.Xk",
 * large gets "X.XM" with one decimal.
 *
 * @param n - Any non-negative integer.
 * @returns A display-friendly string.
 *
 * @example formatCount(1234) // → "1,234"
 * @example formatCount(12345) // → "12.3k"
 * @example formatCount(1000000) // → "1.0M"
 * @example formatCount(0) // → "0"
 */
export function formatCount(n: number): string {
  if (n < 10000) {
    return n.toLocaleString('en-US');
  }

  if (n < 1_000_000) {
    const val = n / 1000;
    return `${val.toFixed(1)}k`;
  }

  const val = n / 1_000_000;
  return `${val.toFixed(1)}M`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function generateShareText(input: YearInReviewInput): string {
  const bits: string[] = [];
  if (input.totalVisitors > 0) {
    bits.push(`${formatCount(input.totalVisitors)} visitors`);
  }
  if (input.totalPageviews > 0) {
    bits.push(`${formatCount(input.totalPageviews)} pageviews`);
  }
  if (input.conversionCount > 0) {
    bits.push(`${formatCount(input.conversionCount)} leads`);
  }

  if (bits.length === 0) {
    return `${input.siteName} — ${input.year} in Review. See what happened this year.`;
  }

  return `${input.siteName} — ${input.year} in Review: ${bits.join(', ')}. See what happened this year.`;
}
