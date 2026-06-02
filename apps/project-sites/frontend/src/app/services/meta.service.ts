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

/** Per-route SEO payload — `url` is computed at apply-time from `BASE_URL`. */
interface PageMeta {
  title: string;
  description: string;
  url?: string;
}

/** Path → title/description map. Keys match `app.routes.ts` leaf paths. */
const PAGE_META: Record<string, PageMeta> = {
  '': {
    // 52 chars (50-60 SEO sweet spot) + leads with the primary keyphrase
    // "AI Website Builder" (was 45 chars, brand-only, missing the keyphrase).
    title: 'ProjectSites — AI Website Builder, Live in 4 Minutes',
    description: 'AI-native website builder for real businesses. One prompt, four minutes, a gorgeous live URL with SSL, sitemap, OG cards, and JSON-LD baked in.',
  },
  'create': {
    title: 'Create Your AI Website in Minutes — No Code | ProjectSites',
    description: 'Tell us about your business and our AI builds a professional, SEO-ready website in minutes — hosted, SSL secured, and live. No coding required.',
  },
  'signin': {
    title: 'Sign In — Manage Your AI-Built Website | ProjectSites',
    description: 'Sign in to manage your AI-generated website — edit content, connect a custom domain, view analytics, and handle billing. Magic link, no password.',
  },
  'waiting': {
    title: 'Building Your AI Website — Live Progress | ProjectSites',
    description: 'Your AI-generated website is being built right now — watch each step (research, design, content, deploy) complete live in real time.',
  },
  'admin': {
    title: 'Dashboard - ProjectSites',
    description: 'Manage your websites, domains, files, and billing from one dashboard.',
  },
  'privacy': {
    title: 'Privacy Policy — Your Data, Rights & Choices | ProjectSites',
    description: 'How ProjectSites collects, uses, stores, and protects your personal data — plus your rights to access, export, and delete it at any time.',
  },
  'terms': {
    title: 'Terms of Service — Plans, Usage & Conduct | ProjectSites',
    description: 'The terms and conditions for using ProjectSites: account rules, acceptable use, billing, intellectual property, and service commitments.',
  },
  'content': {
    title: 'Content Policy — Acceptable Use Guidelines | ProjectSites',
    description: 'Acceptable-use and content guidelines for websites built on ProjectSites — what you can publish, prohibited content, and how we enforce it.',
  },
  'blog': {
    title: 'AI Website Building Blog — Tips & Updates | ProjectSites',
    description: 'Practical guides on AI-powered website building for small businesses — SEO, design, conversion, and launch tips from the ProjectSites team.',
  },
  'changelog': {
    title: 'Changelog - ProjectSites',
    description: 'See what\'s new in ProjectSites. Feature releases, improvements, and fixes. Subscribe via RSS.',
  },
  'roadmap': {
    title: 'Product Roadmap — Shipped, In Progress & Next | ProjectSites',
    description: 'See what we are building next for ProjectSites. Trello-style public roadmap with shipped, in-progress, and planned features.',
  },
  'integrations': {
    title: 'Integrations — Stripe, Square, OpenAI & 30+ | ProjectSites',
    description: 'Connect ProjectSites with Stripe, Square, Twilio, OpenAI, Anthropic, Slack, HubSpot, and 30 more services across nine categories.',
  },
  'press': {
    title: 'Press Kit — Brand Assets & Media Contacts | ProjectSites',
    description: 'Brand assets, founder bio, fact sheet, 8-slide cinematic picture walkthrough, press releases, and media contacts for ProjectSites by Megabyte Labs.',
  },
  'status': {
    title: 'System Status - ProjectSites',
    description: 'Real-time status of ProjectSites infrastructure, API, and build services.',
  },
  'search': {
    title: 'Search - ProjectSites',
    description: 'Find businesses, browse pre-built sites, and discover what AI can build for you.',
  },
};

const BASE_URL = 'https://projectsites.dev';
const OG_IMAGE = 'https://projectsites.dev/og-image.jpg';

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
      const pageMeta = PAGE_META[path] || PAGE_META[''];
      this.updateMeta(pageMeta, path);
    });
  }

  /** Apply the meta payload to the document head and update the canonical link. */
  private updateMeta(page: PageMeta, path: string): void {
    const url = `${BASE_URL}/${path}`;

    this.title.setTitle(page.title);

    // Standard SEO
    this.meta.updateTag({ name: 'description', content: page.description });

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
  setJsonLd(payload: Record<string, unknown> | null): void {
    if (typeof document === 'undefined') return;
    const tagId = 'route-jsonld';
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
      el.setAttribute('data-route-jsonld', '');
      document.head.appendChild(el);
    }
    el.textContent = body;
  }
}
