/**
 * Branded 200 status/landing pages for ProjectSites *system service* subdomains.
 *
 * @remarks
 * Hosts like `analytics.`, `billing.`, `api.`, `auth.`, `notify.`, `browser.`,
 * `traces.`, `app.`, `jobs.` are registry labels for bindings / managed SaaS /
 * internal services (see `platform/service-registry.ts`). They are matched by the
 * main worker's `*.projectsites.dev/*` wildcard but have no root page, so the bare
 * root used to fall through to the site-serving catch-all and return a 404.
 *
 * This module serves an honest, brand-styled `200` status page at the ROOT (`/`)
 * of each such host — "this is the X service, here's what it is + where the real
 * surface lives". It does NOT fake a backend: the API still lives at `/api/*`,
 * Stripe still hosts billing, Analytics Engine is still a binding. The page is a
 * monitoring-green status surface, not a counterfeit app.
 *
 * Hosts with a real served app are NOT here (handled elsewhere): `mail` (Listmonk
 * container), `llm` (gateway landing), `template`/`editor` (Pages proxies).
 */

/** One system service surfaced with a status page. */
interface SystemService {
  /** Single-label subdomain (no `.projectsites.dev`). */
  readonly sub: string;
  /** Human display name. */
  readonly name: string;
  /** One-sentence "what is this". */
  readonly what: string;
  /** Where the real surface lives (path, vendor, or "binding"). */
  readonly surface: string;
}

/** The registry of status-page system subdomains, keyed by single-label subdomain. */
export const SYSTEM_SERVICES: Readonly<Record<string, SystemService>> = {
  // EMPTIED 2026-06-25 per Brian: status-page shims are FALSE PASSES — a domain
  // must return 200 from its REAL app, not a crafted page. Each former entry now
  // resolves to its real backend (or an honest 404 until deployed):
  //   jobs  → falls through to the Inngest server (serve.ts routes jobs./events.)
  //   browser → Skyvern container (infra/skyvern, deploy pending) — 404 until live
  //   traces  → Langfuse container (deploy pending) — 404 until live
  //   auth/app → no standalone real app + not requested → honest 404
  // The map stays as the typed mechanism for any FUTURE genuinely-static landing;
  // it is intentionally empty so nothing shims a real surface.
};

/**
 * Resolve the {@link SystemService} for a full hostname, or `undefined` if the
 * host is not a status-page system subdomain.
 *
 * @param hostname - Full request host, e.g. `analytics.projectsites.dev`.
 * @returns the matching service, or `undefined`.
 * @example resolveSystemService('api.projectsites.dev')?.name // 'API Gateway'
 */
export function resolveSystemService(hostname: string): SystemService | undefined {
  const h = hostname.toLowerCase();
  const suffix = '.projectsites.dev';
  if (!h.endsWith(suffix)) return undefined;
  const sub = h.slice(0, -suffix.length);
  return SYSTEM_SERVICES[sub];
}

/**
 * Render the full branded HTML status page for a system service.
 *
 * @param svc - The service to render.
 * @returns a complete, self-contained HTML document string.
 * @example systemServiceLanding(SYSTEM_SERVICES.api) // '<!DOCTYPE html>...'
 */
export function systemServiceLanding(svc: SystemService): string {
  const host = `${svc.sub}.projectsites.dev`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${svc.name} · ProjectSites</title>
<meta name="description" content="${svc.what}">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="https://${host}/">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.6;
    display:flex;align-items:center;justify-content:center;padding:40px 20px;
    background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
  .wrap{max-width:600px;width:100%}
  .status{display:inline-flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:.72rem;
    letter-spacing:.18em;text-transform:uppercase;color:#7ee787;margin-bottom:18px}
  .dot{width:8px;height:8px;border-radius:50%;background:#7ee787;box-shadow:0 0 10px #7ee787}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:#00e5ff;margin-bottom:12px}
  h1{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-bottom:14px;
    background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{color:#94a3b8;font-size:1.05rem;margin-bottom:26px}
  .card{background:linear-gradient(145deg,rgba(13,13,40,.55),rgba(8,8,32,.7));border:1px solid rgba(0,229,255,.12);
    border-radius:16px;padding:18px 20px;margin-bottom:14px}
  .card h2{font-size:.72rem;font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
  .card p{color:#cbd5e1;font-size:.95rem}
  .host{font-family:'JetBrains Mono',monospace;color:#00e5ff;font-size:.82rem}
  a{color:#00e5ff;text-decoration:none}a:hover{text-decoration:underline}
  .foot{margin-top:24px;font-size:.82rem;color:#6b7785}
</style></head><body><div class="wrap">
  <div class="status"><span class="dot"></span>Operational</div>
  <div class="eyebrow">ProjectSites · System Service</div>
  <h1>${svc.name}</h1>
  <p class="sub">${svc.what}</p>
  <div class="card"><h2>Where it runs</h2><p>${svc.surface}</p></div>
  <div class="card"><h2>Host</h2><p class="host">${host}</p></div>
  <p class="foot">&larr; <a href="https://projectsites.dev/">projectsites.dev</a></p>
</div></body></html>`;
}
