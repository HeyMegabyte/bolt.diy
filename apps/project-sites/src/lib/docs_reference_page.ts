/**
 * @module lib/docs_reference_page
 *
 * @description
 * Server-rendered shell for `docs.projectsites.dev` — an interactive API reference
 * powered by Scalar, bound to the canonical, Zod-derived OpenAPI document already
 * served at `https://projectsites.dev/api/openapi.json` (the SSOT; no second spec
 * to maintain). Scalar loads from CDN; this host falls in the worker's permissive
 * "served-site" CSP branch (`default-src *`), so the CDN script + spec fetch are
 * allowed. Stainless SDK generation is a separable later step (LOOP-DOCS).
 *
 * @see src/routes/openapi.ts — GET /api/openapi.json (the spec this renders)
 * @see src/platform/openapi.ts — buildOpenApiDocument()
 */

/** The canonical machine-readable spec URL the reference renders. */
export const OPENAPI_SPEC_URL = 'https://projectsites.dev/api/openapi.json';

/**
 * Render the Scalar API-reference HTML shell.
 *
 * @returns A complete HTML document embedding the live OpenAPI spec.
 *
 * @example
 * ```ts
 * if (hostname === `docs.${DOMAINS.SITES_BASE}`) return c.html(renderDocsReferencePage());
 * ```
 */
export function renderDocsReferencePage(): string {
  const config = {
    theme: 'purple',
    darkMode: true,
    hideDownloadButton: false,
    metaData: {
      title: 'ProjectSites API Reference',
      description: 'The ProjectSites.dev developer API — keys, sites, billing, webhooks.',
    },
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProjectSites API Reference</title>
<meta name="description" content="Interactive API reference for the ProjectSites.dev developer platform.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="https://projectsites.dev/favicon.ico">
<style>
  body{margin:0;background:#060610}
  .ps-fallback{font-family:system-ui,sans-serif;color:#8892a4;max-width:640px;margin:4rem auto;padding:0 1.5rem;line-height:1.6}
  .ps-fallback a{color:#00E5FF}
</style>
</head>
<body>
  <noscript>
    <div class="ps-fallback">
      <h1>ProjectSites API Reference</h1>
      <p>This interactive reference needs JavaScript. The raw machine-readable spec is always available at
      <a href="${OPENAPI_SPEC_URL}">${OPENAPI_SPEC_URL}</a>.</p>
    </div>
  </noscript>
  <script id="api-reference" data-url="${OPENAPI_SPEC_URL}"></script>
  <script>
    document.getElementById('api-reference').dataset.configuration = ${JSON.stringify(JSON.stringify(config))};
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
}
