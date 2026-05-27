/**
 * Branded error pages — gorgeous animated HTML for browsers, JSON for API/Accept.
 *
 * @remarks
 *  Per Brian's preference: never show raw stack traces to humans, but DO surface
 *  the requestId + correlation hash so the user can paste it to support.
 *  Includes Fira Code debug block for developer-tools-friendly diagnostics.
 *
 * @example
 *   return renderErrorPage(c, { status: 404, code: 'NOT_FOUND', title: 'Page not found' });
 */
import type { Context } from 'hono';
import type { AppContext } from '../env';

export interface ErrorPageOptions {
  status: 400 | 401 | 403 | 404 | 500 | 503;
  code: string;
  title: string;
  detail?: string;
}

const STATUS_COPY: Record<number, { title: string; tagline: string }> = {
  400: { title: 'Bad request', tagline: 'Something in that request was malformed.' },
  401: { title: 'Sign in to continue', tagline: 'This page needs you signed in.' },
  403: { title: 'Forbidden', tagline: "You don't have permission for that." },
  404: { title: 'Page not found', tagline: "We couldn't find that page." },
  500: { title: 'Server error', tagline: 'Something broke on our end.' },
  503: { title: 'Service unavailable', tagline: "We're catching our breath." },
};

export function renderErrorPage(c: Context<AppContext>, opts: ErrorPageOptions): Response {
  const accept = c.req.header('accept') ?? '';
  const wantsJson = accept.includes('application/json') || c.req.path.startsWith('/api/');
  const requestId = c.var.requestId ?? crypto.randomUUID();
  if (wantsJson) {
    return new Response(
      JSON.stringify({
        type: `https://projectsites.dev/errors/${opts.code}`,
        title: opts.title,
        status: opts.status,
        detail: opts.detail ?? STATUS_COPY[opts.status]?.tagline,
        instance: c.req.path,
        requestId,
        tenant: c.env.TENANT_SLUG,
      }),
      {
        status: opts.status,
        headers: { 'content-type': 'application/problem+json; charset=utf-8' },
      },
    );
  }
  const copy = STATUS_COPY[opts.status];
  const html = errorHtml({
    status: opts.status,
    code: opts.code,
    title: opts.title || copy.title,
    detail: opts.detail || copy.tagline,
    requestId,
    tenantName: c.env.TENANT_NAME,
    primaryHostname: c.env.PRIMARY_HOSTNAME,
  });
  return new Response(html, {
    status: opts.status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

interface RenderArgs {
  status: number;
  code: string;
  title: string;
  detail: string;
  requestId: string;
  tenantName: string;
  primaryHostname: string;
}

function errorHtml(a: RenderArgs): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${a.status} · ${escapeHtml(a.title)} · ${escapeHtml(a.tenantName)}</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; --bg: #060610; --ink: #f4f4ff; --accent: #00e5ff; --muted: rgba(244,244,255,0.55); }
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif; min-height: 100vh; }
  main { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }
  .card { max-width: 38rem; text-align: center; }
  .status { font: 600 clamp(4rem, 14vw, 9rem)/1 'Sora', sans-serif; letter-spacing: -0.04em;
            background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%); -webkit-background-clip: text;
            background-clip: text; color: transparent; animation: drift 8s ease-in-out infinite alternate; }
  h1 { font-size: clamp(1.5rem, 3vw, 2rem); margin: 1rem 0 0.5rem; text-wrap: balance; }
  p { color: var(--muted); line-height: 1.6; text-wrap: pretty; }
  .req { font-family: 'Fira Code', 'JetBrains Mono', ui-monospace, monospace; font-size: 0.75rem; opacity: 0.65; margin-top: 1.5rem; word-break: break-all; }
  a.home { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; border: 1px solid var(--accent);
           color: var(--accent); text-decoration: none; border-radius: 0.5rem; transition: all 200ms; }
  a.home:hover { background: var(--accent); color: var(--bg); }
  @keyframes drift { from { transform: translateY(0); } to { transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) { .status { animation: none; } }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="status">${a.status}</div>
    <h1>${escapeHtml(a.title)}</h1>
    <p>${escapeHtml(a.detail)}</p>
    <a class="home" href="/">Back to ${escapeHtml(a.tenantName)}</a>
    <div class="req">${escapeHtml(a.code)} · request ${escapeHtml(a.requestId)}</div>
  </div>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
