import { Container, getContainer } from '@cloudflare/containers';

/**
 * integrations.projectsites.dev — Nango (unified OAuth/integrations) on CF
 * Workers Containers. Stateless container; data in Neon Postgres. Mirrors
 * infra/listmonk. Server (dashboard + API) on :3003.
 */
interface Env {
  NANGO_CONTAINER: DurableObjectNamespace<Nango>;
  NANGO_DATABASE_URL: string;
  NANGO_ENCRYPTION_KEY: string;
}

export class Nango extends Container<Env> {
  defaultPort = 3003;
  sleepAfter = '15m';
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NANGO_DATABASE_URL: env.NANGO_DATABASE_URL,
      NANGO_ENCRYPTION_KEY: env.NANGO_ENCRYPTION_KEY,
      NANGO_SERVER_URL: 'https://integrations.projectsites.dev',
      SERVER_PORT: '3003',
      NODE_ENV: 'production',
      TELEMETRY: 'false',
    };
  }
}

/**
 * Branded 200 landing page shown when the Nango container is not yet running.
 * Matches the ProjectSites brand: dark-first, cyan accent, Space Grotesk font.
 */
function landingPage(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrations · ProjectSites</title>
<meta name="description" content="OAuth connection hub for ProjectSites — third-party integrations powered by Nango.">
<meta name="color-scheme" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.6;display:flex;align-items:center;justify-content:center;padding:40px 20px;
  background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
.wrap{max-width:640px;width:100%}
.status{display:inline-flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:.7rem;
  letter-spacing:.18em;text-transform:uppercase;color:#f59e0b;margin-bottom:18px}
.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 10px #f59e0b;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:#00e5ff;margin-bottom:12px}
h1{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-bottom:14px;
  background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#94a3b8;font-size:1.05rem;margin-bottom:26px}
.card{background:linear-gradient(145deg,rgba(13,13,40,.55),rgba(8,8,32,.7));border:1px solid rgba(0,229,255,.12);
  border-radius:16px;padding:18px 20px;margin-bottom:14px}
.card h2{font-size:.7rem;font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.card p{color:#cbd5e1;font-size:.95rem}.card code{color:#00e5ff;font-family:'JetBrains Mono',monospace;font-size:.82rem}
.host{font-family:'JetBrains Mono',monospace;color:#00e5ff;font-size:.82rem}
a{color:#00e5ff;text-decoration:none}a:hover{text-decoration:underline}
.foot{margin-top:24px;font-size:.82rem;color:#6b7785;text-align:center}
</style></head><body><div class="wrap">
<div class="status"><span class="dot"></span>Provisioning</div>
<div class="eyebrow">ProjectSites · OAuth Integrations Hub</div>
<h1>Integrations</h1>
<p class="sub">Third-party OAuth connections for your ProjectSites accounts, sites, and tools. Uses Nango for unified provider management.</p>
<div class="card"><h2>Powered by</h2><p>Nango (<code class="host">nangohq/nango-server</code>) — open-source unified OAuth gateway. Wraps 200+ provider APIs into a single refresh-token surface.</p></div>
<div class="card"><h2>What Lives Here</h2><p>The Nango container handles OAuth token exchange, refresh, and provider-API proxy for connected services: Mailchimp, HubSpot, GitHub, Slack, Notion, Linear, Discord, Google Calendar, and Calendly.</p></div>
<div class="card"><h2>Status</h2><p>The container is provisioning. This page will automatically serve the Nango dashboard once the container is built and running.</p></div>
<p class="foot">&larr; <a href="https://projectsites.dev/">projectsites.dev</a> · <a href="https://nango.dev">nango.dev</a></p>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (!env.NANGO_CONTAINER) return landingPage();
      return await getContainer(env.NANGO_CONTAINER, 'singleton').fetch(request);
    } catch {
      return landingPage();
    }
  },
};
