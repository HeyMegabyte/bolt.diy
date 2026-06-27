/**
 * auth.projectsites.dev — self-hosted Better Auth (OIDC IdP) for CF Workers Containers.
 *
 * Better Auth is a library, so this is a tiny Hono/Node server that mounts it with the
 * `oidcProvider` plugin (making it a real OIDC IdP) backed by Neon Postgres. Unlike
 * Logto it needs no Postgres role-password control — plain tables only — so it runs on
 * Neon natively. Schema is applied programmatically on boot via `getMigrations`
 * (standard DDL, Neon-compatible), so no CLI/volume is needed. The main app's
 * IdentityProvider port (services/better_auth_provider.ts, ADR-0006) points at the
 * `/api/auth/oauth2/*` endpoints this exposes.
 *
 * Login screen: `/` 302s to `/sign-in`, which returns a 200 HTML form — that's the
 * "200 at the login page" the deploy gate checks.
 */
import { betterAuth } from 'better-auth';
import { oidcProvider } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db';
import { Pool } from 'pg';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

const BASE_URL = process.env.BETTER_AUTH_URL ?? 'https://auth.projectsites.dev';
const REDIRECT_URLS = (
  process.env.OIDC_REDIRECT_URLS ?? 'https://projectsites.dev/api/auth/betterauth/callback'
).split(',');

const auth = betterAuth({
  baseURL: BASE_URL,
  secret: required('BETTER_AUTH_SECRET'),
  database: new Pool({ connectionString: required('DATABASE_URL') }),
  emailAndPassword: { enabled: true },
  trustedOrigins: ['https://projectsites.dev', 'https://auth.projectsites.dev'],
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  plugins: [
    oidcProvider({
      loginPage: '/sign-in',
      // The ProjectSites worker is a trusted first-party OIDC client — no consent prompt.
      trustedClients: [
        {
          clientId: required('OIDC_CLIENT_ID'),
          clientSecret: required('OIDC_CLIENT_SECRET'),
          name: 'ProjectSites',
          type: 'web',
          redirectURLs: REDIRECT_URLS,
          disabled: false,
          skipConsent: true,
          metadata: {},
        },
      ],
    }),
  ],
});

/** Apply Better Auth's schema on boot — plain DDL, idempotent, Neon-compatible. */
async function migrate(): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  console.log(JSON.stringify({ level: 'info', msg: 'better-auth migrations applied' }));
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

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, service: 'better-auth' }));
app.get('/', (c) => c.redirect('/sign-in'));
app.get('/sign-in', (c) => c.html(SIGN_IN_HTML));
app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => auth.handler(c.req.raw));

const port = Number(process.env.PORT ?? 3000);

migrate()
  .catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'migration failed', err: String(err) }));
  })
  .finally(() => {
    serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () =>
      console.log(JSON.stringify({ level: 'info', msg: `better-auth listening on :${port}` })),
    );
  });
