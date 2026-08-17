/**
 * Soft-404 SSOT + drift guard for the marketing serve.
 *
 * The Worker serves the SPA shell with a 404 status for unknown top-level routes
 * (so `/garbage9999` doesn't index as a live 200). The known-route set MUST stay
 * in lock-step with the Angular router — this test parses app.routes.ts and fails
 * if a real top-level route is missing from the Worker SSOT (which would 404 a
 * legitimate page).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  isKnownMarketingRoute,
  KNOWN_MARKETING_PREFIXES,
  applyMarketingMeta,
  MARKETING_META,
} from '../marketing_routes.js';

/** Resolve app.routes.ts robustly across jest cwd/__dirname quirks. */
function readAppRoutes(): string | null {
  const candidates = [
    join(__dirname, '../../frontend/src/app/app.routes.ts'),
    join(process.cwd(), 'frontend/src/app/app.routes.ts'),
    join(process.cwd(), 'apps/project-sites/frontend/src/app/app.routes.ts'),
  ];
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, 'utf8');
  return null;
}

describe('isKnownMarketingRoute — known routes stay 200', () => {
  it.each([
    '/',
    '/blog',
    '/blog/hello-world',
    '/admin',
    '/admin/settings',
    '/admin/feature-flags',
    '/developers',
    '/pricing',
    '/search',
    '/signin',
    '/auth/sign-in',
    '/auth/2fa/verify',
    '/create',
    '/waiting',
    '/editor/my-slug',
    '/privacy',
    '/terms',
    '/changelog',
    '/review/abc123',
    '/shared/analytics/tok',
  ])('%s → known (200)', (p) => {
    expect(isKnownMarketingRoute(p)).toBe(true);
  });
});

describe('isKnownMarketingRoute — unknown routes become soft-404', () => {
  it.each([
    '/garbage9999',
    '/this-does-not-exist',
    '/xyz/abc',
    '/wp-admin',
    '/.env',
    '/random-junk',
  ])('%s → unknown (soft-404)', (p) => {
    expect(isKnownMarketingRoute(p)).toBe(false);
  });
});

describe('drift guard — app.routes.ts ↔ KNOWN_MARKETING_PREFIXES', () => {
  it('every top-level Angular route prefix is present in the Worker SSOT', () => {
    const src = readAppRoutes();
    if (src === null) {
      // frontend/ not present in this checkout (worker-only CI) — skip, don't false-fail.
      console.warn('marketing_routes drift guard: app.routes.ts not found, skipping');
      return;
    }
    // Top-level route entries are indented exactly 4 spaces (admin children = 8).
    const prefixes = new Set<string>();
    for (const m of src.matchAll(/^ {4}path: '([^']*)'/gm)) {
      const first = (m[1].replace(/^\/+/, '').split('/')[0] ?? '').trim();
      if (first === '**') continue; // Angular catch-all → intentional client 404
      prefixes.add(first);
    }
    expect(prefixes.size).toBeGreaterThan(12);
    const missing = [...prefixes].filter((p) => !KNOWN_MARKETING_PREFIXES.has(p));
    if (missing.length) {
      // Surface the drift loudly: a real Angular route missing here would 404 a live page.
      console.error(
        'DRIFT: app.routes.ts prefixes missing from KNOWN_MARKETING_PREFIXES:',
        missing,
      );
    }
    expect(missing).toEqual([]);
  });
});

const SHELL = [
  '<!DOCTYPE html><html><head>',
  '<title>ProjectSites — We deliver websites in minutes</title>',
  '<meta name="description" content="AI-native website builder for real businesses.">',
  '<link rel="canonical" href="https://projectsites.dev/">',
  '<meta property="og:title" content="ProjectSites - Your Website, Handled. Finally.">',
  '<meta property="og:description" content="AI-powered websites for small businesses.">',
  '<meta property="og:url" content="https://projectsites.dev/">',
  '</head><body></body></html>',
].join('\n');

describe('applyMarketingMeta — per-route <head> (SEO de-index fix)', () => {
  it('rewrites canonical + og:url to the route pageUrl (was hard-coded home → de-indexed every route)', () => {
    const out = applyMarketingMeta(SHELL, '/pricing', 'https://projectsites.dev/pricing');
    expect(out).toContain('<link rel="canonical" href="https://projectsites.dev/pricing">');
    expect(out).toContain('<meta property="og:url" content="https://projectsites.dev/pricing">');
    // The homepage canonical (which de-indexed every non-home route) must be GONE.
    expect(out).not.toContain('<link rel="canonical" href="https://projectsites.dev/">');
  });

  it('rewrites title/description/og for a route with dedicated copy', () => {
    const out = applyMarketingMeta(SHELL, '/pricing', 'https://projectsites.dev/pricing');
    const m = MARKETING_META['/pricing'];
    expect(out).toContain(`<title>${m.title}</title>`);
    expect(out).toContain(m.description);
    expect(out).not.toContain('We deliver websites in minutes'); // homepage title gone
  });

  it('home keeps its default title but the canonical stays self-referential (no map entry)', () => {
    const out = applyMarketingMeta(SHELL, '/', 'https://projectsites.dev/');
    expect(out).toContain('<title>ProjectSites — We deliver websites in minutes</title>');
    expect(out).toContain('<link rel="canonical" href="https://projectsites.dev/">');
  });

  it('every MARKETING_META entry meets the SEO length gates (title ≤60, desc 120-160)', () => {
    const oversized = Object.entries(MARKETING_META)
      .filter(
        ([, m]) => m.title.length > 60 || m.description.length < 120 || m.description.length > 160,
      )
      .map(([route, m]) => `${route} (title ${m.title.length}, desc ${m.description.length})`);
    expect(oversized).toEqual([]);
  });
});
