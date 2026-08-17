/**
 * Known top-level marketing SPA route prefixes — the SSOT the Worker uses to
 * decide 200 (real route) vs a 404-status soft-404 (unknown route = SEO junk).
 *
 * Before this, the base-domain marketing serve returned `200 marketing/index.html`
 * for EVERY non-file path — so `/garbage9999` indexed as a live 200 (a soft-404
 * that pollutes search + AI crawlers). Now an unknown top-level segment is served
 * the SPA shell with a real `404` status + `noindex` (the SPA still renders its
 * own 404 view; belt-and-suspenders for crawlers).
 *
 * ⚠️ MUST stay in lock-step with the Angular router
 * (`frontend/src/app/app.routes.ts` top-level `path:` entries). A route present
 * there but MISSING here would be served a 404 status (breaking a real page).
 * `src/__tests__/marketing_routes.test.ts` parses app.routes.ts and fails the
 * build if the two drift.
 */

/** Valid first path-segment of every public marketing SPA route (`''` = home). */
export const KNOWN_MARKETING_PREFIXES: ReadonlySet<string> = new Set([
  '', // home '/'
  'classic',
  'search',
  'pricing',
  'shared', // shared/analytics/:token
  'signin',
  'auth', // auth/sign-in, auth/2fa/*, …
  'create',
  'details',
  'waiting',
  'admin', // + all authed admin/* children
  'editor', // editor/:slug
  'privacy',
  'terms',
  'content',
  'billing',
  'blog', // blog, blog/:slug
  'changelog',
  'review', // review/:id
  'developers',
  'oauth', // oauth/consent
  'integrations',
  'roadmap',
  'press',
  'checkout',
  'error',
  'offline',
]);

/**
 * True when `pathname` maps to a real marketing SPA route (so serving the shell
 * with a 200 is correct). Unknown → the caller serves the shell with 404 status.
 *
 * @param pathname - URL pathname, e.g. `'/'`, `'/blog/foo'`, `'/garbage9999'`.
 * @returns whether the first path segment is a known marketing route prefix.
 * @example
 * isKnownMarketingRoute('/');            // true  (home)
 * isKnownMarketingRoute('/blog/hello');  // true  (blog/:slug)
 * isKnownMarketingRoute('/garbage9999'); // false → soft-404
 */
export function isKnownMarketingRoute(pathname: string): boolean {
  const first = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return KNOWN_MARKETING_PREFIXES.has(first);
}

/** Per-route `<title>` + `<meta description>` for marketing routes. */
export interface MarketingMeta {
  readonly title: string;
  readonly description: string;
}

/**
 * Per-route meta injected SERVER-SIDE into the marketing SPA shell so crawlers /
 * scrapers / social unfurlers read route-correct `<title>`/`<meta description>`/OG
 * (the Angular client `MetaService` only updates them AFTER hydration — invisible
 * to non-JS bots). Mirrors `frontend/src/app/services/meta.service.ts` `PAGE_META`;
 * keep the two in sync. Titles ≤60 chars, descriptions 120-156 (SEO gates). Home
 * (`/`) intentionally keeps the shell's default copy (no entry → no rewrite).
 */
export const MARKETING_META: Readonly<Record<string, MarketingMeta>> = {
  '/pricing': {
    title: 'Pricing — Plans for Your AI-Built Website | ProjectSites',
    description:
      'Simple pricing for AI-generated websites: a free tier to start, then one flat plan with hosting, SSL, a custom domain, and analytics all included.',
  },
  '/search': {
    title: 'Find Your Business — Start an AI Website | ProjectSites',
    description:
      'Search for your business and get a professional, SEO-ready website built by AI in minutes — hosted, SSL secured, and live. No coding required.',
  },
  '/classic': {
    title: 'AI Website Builder for Real Businesses | ProjectSites',
    description:
      'AI-native website builder for real businesses. One prompt, four minutes, a gorgeous live URL with SSL, sitemap, OG cards, and JSON-LD baked in.',
  },
  '/auth/sign-in': {
    title: 'Sign In — Manage Your AI Website | ProjectSites',
    description:
      'Sign in to manage your AI-generated website — edit content, connect a custom domain, view analytics, and handle billing. Magic link, no password.',
  },
  '/auth/sign-up': {
    title: 'Sign Up — Build Your AI Website Free | ProjectSites',
    description:
      'Create your free ProjectSites account and build a professional, SEO-ready website with AI in minutes — hosted, SSL secured, and live in four minutes.',
  },
  '/privacy': {
    title: 'Privacy Policy — Your Data & Rights | ProjectSites',
    description:
      'How ProjectSites collects, uses, stores, and protects your personal data — plus your rights to access, export, and delete it at any time.',
  },
  '/terms': {
    title: 'Terms of Service — Usage & Billing | ProjectSites',
    description:
      'The terms for using ProjectSites: account rules, acceptable use, billing, intellectual property, and service commitments for your AI-built site.',
  },
  '/blog': {
    title: 'AI Website Building Blog — Tips & Updates | ProjectSites',
    description:
      'Practical guides on AI-powered website building for small businesses — SEO, design, conversion, and launch tips from the ProjectSites team.',
  },
};

/** Resolve per-route marketing meta (trailing slash tolerant); null when none. */
export function resolveMarketingMeta(pathname: string): MarketingMeta | null {
  const clean = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  return MARKETING_META[clean] ?? null;
}

/** Escape a trusted string for safe injection into an HTML attribute / title. */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Rewrite the marketing shell's `<head>` for the requested route.
 *
 * ALWAYS rewrites `<link rel="canonical">` + `og:url` to the route's own
 * `pageUrl` — the shell hard-codes `href="https://projectsites.dev/"`, so every
 * non-home route was telling crawlers its canonical was the HOMEPAGE, which
 * DE-INDEXES /pricing, /search, /auth/*, … Also rewrites title/description/OG
 * when the route has dedicated copy in {@link MARKETING_META}.
 *
 * @param html - the shell HTML (homepage-default meta).
 * @param pathname - the requested URL pathname.
 * @param pageUrl - the absolute per-route canonical URL.
 * @returns HTML with route-correct canonical/og:url (+ title/desc when known).
 * @example
 * applyMarketingMeta(shell, '/pricing', 'https://projectsites.dev/pricing');
 * // → canonical + og:url point at /pricing; title is the pricing title.
 */
export function applyMarketingMeta(html: string, pathname: string, pageUrl: string): string {
  let out = html
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${pageUrl}">`,
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${pageUrl}$2`);
  const meta = resolveMarketingMeta(pathname);
  if (meta) {
    const t = escAttr(meta.title);
    const d = escAttr(meta.description);
    out = out
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${d}$2`)
      .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${t}$2`)
      .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${d}$2`)
      // Twitter/X cards are SEPARATE `name="twitter:*"` tags — rewriting only the
      // og:* tags left a /pricing link shared on X showing the HOMEPAGE title +
      // description. Rewrite them too so the social card matches the route.
      .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, `$1${t}$2`)
      .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, `$1${d}$2`);
  }
  return out;
}
