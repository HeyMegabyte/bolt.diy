import { buildBaselineJsonLd, applyServedRouteJsonLd } from '../services/site_serving.js';

/** Parse the JSON bodies out of the concatenated <script type=ld+json> tags. */
function parseBlocks(htmlOrFragment: string): Array<Record<string, unknown>> {
  const bodies = htmlOrFragment.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  return bodies
    .map((tag) => tag.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim())
    .filter((body) => body.length > 0) // skip the empty "decoy" reader tag
    .map((body) => JSON.parse(body));
}

describe('site_serving — buildBaselineJsonLd', () => {
  it('emits 4 separate, valid JSON-LD blocks for a sub-route', () => {
    const frag = buildBaselineJsonLd('Acme Gym', 'https://acme.projectsites.dev', '/about');
    const blocks = parseBlocks(frag);
    expect(blocks).toHaveLength(4);
    const byType = Object.fromEntries(blocks.map((b) => [b['@type'], b]));
    expect(Object.keys(byType).sort()).toEqual(['BreadcrumbList', 'Organization', 'WebPage', 'WebSite']);
    expect(byType.WebSite.url).toBe('https://acme.projectsites.dev/');
    expect(byType.WebPage.url).toBe('https://acme.projectsites.dev/about');
    expect(byType.WebPage.name).toBe('About — Acme Gym');
    expect((byType.WebPage.isPartOf as Record<string, unknown>).url).toBe('https://acme.projectsites.dev/');
    const crumbs = byType.BreadcrumbList.itemListElement as Array<Record<string, unknown>>;
    expect(crumbs.map((c) => c.name)).toEqual(['Home', 'About']);
    expect(crumbs[1].item).toBe('https://acme.projectsites.dev/about');
    for (const b of blocks) expect(b['@context']).toBe('https://schema.org');
  });

  it('homepage: WebPage name = brand, single Home breadcrumb', () => {
    const blocks = parseBlocks(buildBaselineJsonLd('Acme Gym', 'https://acme.projectsites.dev', '/'));
    const wp = blocks.find((b) => b['@type'] === 'WebPage')!;
    expect(wp.name).toBe('Acme Gym');
    expect(wp.url).toBe('https://acme.projectsites.dev/');
    const bl = blocks.find((b) => b['@type'] === 'BreadcrumbList')!;
    expect((bl.itemListElement as unknown[])).toHaveLength(1);
  });

  it('nested route → multi-level breadcrumb', () => {
    const blocks = parseBlocks(buildBaselineJsonLd('Acme', 'https://a.dev', '/services/personal-training'));
    const bl = blocks.find((b) => b['@type'] === 'BreadcrumbList')!;
    const crumbs = bl.itemListElement as Array<Record<string, unknown>>;
    expect(crumbs.map((c) => c.name)).toEqual(['Home', 'Services', 'Personal Training']);
    expect(crumbs[2].item).toBe('https://a.dev/services/personal-training');
  });

  it('brand with & / quotes stays valid JSON (injection-safe)', () => {
    const blocks = parseBlocks(buildBaselineJsonLd('Ember & Oak "Co"', 'https://e.dev', '/'));
    expect(blocks.find((b) => b['@type'] === 'WebSite')!.name).toBe('Ember & Oak "Co"');
  });
});

describe('site_serving — applyServedRouteJsonLd', () => {
  const shell = (extraHead = '') =>
    `<html><head><title>Acme Gym — Train Hard</title><link rel="canonical" href="https://acme.projectsites.dev/">${extraHead}</head><body>x</body></html>`;

  it('injects 4 blocks when the shell has NO real JSON-LD (only the empty decoy)', () => {
    const out = applyServedRouteJsonLd(shell('<script type="application/ld+json"></script>'), '/about');
    const blocks = parseBlocks(out);
    expect(blocks.filter((b) => b['@type']).length).toBe(4);
    expect(blocks.find((b) => b['@type'] === 'WebPage')!.url).toBe('https://acme.projectsites.dev/about');
    // brand recovered from the PRISTINE homepage title (pre-separator)
    expect(blocks.find((b) => b['@type'] === 'WebSite')!.name).toBe('Acme Gym');
  });

  it('is a NO-OP when a real @type block already exists (rebuilt site)', () => {
    const withReal = shell('<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Acme"}</script>');
    expect(applyServedRouteJsonLd(withReal, '/about')).toBe(withReal);
  });

  it('no-op without a canonical/og:url origin to anchor absolute URLs', () => {
    const noCanon = '<html><head><title>Acme — X</title></head><body>x</body></html>';
    expect(applyServedRouteJsonLd(noCanon, '/about')).toBe(noCanon);
  });
});
