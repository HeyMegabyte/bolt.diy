import { test, expect } from './fixtures';

/**
 * JSON-LD structured-data coverage.
 *
 * Every public marketing route must emit a Schema.org `@graph` document
 * containing at minimum:
 * - `Organization` node with `@id`, `name`, `url`, `logo`
 * - `WebPage` node with `@id`, `url`, `name`
 *
 * The `/press` route adds:
 * - `SoftwareApplication` (the product)
 * - `Person` (Brian, founder)
 * - `BreadcrumbList` (Home → Press)
 *
 * Validation here is structural — we parse the JSON, assert the @graph
 * shape and key fields. A full Schema.org-validator pass happens out-of-band
 * via Google Rich Results Test API as part of `deploy-verifier`.
 */

interface GraphNode {
  '@type': string | string[];
  '@id'?: string;
  [key: string]: unknown;
}

interface SchemaDoc {
  '@context': string;
  '@graph': GraphNode[];
}

async function readJsonLd(page: import('@playwright/test').Page): Promise<SchemaDoc[]> {
  const blobs = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blobs.map((b) => JSON.parse(b) as SchemaDoc);
}

test.describe('JSON-LD on /press', () => {
  test('emits exactly one route-scoped @graph with required nodes', async ({ anonPage: page }) => {
    await page.goto('/press');
    await page.waitForLoadState('networkidle');

    // The dedicated route-scoped tag from MetaService.setJsonLd
    const routeTag = page.locator('script#route-jsonld[type="application/ld+json"]');
    await expect(routeTag).toHaveCount(1);

    const body = await routeTag.textContent();
    expect(body).toBeTruthy();
    const doc = JSON.parse(body!) as SchemaDoc;

    // Context + graph
    expect(doc['@context']).toBe('https://schema.org');
    expect(Array.isArray(doc['@graph'])).toBe(true);
    expect(doc['@graph'].length).toBeGreaterThanOrEqual(5);

    // Required node types
    const types = doc['@graph'].map((n) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('Person');
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('WebPage');
  });

  test('Organization node has correct @id + sameAs + logo', async ({ anonPage: page }) => {
    await page.goto('/press');
    const docs = await readJsonLd(page);
    const routeDoc = docs.find((d) => Array.isArray(d['@graph']))!;
    const org = routeDoc['@graph'].find((n) => n['@type'] === 'Organization')!;

    expect(org['@id']).toBe('https://projectsites.dev/#org');
    expect(org['name']).toMatch(/ProjectSites/);
    expect(org['logo']).toContain('icon-512.png');
    expect(Array.isArray(org['sameAs'])).toBe(true);
    expect((org['sameAs'] as string[]).some((s) => s.includes('github.com'))).toBe(true);
  });

  test('SoftwareApplication has offers + aggregateRating + applicationCategory', async ({ anonPage: page }) => {
    await page.goto('/press');
    const docs = await readJsonLd(page);
    const routeDoc = docs.find((d) => Array.isArray(d['@graph']))!;
    const app = routeDoc['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!;

    expect(app['applicationCategory']).toBe('BusinessApplication');
    expect(app['operatingSystem']).toBe('Web');
    expect(Array.isArray(app['offers'])).toBe(true);
    expect((app['offers'] as Array<{ price: string }>)[0].price).toBe('0');
    const rating = app['aggregateRating'] as { ratingValue?: string; ratingCount?: string };
    expect(rating).toBeDefined();
    expect(rating.ratingValue).toBeTruthy();
    expect(rating.ratingCount).toBeTruthy();
  });

  test('Person node identifies Brian + links to LinkedIn / X / GitHub', async ({ anonPage: page }) => {
    await page.goto('/press');
    const docs = await readJsonLd(page);
    const routeDoc = docs.find((d) => Array.isArray(d['@graph']))!;
    const brian = routeDoc['@graph'].find((n) => n['@type'] === 'Person')!;

    expect(brian['name']).toBe('Brian Zalewski');
    expect(brian['jobTitle']).toMatch(/Founder/);
    const sameAs = brian['sameAs'] as string[];
    expect(sameAs.some((s) => s.includes('linkedin.com'))).toBe(true);
    expect(sameAs.some((s) => s.includes('x.com'))).toBe(true);
    expect(sameAs.some((s) => s.includes('github.com'))).toBe(true);
  });

  test('BreadcrumbList contains Home → Press in correct order', async ({ anonPage: page }) => {
    await page.goto('/press');
    const docs = await readJsonLd(page);
    const routeDoc = docs.find((d) => Array.isArray(d['@graph']))!;
    const breadcrumbs = routeDoc['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!;
    const items = breadcrumbs['itemListElement'] as Array<{
      position: number;
      name: string;
      item: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: 'https://projectsites.dev/' });
    expect(items[1]).toMatchObject({ position: 2, name: 'Press', item: 'https://projectsites.dev/press' });
  });

  test('WebPage references the Organization via @id', async ({ anonPage: page }) => {
    await page.goto('/press');
    const docs = await readJsonLd(page);
    const routeDoc = docs.find((d) => Array.isArray(d['@graph']))!;
    const webPage = routeDoc['@graph'].find((n) => n['@type'] === 'WebPage')!;
    expect(webPage['@id']).toBe('https://projectsites.dev/press#webpage');
    expect(webPage['url']).toBe('https://projectsites.dev/press');
    expect((webPage['about'] as { '@id': string })['@id']).toBe('https://projectsites.dev/#org');
    expect(webPage['primaryImageOfPage']).toContain('/walkthrough/08-live.jpg');
  });
});
