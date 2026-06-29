import { buildCategoryJsonLd, categoryTitle } from '../services/category_jsonld.js';

describe('categoryTitle (A13 category_jsonld)', () => {
  it('title-cases slug/label fallbacks', () => {
    expect(categoryTitle('home_services')).toBe('Home Services');
    expect(categoryTitle('restaurants')).toBe('Restaurants');
  });
  it('falls back to "Business" for empty', () => {
    expect(categoryTitle('')).toBe('Business');
    expect(categoryTitle('   ')).toBe('Business');
  });
});

describe('buildCategoryJsonLd (A13)', () => {
  it('emits SoftwareApplication + BreadcrumbList + CollectionPage, each schema-valid', () => {
    const blocks = buildCategoryJsonLd({ category: 'Restaurants', slug: 'restaurants' });
    expect(blocks.map((b) => b['@type'])).toEqual([
      'SoftwareApplication',
      'BreadcrumbList',
      'CollectionPage',
    ]);
    for (const b of blocks) expect(b['@context']).toBe('https://schema.org');
  });

  it('builds the canonical category URL + offer', () => {
    const [software] = buildCategoryJsonLd({ category: 'Restaurants', slug: 'restaurants' });
    expect(software.url).toBe('https://projectsites.dev/templates/restaurants');
    expect(software.name).toBe('ProjectSites — Restaurants Website Builder');
    expect(software.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  });

  it('orders breadcrumb Home → Templates → Category with positions', () => {
    const [, breadcrumb] = buildCategoryJsonLd({ category: 'Cafés', slug: 'cafes' });
    const items = breadcrumb.itemListElement as Array<{ position: number; name: string }>;
    expect(items.map((i) => [i.position, i.name])).toEqual([
      [1, 'Home'],
      [2, 'Templates'],
      [3, 'Cafés'],
    ]);
  });

  it('NEVER fabricates an aggregateRating when no real data given', () => {
    const [software] = buildCategoryJsonLd({ category: 'Restaurants', slug: 'restaurants' });
    expect(software.aggregateRating).toBeUndefined();
  });

  it('includes aggregateRating ONLY when real counts are supplied', () => {
    const [software] = buildCategoryJsonLd({
      category: 'Restaurants',
      slug: 'restaurants',
      ratingValue: 4.85,
      ratingCount: 120,
    });
    expect(software.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.9,
      ratingCount: 120,
    });
  });

  it('sanitizes the slug + honors a custom base (no trailing slash)', () => {
    const [software] = buildCategoryJsonLd({
      category: 'Law Firms',
      slug: 'Law Firms!!',
      baseUrl: 'https://example.com/',
    });
    expect(software.url).toBe('https://example.com/templates/lawfirms');
  });

  it('derives a description + label from slug when omitted', () => {
    const [, , collection] = buildCategoryJsonLd({ category: '', slug: 'pet_grooming' });
    // empty category → slug-derived label is sanitized to "petgrooming"
    expect(typeof collection.description).toBe('string');
    expect((collection.description as string).length).toBeGreaterThan(10);
  });
});
