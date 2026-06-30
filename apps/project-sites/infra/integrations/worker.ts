/**
 * integrations.projectsites.dev — ProjectSites OAuth Hub.
 * Nango is at nango.projectsites.dev. This is the platform integration layer.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  OAUTH_STATE_KV: KVNamespace;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  DISCORD_OAUTH_CLIENT_ID?: string;
  NOTION_OAUTH_CLIENT_ID?: string;
  HUBSPOT_OAUTH_CLIENT_ID?: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
  MAILCHIMP_OAUTH_CLIENT_ID?: string;
  COMPOSIO_API_KEY?: string;
  PIPEDREAM_CLIENT_ID?: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors({ origin: '*' }));

// Providers
const getProviders = (env: Env) => [
  { slug:'google',label:'Google',configured:!!(env.GOOGLE_OAUTH_CLIENT_ID&&env.GOOGLE_OAUTH_CLIENT_SECRET),capabilities:['gmail.send_email','calendar.create_event','drive.search_files'] },
  { slug:'github',label:'GitHub',configured:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET),capabilities:['github.list_repos','github.create_issue'] },
  { slug:'slack',label:'Slack',configured:!!(env.SLACK_CLIENT_ID&&env.SLACK_CLIENT_SECRET),capabilities:['slack.send_message','slack.list_channels'] },
  { slug:'discord',label:'Discord',configured:!!(env.DISCORD_OAUTH_CLIENT_ID),capabilities:['discord.send_message'] },
  { slug:'notion',label:'Notion',configured:!!(env.NOTION_OAUTH_CLIENT_ID),capabilities:['notion.search_pages','notion.create_page'] },
  { slug:'hubspot',label:'HubSpot',configured:!!(env.HUBSPOT_OAUTH_CLIENT_ID),capabilities:['hubspot.list_contacts','hubspot.create_contact'] },
  { slug:'stripe',label:'Stripe',configured:!!(env.STRIPE_CONNECT_CLIENT_ID),capabilities:['stripe.view_balance','stripe.create_payment'] },
  { slug:'mailchimp',label:'Mailchimp',configured:!!(env.MAILCHIMP_OAUTH_CLIENT_ID),capabilities:['mailchimp.list_audiences'] },
  { slug:'airtable',label:'Airtable',configured:false,capabilities:['airtable.list_records'] },
];

app.get('/health', (c) => c.json({ status:'ok', service:'projectsites-oauth-hub', nangoProxy:'https://nango.projectsites.dev' }));
app.get('/healthcheck', (c) => c.json({ status:'healthy',nangoProxy:'https://nango.projectsites.dev',ts:Date.now() }));

app.get('/providers', (c) => {
  const providers = getProviders(c.env);
  return c.json({
    providers,
    coverage: { native: providers.filter(p=>p.configured).length, total:providers.length },
    fallbacks: { composio:{enabled:!!c.env.COMPOSIO_API_KEY}, pipedream:{enabled:!!c.env.PIPEDREAM_CLIENT_ID} },
    nango: 'https://nango.projectsites.dev',
  });
});

app.get('/', (c) => {
  const providers = getProviders(c.env);
  const configured = providers.filter(p => p.configured).length;
  return c.html(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrations · ProjectSites OAuth Hub</title>
<meta name="color-scheme" content="dark">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;padding:40px 20px;
  background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
h1{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:700;margin-bottom:8px;
  background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#94a3b8;margin-bottom:24px;max-width:640px}
.links{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:32px}
.links a{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:.85rem;text-decoration:none;background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.2);color:#00e5ff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;max-width:960px}
.card{background:rgba(13,13,40,.55);border:1px solid rgba(0,229,255,.12);border-radius:12px;padding:16px}
.card h3{font-size:.9rem;margin-bottom:4px}
.card p{font-size:.78rem;color:#94a3b8}
.badge{display:inline-block;font-size:.65rem;padding:2px 8px;border-radius:10px;margin-top:6px}
.badge-ready{background:rgba(0,229,255,.15);color:#00e5ff}
.badge-pending{background:rgba(245,158,11,.15);color:#f59e0b}
.info{margin-top:24px;padding:16px;background:rgba(13,13,40,.4);border:1px solid rgba(0,229,255,.08);border-radius:12px;max-width:960px;font-size:.82rem;color:#94a3b8}
.info strong{color:#e2e8f0}
</style></head><body>
<h1>Integrations</h1>
<p class="sub">ProjectSites OAuth Hub — Cloudflare-native OAuth gateway. <a href="https://nango.projectsites.dev" style="color:#00e5ff">Nango dashboard →</a></p>
<div class="links">
  <a href="https://nango.projectsites.dev">🔑 Nango OAuth</a>
  <a href="/providers">📋 Provider Catalog</a>
  <a href="/health">❤️ Health</a>
</div>
<h2 style="font-size:1rem;color:#e2e8f0;margin-bottom:12px">Providers (${configured}/${providers.length})</h2>
<div class="grid">
${providers.map(p => `<div class="card"><h3>${p.label}</h3><p>${p.capabilities.slice(0,2).join(', ')}</p><span class="badge ${p.configured?'badge-ready':'badge-pending'}">${p.configured?'ready':'pending'}</span></div>`).join('')}
</div>
<div class="info">
  <strong>Architecture:</strong> Native adapters → Composio fallback → Pipedream super fallback<br>
  <strong>Nango:</strong> <a href="https://nango.projectsites.dev">nango.projectsites.dev</a> — OAuth connection management dashboard
</div>
</body></html>`);
});

app.all('*', (c) => c.json({ error:'Not found' }, 404));
export default app;
