/**
 * @module services/category_jsonld
 * @description A13 — structured data for a category landing page (organic +
 * AI-search discovery). Emits schema.org `SoftwareApplication` (ProjectSites as
 * the builder for that category) + `BreadcrumbList` + `CollectionPage`. Pure +
 * zero-I/O + accuracy-first: never fabricates an `aggregateRating` (a rating is
 * included only when real counts are passed). Never throws.
 *
 * @packageDocumentation
 */

const DEFAULT_BASE = 'https://projectsites.dev';

/** Inputs describing one category landing page. */
export interface CategoryJsonLdInput {
  /** Human category label, e.g. `Restaurants`. */
  readonly category: string;
  /** URL slug, e.g. `restaurants`. */
  readonly slug: string;
  /** Site apex (no trailing slash); default `https://projectsites.dev`. */
  readonly baseUrl?: string;
  /** One-sentence description; a sensible default is generated when absent. */
  readonly description?: string;
  /** Number of templates listed (informational; not invented into a rating). */
  readonly templateCount?: number;
  /** Real review aggregate — included ONLY when both are positive (never faked). */
  readonly ratingValue?: number;
  readonly ratingCount?: number;
}

/** A schema.org JSON-LD block. */
export type JsonLdBlock = Record<string, unknown>;

/** Strip a trailing slash from a base URL. */
function normBase(base: string | undefined): string {
  const b = (base ?? DEFAULT_BASE).trim() || DEFAULT_BASE;
  return b.replace(/\/+$/, '');
}

/** Title-case a slug/label fallback, e.g. `home_services` → `Home Services`. */
export function categoryTitle(value: string): string {
  const v = (value ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) return 'Business';
  return v
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build the JSON-LD blocks for a category landing page.
 *
 * @param input - {@link CategoryJsonLdInput}.
 * @returns `[SoftwareApplication, BreadcrumbList, CollectionPage]`, each a valid
 *   schema.org block with `@context` + `@type`.
 *
 * @example
 * buildCategoryJsonLd({ category: 'Restaurants', slug: 'restaurants' })[0]['@type']
 * // → 'SoftwareApplication'
 */
export function buildCategoryJsonLd(input: CategoryJsonLdInput): JsonLdBlock[] {
  const base = normBase(input.baseUrl);
  const slug =
    (input.slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '') || 'business';
  const label = (input.category ?? '').trim() || categoryTitle(slug);
  const url = `${base}/templates/${slug}`;
  const description =
    (input.description ?? '').trim() ||
    `AI-built, hosted ${label.toLowerCase()} websites — live in minutes, SEO-ready, mobile-first, on Cloudflare's edge.`;

  const software: JsonLdBlock = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `ProjectSites — ${label} Website Builder`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url,
    description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  // Only attach a rating when REAL aggregate data is supplied — never fabricate.
  if (
    typeof input.ratingValue === 'number' &&
    input.ratingValue > 0 &&
    typeof input.ratingCount === 'number' &&
    input.ratingCount > 0
  ) {
    software.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(input.ratingValue * 10) / 10,
      ratingCount: Math.round(input.ratingCount),
    };
  }

  const breadcrumb: JsonLdBlock = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base },
      { '@type': 'ListItem', position: 2, name: 'Templates', item: `${base}/templates` },
      { '@type': 'ListItem', position: 3, name: label, item: url },
    ],
  };

  const collection: JsonLdBlock = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${label} Website Templates`,
    description,
    url,
    isPartOf: { '@type': 'WebSite', url: base, name: 'ProjectSites' },
  };

  return [software, breadcrumb, collection];
}
