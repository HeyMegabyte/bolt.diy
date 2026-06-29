/**
 * @module lib/status_page
 *
 * @description
 * Server-rendered public status page for `status.projectsites.dev`. Incident-driven
 * (Statuspage-style): the overall banner is derived from open incidents in D1 via
 * {@link getStatusFeed}; with no open incidents the platform reads "All Systems
 * Operational". Self-contained HTML/CSS — zero external scripts or fetches, so it
 * renders under any CSP and never depends on a CDN being up while reporting uptime.
 *
 * Per-component live `/health` probing is a deliberate follow-up (LOOP-STATUS) —
 * v1 mirrors how real status pages work: operators publish incidents, the page
 * reflects them. Brand-locked (#060610 / #00E5FF / Space Grotesk).
 *
 * @see libs/features/status_page_live/service.ts — getStatusFeed (the data source)
 */

import type { OverallStatus, StatusIncident } from '../../libs/features/status_page_live/schemas.js';

/** A customer-facing service plane shown in the component grid. */
interface Component {
  readonly name: string;
  readonly desc: string;
}

/**
 * The customer-facing service planes listed on the status page. These are the
 * surfaces a ProjectSites customer cares about — not every internal subsystem.
 */
const COMPONENTS: readonly Component[] = [
  { name: 'Website Builder & Hosting', desc: 'AI site generation, publishing, custom domains' },
  { name: 'Developer API', desc: 'api.projectsites.dev — keys, quotas, REST access' },
  { name: 'Authentication', desc: 'auth.projectsites.dev — login, passkeys, orgs' },
  { name: 'Billing', desc: 'billing.projectsites.dev — checkout, subscriptions, metering' },
  { name: 'Email', desc: 'mail.projectsites.dev — newsletters & transactional' },
  { name: 'CRM', desc: 'crm.projectsites.dev — contacts, pipeline' },
  { name: 'Social Publishing', desc: 'social.projectsites.dev — scheduling & posting' },
  { name: 'AI Gateway', desc: 'llm.projectsites.dev — model routing & inference' },
  { name: 'Background Jobs', desc: 'jobs.projectsites.dev — workflows & queues' },
  { name: 'Browser Automation', desc: 'browser.projectsites.dev — screenshots & crawling' },
  { name: 'Webhooks', desc: 'webhooks.projectsites.dev — inbound & outbound delivery' },
  { name: 'Analytics', desc: 'analytics.projectsites.dev — product analytics' },
];

/** Display metadata per overall-status value. */
const STATUS_META: Record<OverallStatus, { label: string; color: string; glyph: string }> = {
  operational: { label: 'All Systems Operational', color: '#00E5FF', glyph: '✓' },
  degraded: { label: 'Degraded Performance', color: '#f5a623', glyph: '!' },
  outage: { label: 'Service Outage', color: '#ff4d6d', glyph: '✕' },
};

/** Per-incident-severity accent colour. */
const SEVERITY_COLOR: Record<string, string> = {
  minor: '#f5a623',
  major: '#f5a623',
  critical: '#ff4d6d',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  // Defensive: never throw on a malformed timestamp.
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  return new Date(t).toUTCString();
}

/**
 * Render the full public status page.
 *
 * @param overall - Platform-wide status derived from open incidents.
 * @param incidents - Open incidents, most-recent first.
 * @returns A complete, self-contained HTML document.
 *
 * @example
 * ```ts
 * const { status, incidents } = await getStatusFeed(c.env);
 * return c.html(renderStatusPage(status, incidents));
 * ```
 */
export function renderStatusPage(overall: OverallStatus, incidents: readonly StatusIncident[]): string {
  const meta = STATUS_META[overall] ?? STATUS_META.operational;
  // A component reads "operational" unless the platform overall is impacted; v1
  // has no per-component incident mapping, so degraded/outage colours the grid.
  const compColor = overall === 'operational' ? '#00E5FF' : meta.color;
  const compLabel = overall === 'operational' ? 'Operational' : meta.label;

  const componentRows = COMPONENTS.map(
    (cp) => `
      <li class="cmp">
        <div class="cmp-main">
          <span class="cmp-name">${esc(cp.name)}</span>
          <span class="cmp-desc">${esc(cp.desc)}</span>
        </div>
        <span class="cmp-state" style="color:${compColor}">
          <span class="cmp-dot" style="background:${compColor}"></span>${esc(compLabel)}
        </span>
      </li>`,
  ).join('');

  const incidentsSection =
    incidents.length === 0
      ? `<p class="no-incidents">No incidents reported. All clear.</p>`
      : incidents
          .map(
            (inc) => `
        <div class="incident" style="border-left-color:${SEVERITY_COLOR[inc.severity] ?? '#f5a623'}">
          <div class="incident-head">
            <span class="incident-sev" style="color:${SEVERITY_COLOR[inc.severity] ?? '#f5a623'}">${esc(
              inc.severity,
            )}</span>
            <span class="incident-title">${esc(inc.title)}</span>
          </div>
          <p class="incident-msg">${esc(inc.message)}</p>
          <time class="incident-time">${fmtDate(inc.createdAt)}</time>
        </div>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.label)} · ProjectSites Status</title>
<meta name="description" content="Real-time operational status for the ProjectSites.dev platform.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="https://projectsites.dev/favicon.ico">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  :root{--bg:#060610;--ink:#e6ebf2;--muted:#8892a4;--accent:#00E5FF;--card:rgba(255,255,255,.03);--line:rgba(0,229,255,.12)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.5;padding:2rem 1.25rem;min-height:100vh}
  .wrap{max-width:760px;margin:0 auto}
  header{display:flex;align-items:center;gap:.6rem;margin-bottom:2.5rem}
  .logo{font-weight:700;font-size:1.05rem;letter-spacing:.02em}
  .logo b{background:linear-gradient(135deg,#00E5FF,#7C3AED);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .banner{display:flex;align-items:center;gap:1rem;padding:1.5rem 1.75rem;border-radius:16px;background:var(--card);border:1px solid var(--line);margin-bottom:2.5rem}
  .banner .glyph{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;font-weight:700;font-size:1.3rem;flex:0 0 auto}
  .banner h1{font-size:1.5rem;font-weight:600;line-height:1.2}
  .banner .sub{color:var(--muted);font-size:.9rem;margin-top:.15rem}
  h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0 0 1rem .25rem;font-weight:600}
  ul{list-style:none}
  .cmp{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;background:var(--card);border:1px solid rgba(255,255,255,.05);border-radius:12px;margin-bottom:.6rem}
  .cmp-name{display:block;font-weight:500}
  .cmp-desc{display:block;color:var(--muted);font-size:.8rem;margin-top:.1rem}
  .cmp-state{display:inline-flex;align-items:center;gap:.5rem;font-size:.85rem;font-weight:500;white-space:nowrap}
  .cmp-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 8px currentColor}
  .incidents{margin-top:2.5rem}
  .no-incidents{color:var(--muted);background:var(--card);border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:1.25rem;font-size:.9rem}
  .incident{background:var(--card);border:1px solid rgba(255,255,255,.05);border-left:3px solid;border-radius:10px;padding:1rem 1.25rem;margin-bottom:.75rem}
  .incident-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem}
  .incident-sev{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
  .incident-title{font-weight:600}
  .incident-msg{color:var(--muted);font-size:.9rem}
  .incident-time{display:block;margin-top:.5rem;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--muted)}
  footer{margin-top:3rem;text-align:center;color:var(--muted);font-size:.78rem}
  footer a{color:var(--accent);text-decoration:none}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <span class="logo"><b>ProjectSites</b> Status</span>
    </header>
    <div class="banner">
      <span class="glyph" style="color:${meta.color};background:${meta.color}1a;border:1px solid ${meta.color}40">${meta.glyph}</span>
      <div>
        <h1>${esc(meta.label)}</h1>
        <div class="sub">Live operational status · ${fmtDate(new Date().toISOString())}</div>
      </div>
    </div>
    <h2>Components</h2>
    <ul>${componentRows}</ul>
    <div class="incidents">
      <h2>Active Incidents</h2>
      ${incidentsSection}
    </div>
    <footer>
      Powered by <a href="https://projectsites.dev">ProjectSites.dev</a> · We don't sell websites. We deliver them.
    </footer>
  </div>
</body>
</html>`;
}
