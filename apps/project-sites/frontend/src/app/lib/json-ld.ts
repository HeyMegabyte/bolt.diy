/**
 * @module lib/json-ld
 *
 * @description
 * Schema.org JSON-LD factories for public ProjectSites pages.
 *
 * Every public marketing surface gets:
 * - {@link organization}      — the publisher entity (single source of truth)
 * - {@link softwareApplication} — the product itself
 * - {@link webPage}            — the current page node
 * - {@link breadcrumbList}     — nested-route breadcrumb trail
 * - {@link faqPage}            — when real Q&A exists on the page (never fabricated)
 *
 * Per-tenant generated business sites get:
 * - {@link localBusiness} — NAP + geo + opening hours + price range
 *
 * @remarks
 * Every factory returns a plain object. Components inject it via the
 * {@link MetaService.setJsonLd} helper which serializes + injects a single
 * `<script type="application/ld+json">` tag per route, replacing any prior
 * tag on navigation.
 *
 * @example
 * ```ts
 * import { graph, organization, softwareApplication, webPage } from '../lib/json-ld';
 * import { MetaService } from '../services/meta.service';
 *
 * const meta = inject(MetaService);
 * meta.setJsonLd(graph([
 *   organization(),
 *   softwareApplication(),
 *   webPage({ url: 'https://projectsites.dev/press', title: 'Press kit' }),
 * ]));
 * ```
 */

export const BASE_URL = 'https://projectsites.dev';
export const ORG_ID = `${BASE_URL}/#org`;
export const APP_ID = `${BASE_URL}/#app`;

/** Top-level Organization node — every page that references the publisher links to this `@id`. */
export function organization() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'ProjectSites by Megabyte Labs',
    alternateName: 'ProjectSites',
    url: `${BASE_URL}/`,
    logo: `${BASE_URL}/icon-512.png`,
    email: 'hey@megabyte.space',
    foundingDate: '2026-01-15',
    sameAs: [
      'https://github.com/heymegabyte',
      'https://x.com/MegabyteLabs',
      'https://www.linkedin.com/company/megabyte-labs',
    ],
  };
}

/** The product itself — used on home + press + features + pricing. */
export function softwareApplication() {
  return {
    '@type': 'SoftwareApplication',
    '@id': APP_ID,
    name: 'ProjectSites',
    description:
      'AI-native website builder for real businesses. Search your business, hand off a one-line brief, and watch a gorgeous magazine-grade website ship to your domain in under 15 minutes.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${BASE_URL}/`,
    publisher: { '@id': ORG_ID },
    offers: [
      { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
      { '@type': 'Offer', name: 'Base', price: '50', priceCurrency: 'USD' },
    ],
    // NOTE: no aggregateRating — it must reflect REAL, on-page reviews. There
    // are none yet, so a hardcoded "4.9/47" was a fabricated authority signal
    // (banned by thin-source-amplification + a Google structured-data policy
    // violation: ratings require corresponding visible review content). Add a
    // real AggregateRating only once genuine reviews exist + render on the page.
  };
}

/** WebPage node for the current route. */
export function webPage(args: { url: string; title: string; description?: string; image?: string }) {
  return {
    '@type': 'WebPage',
    '@id': `${args.url}#webpage`,
    url: args.url,
    name: args.title,
    description: args.description,
    isPartOf: { '@id': `${BASE_URL}/#website` },
    about: { '@id': ORG_ID },
    primaryImageOfPage: args.image,
  };
}

/** BreadcrumbList for nested routes (>1 segment). Skip on homepage. */
export function breadcrumbList(crumbs: ReadonlyArray<{ name: string; url: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

/**
 * FAQPage — ONLY when real Q&A exists on the page. Never fabricate Q&A just
 * to insert the schema; that's a build-fail per `[[always]]` JSON-LD rules.
 */
export function faqPage(qa: ReadonlyArray<{ q: string; a: string }>) {
  return {
    '@type': 'FAQPage',
    mainEntity: qa.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/**
 * Person node — used on /about + /press for founder bio. `sameAs` array
 * preserves external identity profiles for EEAT signals.
 */
export function person(args: { id: string; name: string; jobTitle: string; sameAs?: readonly string[] }) {
  return {
    '@type': 'Person',
    '@id': args.id,
    name: args.name,
    jobTitle: args.jobTitle,
    worksFor: { '@id': ORG_ID },
    sameAs: args.sameAs,
  };
}

/**
 * LocalBusiness — used on per-tenant generated business sites.
 *
 * @example
 * ```ts
 * localBusiness({
 *   name: 'Vito's Mens Salon',
 *   url: 'https://vito-mens-salon.projectsites.dev/',
 *   address: { streetAddress: '74 N Beverwyck Rd', addressLocality: 'Lake Hiawatha', addressRegion: 'NJ', postalCode: '07034', addressCountry: 'US' },
 *   telephone: '+1-973-555-0100',
 *   geo: { latitude: 40.881, longitude: -74.366 },
 *   priceRange: '$$',
 * })
 * ```
 */
export interface LocalBusinessInput {
  readonly name: string;
  readonly url: string;
  readonly image?: string;
  readonly description?: string;
  readonly address?: {
    readonly streetAddress?: string;
    readonly addressLocality?: string;
    readonly addressRegion?: string;
    readonly postalCode?: string;
    readonly addressCountry?: string;
  };
  readonly telephone?: string;
  readonly geo?: { readonly latitude: number; readonly longitude: number };
  readonly priceRange?: string;
  readonly openingHours?: readonly string[];
  readonly sameAs?: readonly string[];
}

export function localBusiness(input: LocalBusinessInput) {
  const node: Record<string, unknown> = {
    '@type': 'LocalBusiness',
    '@id': `${input.url}#business`,
    name: input.name,
    url: input.url,
  };
  if (input.image) node['image'] = input.image;
  if (input.description) node['description'] = input.description;
  if (input.address) {
    node['address'] = { '@type': 'PostalAddress', ...input.address };
  }
  if (input.telephone) node['telephone'] = input.telephone;
  if (input.geo) {
    node['geo'] = {
      '@type': 'GeoCoordinates',
      latitude: input.geo.latitude,
      longitude: input.geo.longitude,
    };
  }
  if (input.priceRange) node['priceRange'] = input.priceRange;
  if (input.openingHours?.length) node['openingHoursSpecification'] = input.openingHours;
  if (input.sameAs?.length) node['sameAs'] = input.sameAs;
  return node;
}

/**
 * Wrap a list of nodes into a Schema.org `@graph`. Always set `@context`
 * exactly once at the root so validators accept the document.
 */
export function graph(nodes: ReadonlyArray<Record<string, unknown>>) {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes,
  };
}
