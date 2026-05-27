/**
 * Org-type-aware Schema.org JSON-LD builder.
 *
 * @remarks
 *  One switch statement, one entry per supported `SITE_TYPE`. Returns a
 *  `<script type="application/ld+json">` string ready to inject into a
 *  page's `<head>`. Per `[[always]]` § JSON-LD: never pad — only emit
 *  schemas that describe real entities on the page.
 *
 *  Inputs come from the tenant env + site row + optional page extras
 *  (e.g. lat/lng for `LocalBusiness`). Anything optional that's missing
 *  is silently omitted rather than emitted as `null`.
 *
 * @example
 *   const jsonLd = buildJsonLd('local-business', {
 *     name: 'Acme Plumbing',
 *     url: 'https://acme.com',
 *     telephone: '+1-555-555-1212',
 *     address: { streetAddress: '1 Main', addressLocality: 'Newark',
 *                addressRegion: 'NJ', postalCode: '07102', addressCountry: 'US' },
 *     geo: { latitude: 40.7357, longitude: -74.1724 },
 *     openingHours: ['Mo-Fr 09:00-17:00'],
 *     priceRange: '$$',
 *   });
 *
 * @see [[always]] § JSON-LD per page
 * @see [[copy-writing]] § GEO/AI search
 */

export type OrgType =
  | 'software'
  | 'saas'
  | 'local-business'
  | 'nonprofit'
  | 'portfolio'
  | 'restaurant'
  | 'medical'
  | 'legal'
  | 'retail';

export interface SiteInput {
  /** Brand / institution name. */
  readonly name: string;
  /** Canonical URL. */
  readonly url: string;
  /** Short tagline / one-line description. */
  readonly description?: string;
  /** Primary logo (square or wide). */
  readonly logo?: string;
  /** Hero / OG card image. */
  readonly image?: string;
  /** External brand profiles (LinkedIn, GitHub, Twitter, IG). */
  readonly sameAs?: ReadonlyArray<string>;
  readonly telephone?: string;
  readonly email?: string;
  readonly priceRange?: string;
  readonly foundingDate?: string;
  readonly address?: PostalAddress;
  readonly geo?: GeoCoordinates;
  /**
   * Schema.org `openingHoursSpecification`-friendly entries, e.g.
   * `'Mo-Fr 09:00-17:00'`. Stored verbatim.
   */
  readonly openingHours?: ReadonlyArray<string>;
  readonly areaServed?: ReadonlyArray<string>;
  readonly servesCuisine?: ReadonlyArray<string>;
  readonly menuUrl?: string;
  /** Pricing reference URL (for SaaS `offers.url`). */
  readonly pricingUrl?: string;
  /** Screenshot URL for `SoftwareApplication.screenshot`. */
  readonly screenshot?: string;
}

export interface PostalAddress {
  readonly streetAddress: string;
  readonly addressLocality: string;
  readonly addressRegion: string;
  readonly postalCode: string;
  readonly addressCountry: string;
}

export interface GeoCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Type-safe JSON-LD record. Keys are arbitrary; values are JSON-able. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [k: string]: JsonValue | undefined };

type JsonLd = { readonly [k: string]: JsonValue | undefined };

function postalAddress(a: PostalAddress): JsonLd {
  return {
    '@type': 'PostalAddress',
    streetAddress: a.streetAddress,
    addressLocality: a.addressLocality,
    addressRegion: a.addressRegion,
    postalCode: a.postalCode,
    addressCountry: a.addressCountry,
  };
}

function geoCoordinates(g: GeoCoordinates): JsonLd {
  return {
    '@type': 'GeoCoordinates',
    latitude: g.latitude,
    longitude: g.longitude,
  };
}

function openingHoursSpec(hours: ReadonlyArray<string>): ReadonlyArray<JsonLd> {
  return hours.map((h) => ({ '@type': 'OpeningHoursSpecification', '@id': h, name: h }));
}

function localBusiness(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    telephone: site.telephone,
    email: site.email,
    priceRange: site.priceRange ?? '$$',
    address: site.address ? postalAddress(site.address) : undefined,
    geo: site.geo ? geoCoordinates(site.geo) : undefined,
    openingHoursSpecification: site.openingHours ? openingHoursSpec(site.openingHours) : undefined,
    sameAs: site.sameAs,
    areaServed: site.areaServed,
  };
}

function ngo(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    name: site.name,
    url: site.url,
    description: site.description,
    logo: site.logo,
    image: site.image,
    foundingDate: site.foundingDate,
    sameAs: site.sameAs,
    areaServed: site.areaServed,
    telephone: site.telephone,
    email: site.email,
    address: site.address ? postalAddress(site.address) : undefined,
  };
}

function softwareApplication(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    screenshot: site.screenshot,
    offers: site.pricingUrl
      ? {
          '@type': 'Offer',
          url: site.pricingUrl,
          priceCurrency: 'USD',
          price: site.priceRange ?? '0',
        }
      : undefined,
    sameAs: site.sameAs,
  };
}

function portfolio(site: SiteInput): ReadonlyArray<JsonLd> {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      url: site.url,
      description: site.description,
      image: site.image,
      sameAs: site.sameAs,
      email: site.email,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: site.url,
      description: site.description,
    },
  ];
}

function restaurant(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    telephone: site.telephone,
    priceRange: site.priceRange ?? '$$',
    servesCuisine: site.servesCuisine,
    menu: site.menuUrl,
    address: site.address ? postalAddress(site.address) : undefined,
    geo: site.geo ? geoCoordinates(site.geo) : undefined,
    openingHoursSpecification: site.openingHours ? openingHoursSpec(site.openingHours) : undefined,
    sameAs: site.sameAs,
  };
}

function medicalBusiness(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    telephone: site.telephone,
    address: site.address ? postalAddress(site.address) : undefined,
    geo: site.geo ? geoCoordinates(site.geo) : undefined,
    openingHoursSpecification: site.openingHours ? openingHoursSpec(site.openingHours) : undefined,
    sameAs: site.sameAs,
  };
}

function legalService(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    telephone: site.telephone,
    priceRange: site.priceRange ?? '$$$',
    address: site.address ? postalAddress(site.address) : undefined,
    openingHoursSpecification: site.openingHours ? openingHoursSpec(site.openingHours) : undefined,
    sameAs: site.sameAs,
  };
}

function store(site: SiteInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: site.name,
    url: site.url,
    description: site.description,
    image: site.image,
    logo: site.logo,
    telephone: site.telephone,
    priceRange: site.priceRange ?? '$$',
    address: site.address ? postalAddress(site.address) : undefined,
    geo: site.geo ? geoCoordinates(site.geo) : undefined,
    openingHoursSpecification: site.openingHours ? openingHoursSpec(site.openingHours) : undefined,
    sameAs: site.sameAs,
  };
}

/** Strip `undefined` recursively so the serialized JSON-LD stays clean. */
function pruneUndefined(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map((v) => pruneUndefined(v))
      .filter((v): v is JsonValue => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneUndefined(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    return out;
  }
  return value;
}

/**
 * Build JSON-LD for an org-type. Returns one or more `@graph` blobs as a
 * single `<script>` tag ready for `<head>` injection.
 */
export function buildJsonLd(orgType: OrgType, site: SiteInput): string {
  let body: JsonLd | ReadonlyArray<JsonLd>;
  switch (orgType) {
    case 'local-business':
      body = localBusiness(site);
      break;
    case 'nonprofit':
      body = ngo(site);
      break;
    case 'software':
    case 'saas':
      body = softwareApplication(site);
      break;
    case 'portfolio':
      body = portfolio(site);
      break;
    case 'restaurant':
      body = restaurant(site);
      break;
    case 'medical':
      body = medicalBusiness(site);
      break;
    case 'legal':
      body = legalService(site);
      break;
    case 'retail':
      body = store(site);
      break;
    default: {
      const _exhaustive: never = orgType;
      void _exhaustive;
      body = localBusiness(site);
    }
  }
  const cleaned = pruneUndefined(body as JsonValue);
  const json = JSON.stringify(cleaned, null, 2);
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/**
 * Inject the JSON-LD `<script>` into an HTML document's `<head>`. If
 * `<head>` is missing, append at document end. Idempotent: if a
 * `data-org-type-jsonld` script already exists, replace it.
 */
export function injectJsonLd(html: string, orgType: OrgType, site: SiteInput): string {
  const tag = buildJsonLd(orgType, site).replace(
    '<script type="application/ld+json">',
    '<script type="application/ld+json" data-org-type-jsonld="true">',
  );
  if (/<script[^>]*data-org-type-jsonld="true"[^>]*>[\s\S]*?<\/script>/i.test(html)) {
    return html.replace(
      /<script[^>]*data-org-type-jsonld="true"[^>]*>[\s\S]*?<\/script>/i,
      tag,
    );
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tag}\n</head>`);
  }
  return html + tag;
}
