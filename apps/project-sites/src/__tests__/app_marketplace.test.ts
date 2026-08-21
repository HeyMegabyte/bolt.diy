import {
  APP_LISTINGS,
  appsByCategory,
  searchApps,
  generateJsonLd,
} from '../services/app_marketplace.js';
describe('app_marketplace A18', () => {
  it('has >=4 listings (plane/unkey removed 2026-08-20)', () => {
    expect(APP_LISTINGS.length).toBeGreaterThanOrEqual(4);
  });
  it('all slugs unique', () => {
    expect(new Set(APP_LISTINGS.map((a) => a.slug)).size).toBe(APP_LISTINGS.length);
  });
  it('all listings have required fields', () => {
    APP_LISTINGS.forEach((a) => {
      expect(a.slug).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.url).toBeTruthy();
    });
  });
  it('filters by category', () => {
    expect(appsByCategory('nonexistent')).toEqual([]);
  });
  it('case-insensitive category', () => {
    expect(appsByCategory('CRM')[0].slug).toBe('twenty');
  });
  it('search matches name/desc/tags', () => {
    expect(searchApps('newsletter').length).toBe(1);
    expect(searchApps('open').length).toBeGreaterThanOrEqual(1);
  });
  it('empty search returns empty', () => {
    expect(searchApps('')).toEqual([]);
    expect(searchApps('  ')).toEqual([]);
  });
  it('generates valid JSON-LD per listing', () => {
    const ld = generateJsonLd(APP_LISTINGS[0]);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.offers).toBeDefined();
  });
  it('all listings generate JSON-LD', () => {
    APP_LISTINGS.forEach((a) => {
      const ld = generateJsonLd(a);
      expect(ld['@type']).toBe('SoftwareApplication');
    });
  });
});
