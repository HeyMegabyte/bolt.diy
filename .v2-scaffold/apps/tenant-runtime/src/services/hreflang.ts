/**
 * Multi-domain hreflang map for a tenant site.
 *
 * @remarks
 *  A tenant can be served on multiple hostnames (the platform-issued
 *  `{slug}.projectsites.dev` plus any custom hostnames attached via Cloudflare
 *  for SaaS). When the same logical URL exists at multiple
 *  hostname + locale combinations, Google + Bing want an
 *  `<xhtml:link rel="alternate" hreflang="...">` entry per variant pointing
 *  to the canonical absolute URL, plus an `x-default` row for the language-
 *  neutral fallback.
 *
 *  `buildHreflangMap` returns the list of entries the sitemap generator (and,
 *  later, the per-page `<head>` injector) consume. The function is pure: it
 *  takes the tenant identity vars + the per-path locale list, never reads from
 *  D1/KV itself.
 *
 * @example
 *   const entries = buildHreflangMap({
 *     primaryHostname: 'acme.projectsites.dev',
 *     extraHostnames: ['www.acme.com'],
 *     supportedLocales: ['en', 'es', 'pt'],
 *     defaultLocale: 'en',
 *     path: '/about',
 *   });
 *   // → [
 *   //   { hreflang: 'en', href: 'https://acme.projectsites.dev/en/about' },
 *   //   { hreflang: 'es', href: 'https://acme.projectsites.dev/es/about' },
 *   //   { hreflang: 'pt', href: 'https://acme.projectsites.dev/pt/about' },
 *   //   { hreflang: 'en', href: 'https://www.acme.com/en/about' },
 *   //   { hreflang: 'es', href: 'https://www.acme.com/es/about' },
 *   //   { hreflang: 'pt', href: 'https://www.acme.com/pt/about' },
 *   //   { hreflang: 'x-default', href: 'https://acme.projectsites.dev/about' },
 *   // ]
 */
import type { Env } from '../env';

export interface HreflangEntry {
  /** BCP-47 tag or `x-default`. */
  hreflang: string;
  /** Absolute URL. */
  href: string;
}

export interface BuildHreflangArgs {
  primaryHostname: string;
  /** Additional hostnames the site is served on (custom domains, www variants). */
  extraHostnames?: readonly string[];
  /** Locales the site has translations for (lowercased BCP-47 tags). */
  supportedLocales: readonly string[];
  /** Locale used when no `/{locale}/` prefix appears in the URL. */
  defaultLocale: string;
  /** Path with leading slash, e.g. `/about` or `/`. */
  path: string;
}

/** Pure builder — the sitemap + per-page head injector both call this. */
export function buildHreflangMap(args: BuildHreflangArgs): HreflangEntry[] {
  const path = args.path.startsWith('/') ? args.path : `/${args.path}`;
  const hostnames = [args.primaryHostname, ...(args.extraHostnames ?? [])].filter(
    (h): h is string => !!h,
  );
  const seenHosts = new Set<string>();
  const dedupedHosts = hostnames.filter((h) => {
    if (seenHosts.has(h)) return false;
    seenHosts.add(h);
    return true;
  });

  const entries: HreflangEntry[] = [];
  for (const host of dedupedHosts) {
    const origin = `https://${host}`;
    for (const locale of args.supportedLocales) {
      const localePath = path === '/' ? `/${locale}` : `/${locale}${path}`;
      entries.push({ hreflang: locale, href: `${origin}${localePath}` });
    }
  }

  // x-default points at the primary hostname's locale-neutral URL, which the
  // tenant-runtime's static handler redirects to the user's negotiated locale.
  const defaultPath = path === '/' ? '/' : path;
  entries.push({
    hreflang: 'x-default',
    href: `https://${args.primaryHostname}${defaultPath}`,
  });

  return entries;
}

/**
 * Convenience overload pulling args off the tenant `Env`. The optional
 * `extraHostnames` come from a future `extra_hostnames` field on the tenant
 * vars; for now we resolve to `[]` so the v1 scaffold compiles unchanged.
 */
export function buildHreflangMapForEnv(env: Env, siteId: string, path: string): HreflangEntry[] {
  void siteId; // reserved for per-site overrides once `sites.extra_hostnames` lands
  const supportedLocales = env.SUPPORTED_LOCALES.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return buildHreflangMap({
    primaryHostname: env.PRIMARY_HOSTNAME,
    extraHostnames: [],
    supportedLocales,
    defaultLocale: env.DEFAULT_LOCALE,
    path,
  });
}
