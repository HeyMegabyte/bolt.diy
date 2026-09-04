/**
 * @module services/meta
 *
 * @description
 * Per-route SEO/OG metadata controller. Subscribes to `NavigationEnd` and
 * stamps the matching `<title>`, `<meta description>`, Open Graph tags,
 * Twitter Card tags, and `<link rel="canonical">` based on a lookup table
 * keyed by the leaf-route path.
 *
 * @remarks
 * Mounted in `app.config.ts` providers and bootstrapped by `AppComponent` via
 * {@link MetaService.init} — calling `init()` more than once is harmless but
 * doubles the subscription, so call it exactly once.
 *
 * Keep `PAGE_META` keys in lock-step with `app.routes.ts`. Routes not in the
 * map fall back to the homepage entry (`''`).
 */
import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map, mergeMap } from 'rxjs';
import { graph, webPage, breadcrumbList } from '../lib/json-ld';
// PAGE_META lives in its own pure data module so the build-time SSOT gate
// (scripts/validate-meta-ssot.mjs) can import it and diff it against the Worker's
// MARKETING_META (the crawler-facing source of truth) — see page-meta.ts.
import { PAGE_META, type PageMeta } from './page-meta';

const BASE_URL = 'https://projectsites.dev';
const OG_IMAGE = 'https://projectsites.dev/og-image.jpg';

/**
 * Authed admin routes (`/admin/*`) must NOT be indexed — they're private
 * dashboards, and the SPA shell would otherwise index them under a wrong
 * (marketing) canonical. Marketing routes stay `index, follow`. Pure +
 * exported so it's unit-testable without a Router. The query/hash is stripped
 * so `/admin/sites?tab=x` + `/admin#y` still resolve to noindex.
 */
export function robotsForUrl(url: string | null | undefined): 'noindex, nofollow' | 'index, follow' {
  if (!url) return 'index, follow';
  const path = url.split('?')[0].split('#')[0];
  return path === '/admin' || path.startsWith('/admin/') ? 'noindex, nofollow' : 'index, follow';
}

/**
 * Dynamic detail routes whose per-record meta is owned by their COMPONENT
 * (stamped imperatively in `ngOnInit` via {@link MetaService.setMeta}), not by
 * the router-driven `PAGE_META` lookup. The `blog/<slug>` path has no `PAGE_META`
 * entry, so without this guard {@link MetaService.init} would fall back to the
 * homepage meta and clobber the post's title/og:title on every navigation (and
 * again on hydration, since `NavigationEnd` fires after the component's
 * `ngOnInit`). Currently only blog-post detail pages qualify — the `/blog` index
 * itself IS in `PAGE_META` and is intentionally excluded.
 *
 * @param path - Joined leaf-route path (e.g. `blog/my-post`), no leading slash.
 * @returns true when the route's component owns its own per-record meta.
 * @example
 * isComponentOwnedMetaRoute('blog/my-post'); // => true
 * isComponentOwnedMetaRoute('blog');         // => false (the index)
 */
export function isComponentOwnedMetaRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  return path.startsWith('blog/');
}

/**
 * Resolve the {@link PageMeta} for a joined leaf-route path (no leading slash),
 * falling back to the homepage entry when the route has no dedicated copy.
 *
 * This is the SINGLE lookup point the router-driven {@link MetaService.init}
 * uses — exported + pure so route coverage is unit-testable without a Router.
 * A route present in `app.routes.ts` but MISSING from `PAGE_META` here silently
 * inherits the homepage title on the hydrated tab (the bug that hid `/pricing`
 * + `/auth/sign-up` under the homepage title); the coverage test locks it.
 *
 * @param path - Joined leaf-route path, e.g. `'pricing'`, `'auth/sign-up'`, `''`.
 * @returns the route's PageMeta, or the homepage entry when unmapped.
 * @example
 * resolvePageMeta('pricing').title; // => 'Pricing — Plans for Your AI-Built Website | ProjectSites'
 * resolvePageMeta('nope-xyz').title; // => the homepage title (fallback)
 */
export function resolvePageMeta(path: string | null | undefined): PageMeta {
  return PAGE_META[path ?? ''] ?? PAGE_META[''];
}

@Injectable({ providedIn: 'root' })
export class MetaService {
  private title = inject(Title);
  private meta = inject(Meta);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /**
   * Wire the router subscription. Call exactly once at app bootstrap.
   *
   * @example
   * ```ts
   * // app.component.ts
   * ngOnInit(): void { this.meta.init(); }
   * ```
   */
  init(): void {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.route),
      map(route => {
        while (route.firstChild) route = route.firstChild;
        return route;
      }),
      mergeMap(route => route.url),
    ).subscribe(segments => {
      const path = segments.map(s => s.path).join('/') || '';
      // Blog posts (and future dynamic detail routes) stamp their own per-record
      // meta in ngOnInit — never overwrite it with the homepage PAGE_META fallback.
      if (isComponentOwnedMetaRoute(path)) return;
      this.updateMeta(resolvePageMeta(path), path);
    });
  }

  /**
   * Imperatively set page meta from a component (for routes whose meta isn't in
   * the route-driven PAGE_META table, e.g. /developers). Only provided fields apply.
   */
  setMeta(opts: { title?: string; description?: string; canonical?: string; ogImage?: string }): void {
    if (opts.title) {
      this.title.setTitle(opts.title);
      this.meta.updateTag({ property: 'og:title', content: opts.title });
      this.meta.updateTag({ name: 'twitter:title', content: opts.title });
    }
    if (opts.description) {
      this.meta.updateTag({ name: 'description', content: opts.description });
      this.meta.updateTag({ property: 'og:description', content: opts.description });
      this.meta.updateTag({ name: 'twitter:description', content: opts.description });
    }
    if (opts.ogImage) {
      this.meta.updateTag({ property: 'og:image', content: opts.ogImage });
      this.meta.updateTag({ name: 'twitter:image', content: opts.ogImage });
    }
    if (opts.canonical) {
      const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (link) link.href = opts.canonical;
      this.meta.updateTag({ property: 'og:url', content: opts.canonical });
    }
  }

  /** Apply the meta payload to the document head and update the canonical link. */
  private updateMeta(page: PageMeta, path: string): void {
    const url = `${BASE_URL}/${path}`;

    this.title.setTitle(page.title);

    // Standard SEO
    this.meta.updateTag({ name: 'description', content: page.description });

    // Index marketing routes; never index authed /admin/* dashboards. Set on
    // every nav so it resets correctly when leaving admin (no sticky noindex).
    this.meta.updateTag({ name: 'robots', content: robotsForUrl(this.router.url) });

    // Open Graph (Facebook, LinkedIn, Discord, Slack, iMessage, WhatsApp, Telegram)
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: OG_IMAGE });
    this.meta.updateTag({ property: 'og:image:width', content: '1200' });
    this.meta.updateTag({ property: 'og:image:height', content: '630' });

    // Twitter / X
    this.meta.updateTag({ name: 'twitter:title', content: page.title });
    this.meta.updateTag({ name: 'twitter:description', content: page.description });
    this.meta.updateTag({ name: 'twitter:image', content: OG_IMAGE });

    // Update canonical
    const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (link) {
      link.href = url;
    }

    // Per-route WebPage + BreadcrumbList. The worker (apps/project-sites/src/index.ts)
    // injects an Org+WebSite+WebPage @graph server-side; historically its WebPage was
    // hardcoded to the homepage url on EVERY route (wrong on /privacy, /blog, …). We
    // MUTATE that existing graph in place so the hydrated DOM carries exactly ONE,
    // route-accurate WebPage + a Home > <segment> BreadcrumbList — no duplicate node.
    // (The worker now also emits this per-route server-side; the client upsert is then
    // an idempotent re-confirm. If no server graph is present, we inject our own.)
    const crumbs: { name: string; url: string }[] = [{ name: 'Home', url: `${BASE_URL}/` }];
    if (path) {
      const seg = path.split('/').filter(Boolean).pop() ?? path;
      const name = seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      crumbs.push({ name, url });
    }
    this.upsertRouteStructuredData(url, page, crumbs);
  }

  /**
   * Make the hydrated DOM carry a single, route-accurate WebPage + BreadcrumbList.
   *
   * @remarks
   * Finds the server-injected `application/ld+json` `@graph` block (the one the
   * worker emits with Organization + WebSite + WebPage) and rewrites its WebPage
   * node to THIS route's url/title/description, then upserts a BreadcrumbList node
   * into the same graph. This avoids a duplicate WebPage (one stale homepage one +
   * one per-route one) that appending a separate block would create. If no such
   * server graph exists, falls back to injecting our own `'page'` slot block.
   */
  private upsertRouteStructuredData(
    url: string,
    page: PageMeta,
    crumbs: { name: string; url: string }[],
  ): void {
    if (typeof document === 'undefined') return;

    const breadcrumbNode = {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.url,
      })),
    };

    // Locate the server graph that owns a WebPage node — but skip our own managed
    // blocks (data-jsonld-*) so we never recurse on a block we injected.
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    ).filter((s) => !Array.from(s.attributes).some((a) => a.name.startsWith('data-jsonld-')));

    for (const s of scripts) {
      let parsed: { '@graph'?: Array<Record<string, unknown>> } | null = null;
      try {
        parsed = JSON.parse(s.textContent || 'null');
      } catch {
        continue;
      }
      const nodes = parsed && Array.isArray(parsed['@graph']) ? parsed['@graph'] : null;
      if (!nodes) continue;
      const webPageNode = nodes.find((n) => n['@type'] === 'WebPage');
      if (!webPageNode) continue;

      webPageNode['@id'] = `${url}#webpage`;
      webPageNode['url'] = url;
      webPageNode['name'] = page.title;
      webPageNode['description'] = page.description;

      const existingCrumb = nodes.find((n) => n['@type'] === 'BreadcrumbList');
      if (existingCrumb) {
        existingCrumb['@id'] = breadcrumbNode['@id'];
        existingCrumb['itemListElement'] = breadcrumbNode.itemListElement;
      } else {
        nodes.push(breadcrumbNode);
      }

      const next = JSON.stringify(parsed);
      if (s.textContent !== next) s.textContent = next;
      return; // handled by the server graph — no separate block needed
    }

    // No server graph present (e.g. local dev without the worker) — inject our own.
    this.setJsonLd(
      graph([
        webPage({ url, title: page.title, description: page.description, image: OG_IMAGE }),
        breadcrumbList(crumbs),
      ]),
      'page',
    );
  }

  /**
   * Inject a JSON-LD `<script type="application/ld+json" data-route-jsonld>`
   * block into `<head>`, replacing any prior route-scoped block. Components
   * that want per-page structured data call this in `ngOnInit` (or via an
   * effect) — see {@link ../lib/json-ld} for the factory helpers.
   *
   * Re-applying the same content is a no-op (we serialize + diff the body
   * before mutating the DOM), so calling this from `ngOnInit` is safe even
   * if the component re-renders.
   *
   * @example
   * ```ts
   * import { graph, organization, softwareApplication, webPage } from '../../lib/json-ld';
   *
   * ngOnInit(): void {
   *   this.meta.setJsonLd(graph([
   *     organization(),
   *     softwareApplication(),
   *     webPage({ url: 'https://projectsites.dev/press', title: 'Press kit' }),
   *   ]));
   * }
   * ```
   */
  setJsonLd(payload: Record<string, unknown> | null, slot = 'route'): void {
    if (typeof document === 'undefined') return;
    const tagId = `${slot}-jsonld`;
    let el = document.getElementById(tagId) as HTMLScriptElement | null;
    if (payload === null) {
      el?.remove();
      return;
    }
    const body = JSON.stringify(payload);
    if (el && el.textContent === body) return;
    if (!el) {
      el = document.createElement('script');
      el.id = tagId;
      el.type = 'application/ld+json';
      el.setAttribute(`data-jsonld-${slot}`, '');
      document.head.appendChild(el);
    }
    el.textContent = body;
  }
}
