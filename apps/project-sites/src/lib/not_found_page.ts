/**
 * @module lib/not_found_page
 *
 * Accessible HTML body for the worker's global `app.notFound()` handler.
 *
 * Hono's default `c.notFound()` emits a bare `text/plain` "404 Not Found" with
 * no `<title>` and no `<html lang>`, which fails axe `document-title` +
 * `html-has-lang` (surfaced on `/changelog` when its `public_changelog` flag is
 * off). This renders a small, on-brand, accessible 404 page instead: one `<h1>`,
 * a `<main>` landmark, `<html lang="en">`, a real `<title>`, and a home link
 * that is distinguishable by more than colour (underlined — avoids
 * `link-in-text-block`).
 *
 * @returns Full HTML document string for a 404 response.
 * @example
 * ```ts
 * app.notFound((c) => c.html(notFoundHtml(), 404));
 * ```
 */
export function notFoundHtml(): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Not Found · ProjectSites</title><meta name="color-scheme" content="dark">` +
    `<style>html,body{margin:0;background:#060610;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}` +
    `main{max-width:560px;margin:0 auto;padding:80px 24px;text-align:center}` +
    `h1{font-size:40px;margin:0 0 12px}p{color:#94a3b8;font-size:16px;line-height:1.6;margin:0 0 24px}` +
    `a{color:#00e5ff;text-decoration:underline;font-weight:600}</style></head>` +
    `<body><main><h1>404 — Not found</h1>` +
    `<p>The page you requested doesn't exist or isn't available.</p>` +
    `<a href="https://projectsites.dev/">Back to projectsites.dev</a></main></body></html>`
  );
}
