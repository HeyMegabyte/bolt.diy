/**
 * Build validators — programmatic enforcement of post-build quality gates.
 *
 * @remarks
 * Runs after the container uploads to R2 and before D1 status flips to `published`.
 * Each gate maps 1:1 to a BUILD-BREAKING entry in skill 15 quality-gates.md and the
 * audit recommendations (megabyte-labs + nyfb retro).
 *
 * Modes:
 * - `strict` — any error-severity violation throws → site stays in `error` status
 * - `report` — collect violations, log to D1 audit, never throw
 *
 * @see ~/.agentskills/15-site-generation/quality-gates.md
 * @see ~/.agentskills/06-build-and-slice-loop/web-manifest-system.md
 */

export type Severity = 'error' | 'warn' | 'info';

export interface Violation {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  detail?: string;
}

export interface BuildFile {
  /** Path relative to dist root, e.g. "index.html", "assets/index-abc.js" */
  path: string;
  /** Decoded text content for HTML/JS/CSS/JSON/XML/SVG/TXT, undefined for binary */
  text?: string;
  /** Byte length of the original file. */
  size: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: Violation[];
  warnings: Violation[];
  infos: Violation[];
  summary: string;
}

const BANNED_WORDS = [
  'limitless',
  'revolutionize',
  'game-changing',
  'cutting-edge',
  'next-generation',
  'world-class',
  'best-in-class',
  'turnkey',
  'synergy',
  'leverage',
  'utilize',
  'seamless',
  'robust',
  'state-of-the-art',
  'paradigm',
  'holistic',
  'spearhead',
  'tapestry',
  'plethora',
  'myriad',
  'supercharge',
];

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'images.unsplash.com',
  'images.pexels.com',
  'res.cloudinary.com',
  'api.mapbox.com',
  'www.google.com',
  'maps.googleapis.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'i.ytimg.com',
  'img.youtube.com',
  'www.youtube.com',
  'player.vimeo.com',
  'www.gstatic.com',
  'projectsites.dev',
]);

const HTML_EXTENSIONS = ['.html', '.htm'];
const TEXT_EXTENSIONS = [
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.xml',
  '.txt',
  '.svg',
  '.webmanifest',
];

const isHtml = (p: string) => HTML_EXTENSIONS.some((e) => p.toLowerCase().endsWith(e));
const isText = (p: string) => TEXT_EXTENSIONS.some((e) => p.toLowerCase().endsWith(e));
const isPng = (p: string) => p.toLowerCase().endsWith('.png');
const isFavicon = (p: string) => /favicon|apple-touch-icon|icon-\d+x\d+/i.test(p);
const isOgImage = (p: string) => /og-image|opengraph|social-card/i.test(p);

const stripScripts = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

const matchAll = (html: string, re: RegExp): string[] => {
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
};

const isInternalRef = (ref: string): boolean => {
  if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#'))
    return false;
  if (ref.startsWith('mailto:') || ref.startsWith('tel:') || ref.startsWith('javascript:'))
    return false;
  if (ref.startsWith('//') || ref.match(/^https?:\/\//i)) return false;
  return true;
};

const normalizeRef = (ref: string): string => {
  let p = ref.split('?')[0].split('#')[0];
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
};

const externalHost = (ref: string): string | null => {
  const m = ref.match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
};

const collectRefs = (html: string): string[] => {
  const refs: string[] = [];
  refs.push(
    ...matchAll(
      html,
      /<(?:img|source|video|audio|iframe|script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi,
    ),
  );
  refs.push(...matchAll(html, /url\(["']?([^"')]+)["']?\)/gi));
  return refs;
};

/** Asset existence — every internal ref MUST have a matching file. */
export const validateAssetExistence = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const fileSet = new Set(files.map((f) => f.path));
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const refs = collectRefs(file.text);
    for (const ref of refs) {
      const host = externalHost(ref);
      if (host) {
        if (!ALLOWED_EXTERNAL_HOSTS.has(host) && !host.endsWith('.projectsites.dev')) {
          out.push({
            code: 'asset.external_host_not_allowed',
            severity: 'warn',
            message: `External host not in allowlist: ${host}`,
            file: file.path,
            detail: ref,
          });
        }
        continue;
      }
      if (!isInternalRef(ref)) continue;
      const norm = normalizeRef(ref);
      if (!norm) continue;
      if (!fileSet.has(norm)) {
        out.push({
          code: 'asset.missing',
          severity: 'error',
          message: `Referenced asset not in build output: /${norm}`,
          file: file.path,
          detail: ref,
        });
      }
    }
  }
  return out;
};

/** Image format vs size — PNG > 200KB must be re-encoded WebP/JPEG. */
export const validateImageFormat = (files: BuildFile[]): Violation[] => {
  // Build a lookup of paths that have AVIF or WebP siblings — those PNGs are
  // intentional fallbacks emitted by the image_optimization pipeline and not
  // a violation even when large.
  const pathSet = new Set(files.map((f) => f.path));
  const hasOptimizedSibling = (pngPath: string): boolean => {
    const base = pngPath.replace(/\.png$/i, '');
    return pathSet.has(`${base}.avif`) || pathSet.has(`${base}.webp`);
  };
  return files
    .filter(
      (f) =>
        isPng(f.path) && !isFavicon(f.path) && f.size > 200 * 1024 && !hasOptimizedSibling(f.path),
    )
    .map((f) => ({
      code: 'image.png_too_large',
      severity: 'error' as Severity,
      message: `PNG > 200KB must be WebP/JPEG: ${f.path} (${Math.round(f.size / 1024)}KB)`,
      file: f.path,
    }));
};

/** OG image — must exist, ≤100KB, branded card (not raw photo). */
export const validateOgImage = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const og = files.find((f) => isOgImage(f.path));
  if (!og) {
    out.push({
      code: 'og.missing',
      severity: 'error',
      message: 'No og-image found (need 1200×630 branded card)',
    });
    return out;
  }
  if (og.size > 100 * 1024) {
    out.push({
      code: 'og.too_large',
      severity: 'error',
      message: `og-image > 100KB: ${og.path} (${Math.round(og.size / 1024)}KB)`,
      file: og.path,
    });
  }
  return out;
};

/** apple-touch-icon — 180×180 mandatory at root. */
export const validateAppleTouchIcon = (files: BuildFile[]): Violation[] => {
  const has = files.some((f) => f.path === 'apple-touch-icon.png');
  return has
    ? []
    : [
        {
          code: 'icon.apple_touch_missing',
          severity: 'error',
          message: 'apple-touch-icon.png (180×180) required at root',
        },
      ];
};

const titleText = (html: string): string => {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
};
const titleLength = (html: string): number => titleText(html).length;

const metaDescText = (html: string): string => {
  // Find the description meta tag (any attribute order), then extract its
  // `content` value respecting the value's OWN delimiter via a backreference.
  // The old /content=["']([^"']*)["']/ stopped the capture at the first
  // apostrophe OR quote — not the actual delimiter — so a valid double-quoted
  // value like content="Vito's Salon…" truncated to "Vito" (len 4) and produced
  // a FALSE meta.description_length violation on every possessive/contraction.
  const tag = html.match(/<meta\s+[^>]*\bname=["']description["'][^>]*>/i);
  if (!tag) return '';
  const c = tag[0].match(/\bcontent=(["'])([\s\S]*?)\1/i);
  return c ? c[2].trim() : '';
};
const metaDescLength = (html: string): number => metaDescText(html).length;

/** Title 50-60, description 120-156. */
export const validateMetaLengths = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const t = titleLength(file.text);
    if (t < 50 || t > 60) {
      out.push({
        code: 'meta.title_length',
        severity: 'error',
        message: `<title> must be 50-60 chars (got ${t})`,
        file: file.path,
      });
    }
    const d = metaDescLength(file.text);
    if (d < 120 || d > 156) {
      out.push({
        code: 'meta.description_length',
        severity: 'error',
        message: `meta description must be 120-156 chars (got ${d})`,
        file: file.path,
      });
    }
  }
  return out;
};

/**
 * Per-page `<title>` + `<meta description>` UNIQUENESS across a multi-page build.
 *
 * `validateMetaLengths` checks LENGTH (50-60 / 120-156 chars) but NOT uniqueness,
 * so a build where every route ships the HOMEPAGE's title/description passes every
 * gate while being an SEO duplicate-content failure — search engines collapse
 * duplicate `<title>`s, so sub-pages never rank for their OWN keywords, and browser
 * tabs / share cards all read the homepage label. This is a REAL generation defect:
 * megabytespace `/about`, `/services`, `/pricing`, `/maker-lab`, `/contact` all
 * shipped the identical homepage `<title>` (the canonical/og:url were per-route via
 * the worker rewrite, but title/description are baked at generation).
 *
 * Flags a title (error) or description (warn) shared by ≥2 DISTINCT HTML pages.
 * Comparison collapses whitespace + lowercases so trivial formatting differences
 * don't mask a real duplicate. Single-page sites can't collide → no-op.
 */
export const validateUniquePageTitles = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const htmlFiles = files.filter((f) => isHtml(f.path) && f.text);
  if (htmlFiles.length < 2) return out; // no cross-page collision possible

  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const push = (map: Map<string, string[]>, key: string, path: string): void => {
    const list = map.get(key);
    if (list) list.push(path);
    else map.set(key, [path]);
  };

  const byTitle = new Map<string, string[]>();
  const byDesc = new Map<string, string[]>();
  for (const f of htmlFiles) {
    const title = titleText(f.text as string);
    const desc = metaDescText(f.text as string);
    if (title) push(byTitle, norm(title), f.path);
    if (desc) push(byDesc, norm(desc), f.path);
  }

  for (const paths of byTitle.values()) {
    if (paths.length >= 2) {
      out.push({
        code: 'meta.title_duplicate',
        severity: 'error',
        message: `${paths.length} pages share the identical <title> — each route needs a unique, keyword-targeted title for SEO`,
        file: paths.slice(0, 6).join(', '),
      });
    }
  }
  for (const paths of byDesc.values()) {
    if (paths.length >= 2) {
      out.push({
        code: 'meta.description_duplicate',
        severity: 'warn',
        message: `${paths.length} pages share the identical meta description — each route needs a unique description`,
        file: paths.slice(0, 6).join(', '),
      });
    }
  }
  return out;
};

/**
 * JSON-LD structural integrity (build-artifact drift guard per
 * `drift-detection.md § Build-artifact drift guards`). `validateJsonLdCount`
 * only counts the `application/ld+json` string — a site can ship 4 EMPTY or
 * MALFORMED blocks and pass, then fail Google Rich Results (no rich snippets →
 * less SEO traffic → fewer leads for the owner → lower ROI). This parses each
 * block and asserts it is valid JSON carrying `@context` + `@type` (handling a
 * top-level array and `@graph` containers). Warn (report mode), per block.
 */
const JSONLD_BLOCK = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const jsonLdNodeOk = (node: unknown): boolean =>
  typeof node === 'object' && node !== null && '@type' in (node as Record<string, unknown>);
export const validateJsonLdStructure = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    for (const m of file.text.matchAll(JSONLD_BLOCK)) {
      const raw = (m[1] ?? '').trim();
      if (!raw) {
        out.push({
          code: 'jsonld.malformed',
          severity: 'warn',
          message: 'Empty JSON-LD block (no content) — fails Rich Results.',
          file: file.path,
        });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        out.push({
          code: 'jsonld.malformed',
          severity: 'warn',
          message: 'JSON-LD block is not valid JSON — fails Rich Results.',
          file: file.path,
        });
        continue;
      }
      const root = parsed as Record<string, unknown>;
      const nodes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(root['@graph'])
          ? (root['@graph'] as unknown[])
          : [parsed];
      const hasContext =
        (typeof root === 'object' && root !== null && '@context' in root) ||
        nodes.some((n) => typeof n === 'object' && n !== null && '@context' in (n as object));
      if (!hasContext) {
        out.push({
          code: 'jsonld.missing_required_field',
          severity: 'warn',
          message: 'JSON-LD block missing @context — fails Rich Results.',
          file: file.path,
        });
      }
      if (!nodes.every(jsonLdNodeOk)) {
        out.push({
          code: 'jsonld.missing_required_field',
          severity: 'warn',
          message: 'JSON-LD block has a node missing @type — fails Rich Results.',
          file: file.path,
        });
      }
    }
  }
  return out;
};

/** JSON-LD — at least 4 blocks per HTML page. */
export const validateJsonLdCount = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const count = (file.text.match(/application\/ld\+json/gi) || []).length;
    if (count < 4) {
      out.push({
        code: 'jsonld.count_below_threshold',
        severity: 'error',
        message: `JSON-LD blocks below 4 (got ${count}). Need WebSite+Organization+WebPage+BreadcrumbList minimum.`,
        file: file.path,
      });
    }
  }
  return out;
};

/** Exactly one <h1> in HTML shell (prerender). */
export const validateH1InShell = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    const count = (stripped.match(/<h1[\s>]/gi) || []).length;
    if (count !== 1) {
      out.push({
        code: 'html.h1_count',
        severity: 'error',
        message: `Exactly 1 <h1> required in HTML shell (got ${count})`,
        file: file.path,
      });
    }
  }
  return out;
};

/** color-scheme meta required for dark sites. */
export const validateColorScheme = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    // Attribute-order-robust: `<meta content="dark" name="color-scheme">` is valid
    // + present. The old /<meta\s+name=.../ required name to be the FIRST attribute
    // (same class as the metaDescLength apostrophe bug, iter 53).
    if (!/<meta\s+[^>]*\bname=["']color-scheme["']/i.test(file.text)) {
      out.push({
        code: 'meta.color_scheme_missing',
        severity: 'warn',
        message: 'Missing <meta name="color-scheme"> (use "dark" or "dark light")',
        file: file.path,
      });
    }
  }
  return out;
};

/**
 * Canonical integrity. Every indexable route HTML file must carry a
 * `<link rel="canonical">` (warn when absent), AND distinct routes must NOT
 * share one canonical href — the site-wide `canonical=/` collapse that de-dupes
 * every page to a single indexable URL (per `always.md` § Every page; reference
 * incident: njsk.org shipped `canonical=/` on all 32 routes). Non-route HTML
 * (offline / 404 / 500 / error shells) is excluded — those legitimately share
 * or omit a canonical and are not indexable targets.
 */
const NON_ROUTE_HTML = /(?:^|\/)(?:offline|404|500|error)\.html$/i;
const canonicalHref = (html: string): string | undefined => {
  const m =
    html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) ??
    html.match(/<link\s+[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["']/i);
  return m?.[1]?.trim() || undefined;
};
export const validateCanonical = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const byHref = new Map<string, string[]>();
  for (const file of files) {
    if (!isHtml(file.path) || !file.text || NON_ROUTE_HTML.test(file.path)) continue;
    const href = canonicalHref(file.text);
    if (!href) {
      out.push({
        code: 'meta.canonical_missing',
        severity: 'warn',
        message:
          'Missing <link rel="canonical"> — every indexable route needs a self-referencing canonical.',
        file: file.path,
      });
      continue;
    }
    byHref.set(href, [...(byHref.get(href) ?? []), file.path]);
  }
  // Collapse signature: ≥2 distinct route files sharing one canonical href.
  // Only meaningful for multi-route sites (a single page legitimately points
  // its lone canonical at itself).
  const routeCount = [...byHref.values()].reduce((n, list) => n + list.length, 0);
  if (routeCount > 1) {
    for (const [href, list] of byHref) {
      if (list.length < 2) continue;
      for (const path of list) {
        out.push({
          code: 'meta.canonical_collapsed',
          severity: 'error',
          message: `${list.length} routes share canonical "${href}" — each route must self-reference its own URL (site-wide canonical collapse).`,
          file: path,
        });
      }
    }
  }
  return out;
};

/**
 * Conversion-path integrity. A generated BUSINESS site must give visitors at
 * least ONE way to act on / contact the business somewhere across its routes —
 * a `tel:` / `mailto:` link, a `<form>`, or a contact / booking link
 * (`/contact`, `/book`, `/appointment`, `/schedule`, `/quote`, calendly,
 * cal.com, wa.me). A site with NO reachable contact affordance anywhere
 * converts $0 for the owner → the owner sees no ROI → churns (Retention).
 * Site-level warn (report mode): emit ONE violation only when the ENTIRE site
 * lacks any affordance — per-page would false-positive on `/about` etc.
 * Non-route shells (404 / 500 / offline) are excluded from the judgement.
 */
const CONTACT_AFFORDANCE =
  /href=["']\s*(?:tel:|mailto:)|<form[\s>]|href=["'][^"']*(?:\/contact|\/book|\/appointment|\/schedule|\/quote|calendly\.com|cal\.com|wa\.me)/i;
export const validateContactPath = (files: BuildFile[]): Violation[] => {
  const routeHtml = files.filter((f) => isHtml(f.path) && f.text && !NON_ROUTE_HTML.test(f.path));
  if (routeHtml.length === 0) return [];
  const hasAffordance = routeHtml.some((f) => CONTACT_AFFORDANCE.test(f.text!));
  if (hasAffordance) return [];
  return [
    {
      code: 'conversion.contact_path_missing',
      severity: 'warn',
      message:
        'No contact/conversion affordance found anywhere on the site (tel:/mailto:/<form>/contact|booking link) — visitors have no way to act, so the site converts $0 for the business owner.',
    },
  ];
};

/**
 * Per-route image-weight budget (CWV / LCP → conversion). A route whose total
 * referenced internal image bytes exceed the budget ships slow — high LCP, poor
 * mobile CWV — which measurably depresses conversion (a slow generated site
 * earns the owner fewer leads → lower ROI → churn). `validateImageFormat`
 * already flags a single oversized PNG; this catches the OTHER failure mode:
 * many individually-OK images that sum to a heavy page. Warn (report mode), per
 * route; non-route shells (404/500/offline) excluded. Budget per
 * `quality-metrics.md` (images ≤ 500KB total/route).
 */
const IMAGE_WEIGHT_BUDGET = 500 * 1024;
const isImageRef = (p: string) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(p);
export const validateImageWeightBudget = (files: BuildFile[]): Violation[] => {
  const sizeByPath = new Map(files.map((f) => [f.path, f.size]));
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text || NON_ROUTE_HTML.test(file.path)) continue;
    let total = 0;
    const seen = new Set<string>();
    for (const ref of collectRefs(file.text)) {
      if (!isInternalRef(ref) || !isImageRef(ref)) continue;
      const norm = normalizeRef(ref);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      total += sizeByPath.get(norm) ?? 0;
    }
    if (total > IMAGE_WEIGHT_BUDGET) {
      out.push({
        code: 'image.route_weight_over_budget',
        severity: 'warn',
        message: `Route images total ${Math.round(total / 1024)}KB (budget ${IMAGE_WEIGHT_BUDGET / 1024}KB) — heavy page → high LCP → lower conversion.`,
        file: file.path,
      });
    }
  }
  return out;
};

/** Sitemap — every <url> must have <lastmod>. */
export const validateSitemapLastmod = (files: BuildFile[]): Violation[] => {
  const sitemap = files.find((f) => f.path === 'sitemap.xml');
  if (!sitemap?.text)
    return [
      {
        code: 'sitemap.missing',
        severity: 'error',
        message: 'sitemap.xml not found in build output',
      },
    ];
  const urlBlocks = sitemap.text.match(/<url>[\s\S]*?<\/url>/g) || [];
  const out: Violation[] = [];
  for (const block of urlBlocks) {
    if (!/<lastmod>/i.test(block)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/);
      out.push({
        code: 'sitemap.missing_lastmod',
        severity: 'error',
        message: `<url> missing <lastmod>: ${loc ? loc[1] : 'unknown'}`,
        file: 'sitemap.xml',
      });
    }
  }
  return out;
};

/**
 * Sitemap ↔ build-routes drift guard (per `drift-detection.md § Build-artifact
 * drift guards`). `validateSitemapLastmod` proves the sitemap EXISTS + every
 * `<url>` has a `<lastmod>` — but NOT that each `<loc>` route actually has a page
 * in the build. A sitemap that lists `/services` when the build shipped no
 * `services.html` / `services/index.html` is worse than a plain 404: the SPA
 * fallback in `serveSiteFromR2` returns the HOMEPAGE shell with a **200** for any
 * sitemap-listed extensionless route (see the soft-404 guard there) → crawlers
 * follow the sitemap, get 200, and index DUPLICATE homepage content under that
 * URL (self-competing, crawl-budget waste). This flags every sitemap route with
 * no dedicated HTML file, mirroring `serveSiteFromR2`'s resolution order exactly
 * (`X/index.html` → `X.html` → flat `a-b.html` for `/a/b`).
 */
export const validateSitemapRoutesExist = (files: BuildFile[]): Violation[] => {
  const sitemap = files.find((f) => f.path === 'sitemap.xml');
  if (!sitemap?.text) return []; // validateSitemapLastmod owns the missing-sitemap error
  const htmlPaths = new Set(files.filter((f) => isHtml(f.path)).map((f) => f.path));
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const raw of sitemap.text.match(/<loc>[^<]+<\/loc>/g) ?? []) {
    const url = raw.replace(/<\/?loc>/g, '').trim();
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = url.startsWith('/') ? url : `/${url}`;
    }
    const route = pathname.replace(/\/+$/, '') || '/'; // strip trailing slash; '' → '/'
    if (seen.has(route)) continue;
    seen.add(route);
    // Candidate dist files that would serve this route (mirror serveSiteFromR2).
    const bare = route.replace(/^\//, '');
    const candidates =
      route === '/'
        ? ['index.html']
        : [`${bare}.html`, `${bare}/index.html`, `${bare.replace(/\//g, '-')}.html`];
    if (!candidates.some((c) => htmlPaths.has(c))) {
      out.push({
        code: 'sitemap.orphan_route',
        severity: 'error',
        message: `sitemap lists ${route} but the build has no page for it — the SPA fallback soft-404s it (200 homepage shell), so crawlers index duplicate homepage content under this URL`,
        file: 'sitemap.xml',
        detail: route,
      });
    }
  }
  return out;
};

/** Banned slop words anywhere in HTML body text. */
export const validateBannedWords = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    for (const word of BANNED_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = stripped.match(re);
      if (matches?.length) {
        out.push({
          code: 'copy.banned_word',
          severity: 'warn',
          message: `Banned slop word "${word}" appears ${matches.length}× — replace with concrete language`,
          file: file.path,
        });
      }
    }
  }
  return out;
};

/** JS code-splitting — no single chunk > 250KB gzipped (we proxy via raw size). */
/** Brand-placeholder leak — the template's shipped `{BUSINESS_NAME}` tokens
 * reached production twice (2026-08-19). LLM instructions cannot be trusted
 * for this; a hard BUILD-BREAKING gate is the only enforcement that works. */
/** Brand-name mismatch — the LLM has invented names in EVERY journey build
 * ("Hearth & Crumb", "Artisan Sourdough Bakery") despite the materialized
 * _brand.json. The title must CONTAIN the real business name (verbatim or
 * as a prefix). Only enforced when the caller passes `expectedBusinessName`. */
export const validateBrandNameMatch = (
  files: BuildFile[],
  expectedBusinessName?: string,
): Violation[] => {
  if (!expectedBusinessName) return [];
  const out: Violation[] = [];
  const expected = expectedBusinessName.trim();
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    const title = stripped.match(/<title>([^<]*)<\/title>/i);
    if (!title) continue;
    const t = title[1].trim();
    if (!t) continue;
    const norm = (x: string) =>
      x
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const tNorm = norm(t);
    const eNorm = norm(expected);
    // Accept verbatim containment OR the title STARTS with the expected name
    // (page titles like "Cedar Ridge Bakeshop — Menu").
    if (!tNorm.includes(eNorm) && !tNorm.startsWith(eNorm)) {
      out.push({
        code: 'brand.name_mismatch',
        severity: 'error',
        message: `Site title "${t}" does not contain the real business name "${expected}"`,
        file: file.path,
      });
    }

    // Canonical URL sanity — the journey shipped
    // https://urban-fitness..projectsites.dev/ (double dot from a template
    // token replaced with an already-suffixed slug).
    const canonical = stripped.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
    if (canonical) {
      const href = canonical[1];
      if (href.includes('..') || href.includes('{BUSINESS') || href.includes('undefined')) {
        out.push({
          code: 'brand.bad_canonical',
          severity: 'error',
          message: `Malformed canonical URL "${href}" — template token replacement produced a broken hostname`,
          file: file.path,
        });
      }
    }
  }
  return out;
};

export const validateNoBrandPlaceholders = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    for (const token of [
      '{BUSINESS_NAME}',
      '{BUSINESS_TAGLINE}',
      '{BUSINESS_SHORT_NAME}',
      '{BUSINESS_DESCRIPTION}',
    ]) {
      if (stripped.includes(token)) {
        out.push({
          code: 'brand.placeholder_leak',
          severity: 'error',
          message: `Brand placeholder "${token}" shipped to production — the container must use the materialized _brand.json`,
          file: file.path,
        });
      }
    }
    // Also catch the generic fallback in the title: the template defaults to
    // "Business" when _brand.json is missing/invalid.
    const title = stripped.match(/<title>([^<]*)<\/title>/i);
    if (title && /^Business\b/.test(title[1].trim())) {
      out.push({
        code: 'brand.generic_name',
        severity: 'error',
        message:
          'Site title starts with the generic "Business" fallback — _brand.json did not materialize',
        file: file.path,
      });
    }
  }
  return out;
};

export const validateJsBundleSize = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.js')) continue;
    if (file.size > 750 * 1024) {
      out.push({
        code: 'js.chunk_too_large',
        severity: 'error',
        message: `JS chunk > 750KB raw (~250KB gzipped): ${file.path} (${Math.round(file.size / 1024)}KB)`,
        file: file.path,
      });
    }
  }
  return out;
};

/** Lightbox presence — bundle must contain data-zoomable AND data-gallery markers. */
export const validateLightboxPresence = (files: BuildFile[]): Violation[] => {
  const jsFiles = files.filter((f) => f.path.toLowerCase().endsWith('.js') && f.text);
  if (!jsFiles.length) return [];
  const haystack = jsFiles.map((f) => f.text || '').join('\n');
  const hasZoomable = haystack.includes('data-zoomable');
  const hasGallery = haystack.includes('data-gallery');
  const out: Violation[] = [];
  if (!hasZoomable) {
    out.push({
      code: 'lightbox.zoomable_missing',
      severity: 'error',
      message: 'No data-zoomable string in JS bundle — lightbox component not shipping',
    });
  }
  if (!hasGallery) {
    out.push({
      code: 'lightbox.gallery_missing',
      severity: 'error',
      message: 'No data-gallery string in JS bundle — gallery wrappers/lightbox missing',
    });
  }
  return out;
};

/** Required well-known files. */
export const validateRequiredFiles = (files: BuildFile[]): Violation[] => {
  const required = [
    'site.webmanifest',
    'robots.txt',
    'humans.txt',
    'sitemap.xml',
    'browserconfig.xml',
    '.well-known/security.txt',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
  ];
  const set = new Set(files.map((f) => f.path));
  return required
    .filter((p) => !set.has(p))
    .map((p) => ({
      code: 'manifest.required_file_missing',
      severity: 'error' as Severity,
      message: `Required file missing: ${p}`,
    }));
};

/**
 * Fail builds that under-recreate the source sitemap.
 *
 * @remarks
 * Skill 15 mandates 1:N route mapping (max 1000) — never cap a 200-page source at 4–8.
 * `sourceRouteCount` comes from `_scraped_content.json.routes[].length` (priority chain:
 * sitemap.xml → wp-sitemap.xml → robots.txt Sitemap: → Wayback CDX → BFS depth ≤ 6).
 *
 * Floor: thin sources (< 4 routes) skip the check — the 4-page floor handles those.
 * Ceiling: sourceRouteCount > 1000 is clamped to 1000 (sanity cap).
 */
export const validateRouteCount = (files: BuildFile[], sourceRouteCount: number): Violation[] => {
  if (sourceRouteCount < 4) return [];
  const expected = Math.min(sourceRouteCount, 1000);
  const builtRoutes = files.filter(
    (f) =>
      f.path.endsWith('.html') &&
      !/(^|\/)(404|500|offline)\.html$/i.test(f.path) &&
      !f.path.startsWith('admin/'),
  );
  if (builtRoutes.length >= expected) return [];
  return [
    {
      code: 'route.count_below_source_count',
      severity: 'error' as Severity,
      message: `Built ${builtRoutes.length} HTML route(s); source has ${sourceRouteCount} (expected ≥ ${expected}). Skill 15 requires 1:N source-sitemap mapping up to 1000 — never cap at 4–8 pages.`,
      detail: `built=${builtRoutes.length} expected=${expected} source=${sourceRouteCount}`,
    },
  ];
};

/**
 * High-confidence, SERVER-ONLY secret patterns. Deliberately conservative
 * (false-negative over false-positive per validator-precision-discipline):
 * publishable/browser keys that are MEANT to be client-side — Stripe `pk_*`,
 * Google Maps/browser `AIza*` (referrer-restricted) — are intentionally absent.
 */
const CLIENT_SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Stripe secret key', re: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: 'Stripe restricted key', re: /rk_live_[A-Za-z0-9]{16,}/ },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'SendGrid API key', re: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/**
 * Scan client-served files (HTML / JS) for embedded server-only secrets — the
 * #1 vibe-coded-app vulnerability class (keys hardcoded in the bundle). Every
 * hit is an `error`: secrets belong in Workers Secrets, never the client bundle.
 * The detail is masked (first 8 + last 3 chars) so the validator never logs the
 * full secret.
 *
 * @param files - The build's files.
 * @returns One `security.client_secret_exposed` violation per offending file.
 * @example validateNoClientSecrets([{ path: 'app.js', text: 'const k="sk_live_abc…"', size: 30 }])
 */
export const validateNoClientSecrets = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const f of files) {
    if (!f.text || !/\.(?:html?|m?js)$/i.test(f.path)) continue;
    for (const { name, re } of CLIENT_SECRET_PATTERNS) {
      const m = re.exec(f.text);
      if (m) {
        const hit = m[0];
        out.push({
          code: 'security.client_secret_exposed',
          severity: 'error',
          message: `Possible ${name} embedded in a client-served file — secrets must stay server-side (Workers Secrets), never in the bundle.`,
          file: f.path,
          detail: `${hit.slice(0, 8)}…${hit.slice(-3)}`,
        });
        break; // one finding per file is enough to fail the gate
      }
    }
  }
  return out;
};

/** Run every gate and return a structured report. */
export const validateBuild = (
  files: BuildFile[],
  opts: { sourceRouteCount?: number; expectedBusinessName?: string } = {},
): ValidationReport => {
  const all: Violation[] = [
    ...validateRequiredFiles(files),
    ...validateAssetExistence(files),
    ...validateImageFormat(files),
    ...validateOgImage(files),
    ...validateAppleTouchIcon(files),
    ...validateMetaLengths(files),
    ...validateUniquePageTitles(files),
    ...validateJsonLdCount(files),
    ...validateJsonLdStructure(files),
    ...validateH1InShell(files),
    ...validateColorScheme(files),
    ...validateCanonical(files),
    ...validateSitemapLastmod(files),
    ...validateSitemapRoutesExist(files),
    ...validateBannedWords(files),
    ...validateNoBrandPlaceholders(files),
    ...validateBrandNameMatch(files, opts.expectedBusinessName),
    ...validateJsBundleSize(files),
    ...validateLightboxPresence(files),
    ...validateNoClientSecrets(files),
    ...validateContactPath(files),
    ...validateImageWeightBudget(files),
    ...(typeof opts.sourceRouteCount === 'number'
      ? validateRouteCount(files, opts.sourceRouteCount)
      : []),
  ];
  const errors = all.filter((v) => v.severity === 'error');
  const warnings = all.filter((v) => v.severity === 'warn');
  const infos = all.filter((v) => v.severity === 'info');
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    infos,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`,
  };
};

/**
 * Read every file under `prefix` from R2 into memory as BuildFile[].
 *
 * @remarks
 * Used by site-generation workflow after the container's HMAC callback confirms upload.
 * Decodes text-ish files (HTML/JS/CSS/JSON/XML/SVG/TXT) with TextDecoder; binary files
 * (PNG/JPG/WebP/etc.) are returned with `text: undefined` and only their byte size.
 */
export const loadBuildFromR2 = async (bucket: R2Bucket, prefix: string): Promise<BuildFile[]> => {
  const files: BuildFile[] = [];
  let cursor: string | undefined;
  const decoder = new TextDecoder();
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    cursor = list.truncated ? list.cursor : undefined;
    for (const obj of list.objects) {
      const path = obj.key.startsWith(prefix)
        ? obj.key.slice(prefix.length).replace(/^\/+/, '')
        : obj.key;
      const size = obj.size;
      let text: string | undefined;
      if (isText(path) && size < 1.5 * 1024 * 1024) {
        try {
          const got = await bucket.get(obj.key);
          if (got) {
            const buf = await got.arrayBuffer();
            text = decoder.decode(buf);
          }
        } catch {}
      }
      files.push({ path, size, text });
    }
  } while (cursor);
  return files;
};

/**
 * Deterministically repair the `..projectsites.dev` double-dot hostname in a
 * build's text files, returning the repaired copies.
 *
 * @remarks
 * The container's pre-build token pass substitutes raw {BUSINESS_*} tokens, but
 * the build LLM writes the canonical as `https://<slug>..projectsites.dev`
 * (slug already dot-suffixed in its model) DURING the build — after that pass
 * ran. This repair runs in finalize-build AFTER the container uploads, so the
 * gate sees the corrected text. Pure — does NOT mutate the input array.
 *
 * @param files - Build files loaded via {@link loadBuildFromR2}
 * @returns [repairedFiles, repairedCount]
 *
 * @example
 * const [fixed, n] = repairDoubleDotCanonical(await loadBuildFromR2(bucket, prefix));
 * if (n > 0) await bucket.put(`${prefix}index.html`, fixed.find(f => f.path === 'index.html')?.text ?? '');
 */
export const repairDoubleDotCanonical = (files: BuildFile[]): [BuildFile[], number] => {
  const BAD = '..projectsites.dev';
  let repaired = 0;
  const fixed = files.map((f) => {
    if (typeof f.text !== 'string' || !f.text.includes(BAD)) return f;
    repaired++;
    return { ...f, text: f.text.split(BAD).join('.projectsites.dev') };
  });
  return [fixed, repaired];
};
