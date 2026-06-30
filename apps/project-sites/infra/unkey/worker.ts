import { Container, getContainer } from '@cloudflare/containers';

/**
 * api.projectsites.dev — Unkey (API key management, AGPL) on Cloudflare Workers Containers.
 *
 * @remarks
 * ONE published Unkey Go-binary container (`unkeyed/unkey`) runs the API server behind this
 * Worker (cloudflare-lock-in-is-leverage — CF Containers, not Fly). AGPL stays isolated behind
 * the HTTP boundary (own container/subdomain, zero code import — agpl-isolation-via-http-boundary).
 * The container talks to the EXTERNAL data plane: Neon Postgres (`projectsites_unkey`) + Upstash
 * (Redis). ClickHouse (analytics) + Vault (encryption-at-rest) are optional and omitted for v1.
 * The API has no idle daemon to keep alive, but a `scheduled` cron re-pokes it so the FIRST
 * key-verification after idle doesn't pay a container cold-start (Unkey targets <40ms).
 */
interface Env {
  UNKEY: DurableObjectNamespace<Unkey>;
  /** Postgres connection string → Neon `projectsites_unkey` db (`postgresql://user:pw@host/projectsites_unkey?sslmode=require`). */
  UNKEY_DATABASE_PRIMARY: string;
  /** Upstash Redis (rediss://default:<pw>@<host>:6379) — rate-limit counters + usage. */
  UNKEY_REDIS_URL: string;
  /** Bootstrap/admin root key. */
  UNKEY_ROOT_KEY: string;
}

const WEB_URL = 'https://api.projectsites.dev';

export class Unkey extends Container<Env> {
  // Unkey's API server binds UNKEY_HTTP_PORT (default 7070) on 0.0.0.0; CF health-checks it.
  override defaultPort = 7070;
  override sleepAfter = '30m'; // re-poked by the keep-warm cron so verifies stay warm
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // UNKEY_CONFIG points the server at the TOML baked into the image (COPY unkey.toml
    // /unkey.toml); its ${UNKEY_*} placeholders are env-expanded from the vars below.
    const out: Record<string, string> = { UNKEY_HTTP_PORT: '7070', UNKEY_CONFIG: '/unkey.toml' };
    if (env.UNKEY_DATABASE_PRIMARY) out.UNKEY_DATABASE_PRIMARY = env.UNKEY_DATABASE_PRIMARY;
    if (env.UNKEY_REDIS_URL) out.UNKEY_REDIS_URL = env.UNKEY_REDIS_URL;
    if (env.UNKEY_ROOT_KEY) out.UNKEY_ROOT_KEY = env.UNKEY_ROOT_KEY;
    this.envVars = out;
  }
  /** Log container-boot failures to observability (caller still gets the lib's retry page). */
  override async onError(error: unknown): Promise<Response> {
    console.error('[unkey onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 7070,
      // First boot runs DB migrations against Neon — give it a generous window.
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

/**
 * Branded 200 landing page shown when the Unkey container is not yet running.
 * Matches the ProjectSites brand: dark-first, cyan accent, Space Grotesk font.
 */
function landingPage(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API Gateway · ProjectSites</title>
<meta name="description" content="API key management and gateway for ProjectSites — powered by Unkey.">
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
<div class="eyebrow">ProjectSites · API Gateway</div>
<h1>API Gateway</h1>
<p class="sub">API key management, rate limiting, and usage tracking for the ProjectSites platform and its generated sites. Powered by Unkey.</p>
<div class="card"><h2>Powered by</h2><p>Unkey (<code class="host">unkeyed/unkey</code>) — open-source API key management. Verifies keys in <40ms against Neon Postgres + Upstash Redis.</p></div>
<div class="card"><h2>Endpoints</h2><p><code class="host">POST /v2/keys.create</code> · <code class="host">GET /v2/keys.verify</code> · <code class="host">PUT /v2/keys.update</code> · <code class="host">DELETE /v2/keys.delete</code> · <code class="host">GET /v2/liveness</code></p></div>
<div class="card"><h2>Status</h2><p>The Unkey container is provisioning. This page will automatically serve the Unkey API once the container is built and running.</p></div>
<p class="foot">&larr; <a href="https://projectsites.dev/">projectsites.dev</a> · <a href="https://unkey.dev">unkey.dev</a></p>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await getContainer(env.UNKEY, 'singleton').fetch(request);
    } catch {
      return landingPage();
    }
  },
  /** Keep-warm: re-poke the container so the next verify doesn't pay a cold start. */
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      getContainer(env.UNKEY, 'singleton')
        .fetch(new Request(`${WEB_URL}/v2/liveness`))
        .then(() => undefined)
        .catch(() => undefined),
    );
  },
};
