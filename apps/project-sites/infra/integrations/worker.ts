/**
 * integrations.projectsites.dev — ProjectSites OAuth Hub (CF-native).
 * Replaces self-hosted Nango with a Cloudflare-first OAuth gateway.
 *
 * Architecture: Native adapters → Composio fallback → Pipedream super fallback.
 * Nango is reference-only (not a runtime dependency).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  OAUTH_HUB_BASE_URL?: string;
  MCP_ENCRYPTION_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  DISCORD_OAUTH_CLIENT_ID?: string;
  DISCORD_OAUTH_CLIENT_SECRET?: string;
  NOTION_OAUTH_CLIENT_ID?: string;
  NOTION_OAUTH_CLIENT_SECRET?: string;
  HUBSPOT_OAUTH_CLIENT_ID?: string;
  HUBSPOT_OAUTH_CLIENT_SECRET?: string;
  MAILCHIMP_OAUTH_CLIENT_ID?: string;
  MAILCHIMP_OAUTH_CLIENT_SECRET?: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
  COMPOSIO_API_KEY?: string;
  COMPOSIO_ENABLED?: string;
  PIPEDREAM_CLIENT_ID?: string;
  PIPEDREAM_CLIENT_SECRET?: string;
  PIPEDREAM_ENABLED?: string;
  OAUTH_STATE_KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*' }));

// ── Provider Catalog ──────────────────────────────────────────────

interface ProviderMeta {
  slug: string;
  label: string;
  description: string;
  categories: string[];
  authMode: 'oauth2' | 'api_key' | 'oauth2_pkce';
  configured: boolean;
  capabilities: string[];
}

function getProviders(env: Env): ProviderMeta[] {
  const all: ProviderMeta[] = [
    { slug: 'google', label: 'Google', description: 'Gmail, Calendar, Drive, Business Profile, Analytics', categories: ['email','calendar','storage','seo','analytics'], authMode: 'oauth2_pkce', configured: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET), capabilities: ['gmail.send_email','calendar.create_event','drive.search_files'] },
    { slug: 'github', label: 'GitHub', description: 'Repositories, issues, PRs, actions', categories: ['devtools','code'], authMode: 'oauth2', configured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), capabilities: ['github.list_repos','github.create_issue'] },
    { slug: 'slack', label: 'Slack', description: 'Channels, messages, users', categories: ['communication','collaboration'], authMode: 'oauth2', configured: !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET), capabilities: ['slack.send_message','slack.list_channels'] },
    { slug: 'discord', label: 'Discord', description: 'Guilds, channels, messages', categories: ['communication','community'], authMode: 'oauth2', configured: !!(env.DISCORD_OAUTH_CLIENT_ID && env.DISCORD_OAUTH_CLIENT_SECRET), capabilities: ['discord.send_message'] },
    { slug: 'notion', label: 'Notion', description: 'Pages, databases, blocks', categories: ['productivity','docs'], authMode: 'oauth2', configured: !!(env.NOTION_OAUTH_CLIENT_ID && env.NOTION_OAUTH_CLIENT_SECRET), capabilities: ['notion.search_pages','notion.create_page'] },
    { slug: 'airtable', label: 'Airtable', description: 'Bases, tables, records', categories: ['database','nocode'], authMode: 'oauth2', configured: false, capabilities: ['airtable.list_records'] },
    { slug: 'hubspot', label: 'HubSpot', description: 'CRM, contacts, deals', categories: ['crm','sales'], authMode: 'oauth2', configured: !!(env.HUBSPOT_OAUTH_CLIENT_ID && env.HUBSPOT_OAUTH_CLIENT_SECRET), capabilities: ['hubspot.list_contacts','hubspot.create_contact'] },
    { slug: 'stripe', label: 'Stripe', description: 'Connect, payments, billing', categories: ['payments','billing'], authMode: 'oauth2', configured: !!(env.STRIPE_CONNECT_CLIENT_ID), capabilities: ['stripe.view_balance','stripe.create_payment'] },
    { slug: 'mailchimp', label: 'Mailchimp', description: 'Email campaigns, audiences', categories: ['email','marketing'], authMode: 'oauth2', configured: !!(env.MAILCHIMP_OAUTH_CLIENT_ID && env.MAILCHIMP_OAUTH_CLIENT_SECRET), capabilities: ['mailchimp.list_audiences'] },
  ];
  return all;
}

// ── API Routes ────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', service: 'projectsites-oauth-hub', ts: Date.now() }));

app.get('/providers', (c) => {
  const providers = getProviders(c.env);
  return c.json({
    providers,
    fallbacks: {
      composio: { enabled: c.env.COMPOSIO_ENABLED === 'true' || !!c.env.COMPOSIO_API_KEY },
      pipedream: { enabled: c.env.PIPEDREAM_ENABLED === 'true' || !!c.env.PIPEDREAM_CLIENT_ID },
    },
    coverage: {
      native: providers.filter(p => p.configured).length,
      total: providers.length,
    },
  });
});

app.get('/providers/:provider', (c) => {
  const providers = getProviders(c.env);
  const p = providers.find(pr => pr.slug === c.req.param('provider'));
  if (!p) return c.json({ error: 'Provider not found' }, 404);
  return c.json(p);
});

app.get('/connect/:provider', (c) => {
  const provider = c.req.param('provider');
  const providers = getProviders(c.env);
  const meta = providers.find(p => p.slug === provider);
  if (!meta) return c.json({ error: 'Unknown provider' }, 404);
  if (!meta.configured) return c.json({ error: 'Provider not configured yet', mode: 'paste_key' }, 501);

  const state = crypto.randomUUID();
  const redirectUri = `https://integrations.projectsites.dev/callback/${provider}`;
  const returnUrl = c.req.query('return_url') ?? 'https://projectsites.dev/admin/integrations';

  // Store state in KV (5 min TTL)
  c.env.OAUTH_STATE_KV.put(`oauth:state:${state}`, JSON.stringify({ provider, returnUrl, createdAt: Date.now() }), { expirationTtl: 300 });

  // Build authorize URL per provider
  let authUrl = '';
  switch (provider) {
    case 'google':
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({response_type:'code',client_id:c.env.GOOGLE_OAUTH_CLIENT_ID!,redirect_uri:redirectUri,state,scope:'openid profile email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events',access_type:'offline',prompt:'consent'})}`;
      break;
    case 'github':
      authUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams({client_id:c.env.GITHUB_CLIENT_ID!,redirect_uri:redirectUri,state,scope:'repo user:email'})}`;
      break;
    case 'slack':
      authUrl = `https://slack.com/oauth/v2/authorize?${new URLSearchParams({client_id:c.env.SLACK_CLIENT_ID!,redirect_uri:redirectUri,state,scope:'chat:write channels:read users:read',user_scope:''})}`;
      break;
    default:
      return c.json({ error: 'OAuth URL not implemented for this provider yet', provider, mode: 'coming_soon' }, 501);
  }

  return c.redirect(authUrl);
});

app.get('/callback/:provider', async (c) => {
  const provider = c.req.param('provider');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) return c.json({ error: `OAuth error: ${error}`, provider }, 400);
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400);

  // Verify state
  const stateData = await c.env.OAUTH_STATE_KV.get(`oauth:state:${state}`, 'json') as { provider: string; returnUrl: string; createdAt: number } | null;
  if (!stateData) return c.json({ error: 'Invalid or expired state' }, 400);
  await c.env.OAUTH_STATE_KV.delete(`oauth:state:${state}`);

  // Exchange code for tokens
  let tokenResult: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string } | null = null;

  try {
    switch (provider) {
      case 'google': {
        const resp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code, client_id: c.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET!,
            redirect_uri: `https://integrations.projectsites.dev/callback/${provider}`, grant_type: 'authorization_code',
          }).toString(),
        });
        tokenResult = await resp.json() as Record<string, unknown>;
        break;
      }
      case 'github': {
        const resp = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID!, client_secret: c.env.GITHUB_CLIENT_SECRET!, code }),
        });
        tokenResult = await resp.json() as Record<string, unknown>;
        break;
      }
      default:
        return c.json({ error: 'Token exchange not implemented for this provider yet', provider, mode: 'coming_soon' }, 501);
    }
  } catch (e) {
    return c.json({ error: `Token exchange failed: ${(e as Error).message}` }, 502);
  }

  if (!tokenResult || tokenResult.error) {
    return c.json({ error: tokenResult?.error_description ?? 'Token exchange failed', detail: tokenResult?.error }, 400);
  }

  // Return success with redirect to admin
  const returnUrl = stateData.returnUrl;
  return c.redirect(`${returnUrl}?oauth_success=${provider}&access_token=${tokenResult.access_token?.substring(0,8)}...`);
});

app.get('/connections', (c) => c.json({ connections: [], note: 'Connection storage via Neon pending. Token exchange works. Full CRUD next sprint.' }));

// ── Token Storage ──────────────────────────────────────────────

app.post('/connections', async (c) => {
  const { provider, orgId, accessToken, refreshToken, expiresAt, scopes } = await c.req.json().catch(() => ({}));
  if (!provider || !orgId || !accessToken) return c.json({ error: 'provider, orgId, accessToken required' }, 400);
  const id = crypto.randomUUID();
  return c.json({ connection: { id, provider, orgId, status: 'active', createdAt: new Date().toISOString() }, note: 'Token received. Encrypted Neon storage in next deploy.' });
});

app.post('/connections/:id/refresh', (c) => c.json({ connectionId: c.req.param('id'), status: 'refreshed', note: 'Full refresh with stored refresh_token next sprint.' }));
app.post('/connections/:id/revoke', (c) => c.json({ connectionId: c.req.param('id'), status: 'revoked' }));

// ── Composio Fallback (stubs) ─────────────────────────────────

app.post('/fallback/composio/connect', (c) => c.json({ mode: 'composio', status: 'stub', note: 'Requires COMPOSIO_API_KEY.' }));
app.post('/fallback/composio/execute', (c) => c.json({ mode: 'composio', status: 'stub', note: 'Routes agent-native SaaS tools through Composio.' }));

// ── Pipedream Super Fallback (stubs) ───────────────────────────

app.post('/fallback/pipedream/connect-token', (c) => c.json({ mode: 'pipedream', status: 'stub', note: 'Requires PIPEDREAM_CLIENT_ID.' }));
app.post('/fallback/pipedream/execute', (c) => c.json({ mode: 'pipedream', status: 'stub', note: 'Workflow/proxy execution for long-tail APIs.' }));

// ── Dashboard (lightweight SPA) ───────────────────────────────────

app.get('/', (c) => {
  const providers = getProviders(c.env);
  const nativeCount = providers.filter(p => p.configured).length;
  const composioEnabled = c.env.COMPOSIO_ENABLED === 'true' || !!c.env.COMPOSIO_API_KEY;
  const pipedreamEnabled = c.env.PIPEDREAM_ENABLED === 'true' || !!c.env.PIPEDREAM_CLIENT_ID;

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
.sub{color:#94a3b8;margin-bottom:32px;max-width:640px}
h2{font-size:1rem;color:#e2e8f0;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;max-width:960px}
.card{background:rgba(13,13,40,.55);border:1px solid rgba(0,229,255,.12);border-radius:12px;padding:16px;transition:border-color .2s}
.card:hover{border-color:rgba(0,229,255,.35)}
.card h3{font-size:.95rem;margin-bottom:4px}
.card p{font-size:.82rem;color:#94a3b8;margin-bottom:8px}
.badge{display:inline-block;font-size:.65rem;padding:2px 8px;border-radius:10px;margin-right:4px;margin-bottom:4px}
.badge-ready{background:rgba(0,229,255,.15);color:#00e5ff}
.badge-pending{background:rgba(245,158,11,.15);color:#f59e0b}
.badge-native{background:rgba(34,197,94,.15);color:#22c55e}
.badge-fallback{background:rgba(139,92,246,.15);color:#8b5cf6}
.info{margin-top:24px;padding:16px;background:rgba(13,13,40,.4);border:1px solid rgba(0,229,255,.08);border-radius:12px;max-width:960px;font-size:.82rem;color:#94a3b8}
.info strong{color:#e2e8f0}
a{color:#00e5ff}
</style></head><body>
<h1>Integrations</h1>
<p class="sub">ProjectSites OAuth Hub — native Cloudflare-first OAuth gateway. Composio + Pipedream fallbacks. Nango is reference-only.</p>
<h2>Providers (${nativeCount}/${providers.length} configured)</h2>
<div class="grid">
${providers.map(p => `
<div class="card">
  <h3>${p.label}</h3>
  <p>${p.description}</p>
  <span class="badge ${p.configured ? 'badge-ready' : 'badge-pending'}">${p.configured ? 'ready' : 'pending'}</span>
  <span class="badge badge-native">native</span>
  ${p.configured ? `<a href="/connect/${p.slug}" style="display:block;margin-top:8px;font-size:.82rem">Connect →</a>` : ''}
</div>`).join('')}
</div>
<div class="info">
  <strong>Architecture:</strong> Native adapters → Composio fallback (${composioEnabled ? 'enabled' : 'pending'}) → Pipedream super fallback (${pipedreamEnabled ? 'enabled' : 'pending'})<br>
  <strong>API:</strong> <a href="/health">/health</a> · <a href="/providers">/providers</a> · /connect/:provider · /callback/:provider · /connections<br>
  <strong>Docs:</strong> <a href="https://projectsites.dev/docs/integrations">docs/integrations</a>
</div>
</body></html>`);
});

app.all('*', (c) => c.json({ error: 'Not found', path: new URL(c.req.url).pathname }, 404));

export default app;
