/**
 * auth.projectsites.dev — self-hosted Better Auth (OIDC IdP) on a Cloudflare Worker + D1.
 *
 * CF-native: no container, no Neon, no Docker, no cold-boot. Better Auth runs directly in
 * the Worker with the `oidcProvider` plugin (a real OIDC IdP), backed by D1 via the Kysely
 * D1 dialect. The main app's IdentityProvider port (services/better_auth_provider.ts,
 * ADR-0006) points at `/api/auth/oauth2/*`. Schema is applied to D1 once per isolate via
 * Better Auth's getMigrations (CREATE TABLE — D1-compatible); re-runs are caught + ignored.
 *
 * Login screen: `/` 302s to `/sign-in`, a 200 HTML form. `/health` → { ok: true }.
 */
import { betterAuth } from 'better-auth';
import { oidcProvider } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { Hono } from 'hono';

interface Env {
  /** D1 database holding Better Auth's tables. */
  DB: D1Database;
  /** 32+ byte secret for session/token signing. */
  BETTER_AUTH_SECRET: string;
  /** First-party OIDC client the ProjectSites worker authenticates as. */
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  OIDC_REDIRECT_URLS?: string;
  /** Second trusted OIDC client: Listmonk (mail.projectsites.dev) SSO. */
  LISTMONK_OIDC_CLIENT_ID?: string;
  LISTMONK_OIDC_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

type Auth = ReturnType<typeof betterAuth>;

function buildAuth(env: Env): Auth {
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });
  const trustedClients = [
    {
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      name: 'ProjectSites',
      type: 'web' as const,
      redirectURLs: (env.OIDC_REDIRECT_URLS ?? 'https://projectsites.dev/api/auth/betterauth/callback').split(','),
      disabled: false,
      skipConsent: true,
      metadata: {},
    },
  ];
  // Listmonk (mail.projectsites.dev) SSO — added when its client creds are provisioned.
  if (env.LISTMONK_OIDC_CLIENT_ID && env.LISTMONK_OIDC_CLIENT_SECRET) {
    trustedClients.push({
      clientId: env.LISTMONK_OIDC_CLIENT_ID,
      clientSecret: env.LISTMONK_OIDC_CLIENT_SECRET,
      name: 'Listmonk',
      type: 'web' as const,
      redirectURLs: ['https://mail.projectsites.dev/auth/oidc'],
      disabled: false,
      skipConsent: true,
      metadata: {},
    });
  }
  return betterAuth({
    baseURL: 'https://auth.projectsites.dev',
    secret: env.BETTER_AUTH_SECRET,
    database: { db, type: 'sqlite' },
    emailAndPassword: { enabled: true },
    trustedOrigins: ['https://projectsites.dev', 'https://auth.projectsites.dev'],
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : undefined,
    plugins: [
      oidcProvider({
        loginPage: '/sign-in',
        trustedClients,
      }),
    ],
  });
}

let migrated = false;
async function ensureSchema(auth: Auth): Promise<void> {
  if (migrated) return;
  try {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    migrated = true;
  } catch (err) {
    // Tables already exist (re-run) or a benign race — log, don't crash the request.
    console.warn(JSON.stringify({ level: 'warn', msg: 'better-auth migrate skipped', err: String(err) }));
    migrated = true;
  }
}

const SIGN_IN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · ProjectSites</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#060610;color:#e7e9f3;font:16px/1.5 system-ui,sans-serif}
.card{width:min(92vw,360px);padding:32px;border:1px solid #1c2233;border-radius:16px;background:#0b0e1a}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 20px;color:#8b93a7;font-size:14px}
label{display:block;font-size:13px;margin:14px 0 6px;color:#aab2c6}
input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #232b40;border-radius:10px;
background:#070a14;color:#e7e9f3;font-size:15px}
button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:10px;background:#00e5ff;
color:#04121a;font-weight:700;font-size:15px;cursor:pointer}
.err{margin-top:14px;color:#ff8087;font-size:13px;min-height:18px}</style></head>
<body><form class="card" id="f"><h1>Sign in</h1><p>auth.projectsites.dev</p>
<label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
<label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required>
<button type="submit">Continue</button><div class="err" id="e"></div></form>
<script>const q=new URLSearchParams(location.search);
document.getElementById('f').addEventListener('submit',async ev=>{ev.preventDefault();
const e=document.getElementById('e');e.textContent='';
const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},
body:JSON.stringify({email:email.value,password:password.value})});
if(r.ok){location.href=q.get('redirect_uri')?('/api/auth/oauth2/authorize'+location.search):'/';}
else{e.textContent='Invalid email or password.';}});</script></body></html>`;

const app = new Hono<{ Bindings: Env }>();
app.get('/health', (c) => c.json({ ok: true, service: 'better-auth', db: 'd1' }));
app.get('/', (c) => c.redirect('/sign-in'));
app.get('/sign-in', (c) => c.html(SIGN_IN_HTML));
// Issuer-root OIDC discovery. Better Auth serves discovery at /api/auth/.well-known/...,
// but its `issuer` is the bare host, so strict RP clients (e.g. Listmonk/go-oidc) expect
// discovery at {issuer}/.well-known/openid-configuration. Mirror it here so issuer matches.
app.get('/.well-known/openid-configuration', async (c) => {
  const auth = buildAuth(c.env);
  await ensureSchema(auth);
  return auth.handler(
    new Request('https://auth.projectsites.dev/api/auth/.well-known/openid-configuration', {
      headers: c.req.raw.headers,
    }),
  );
});
app.get('/.well-known/jwks.json', async (c) => {
  const auth = buildAuth(c.env);
  return auth.handler(new Request('https://auth.projectsites.dev/api/auth/jwks'));
});
app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', async (c) => {
  const auth = buildAuth(c.env);
  await ensureSchema(auth);
  return auth.handler(c.req.raw);
});

export default app;
