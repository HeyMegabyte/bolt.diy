/**
 * @module durable_objects/inngest_container
 *
 * @description
 * `InngestContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs a **self-hosted Inngest server** (`inngest start`) for the
 * `jobs.`/`events.projectsites.dev` automation plane (convergence prompt §13).
 *
 * - Image: `containers/inngest/Dockerfile` (`FROM inngest/inngest` — local
 *   Dockerfile path, the same mechanism `SiteBuilderContainer` uses, which
 *   bypasses the account-level `IMAGE_REGISTRY_NOT_CONFIGURED` blocker that
 *   only hits bare `image = "registry/name:tag"` refs).
 * - Data plane (LAW-clean, CF-first escape hatches per `cloudflare-first.md`):
 *     - Postgres → Neon project `Inngest` (`calm-sunset-61361436`)
 *     - Redis    → Upstash `inngest` (`stirring-cricket-93162.upstash.io`)
 * - Auth: `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` are SELF-GENERATED
 *   (`openssl rand -hex 32`, even-length hex per Inngest's requirement),
 *   stored to chezmoi + `wrangler secret`, never in git.
 *
 * The Hono worker registers its functions with this server via the
 * `inngest/hono` `serve()` handler mounted at `/api/inngest` (see
 * `src/inngest/serve.ts`); the server invokes those functions over HTTP.
 *
 * ## CFC env-injection
 * Secrets reach the container through the `Container#envVars` getter, which
 * reads the worker's bound secrets (`this.env.*`). The image's default
 * `CMD ["inngest","start"]` then boots against those env vars. Inngest serves
 * its API + dashboard on :8288 and the Connect WebSocket gateway on :8289.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Inngest server HTTP/dashboard port (Connect WS gateway is :8289). */
const INNGEST_PORT = 8288;

/**
 * Build the env map injected into `inngest start`: Neon Postgres URI, Upstash
 * Redis URI, and the self-generated event/signing keys from the worker's bound
 * secrets. Empty/missing values are filtered so a missing secret surfaces as a
 * boot failure rather than a silent half-config.
 */
function inngestEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    INNGEST_EVENT_KEY: env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: env.INNGEST_SIGNING_KEY,
    INNGEST_POSTGRES_URI: env.INNGEST_POSTGRES_URI,
    INNGEST_REDIS_URI: env.INNGEST_REDIS_URI,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted Inngest durable-jobs server, one warm instance for the platform.
 *
 * @remarks
 * Container runner (no `ctx.storage.sql`) → migrates on the CLASSIC DO backend
 * via `new_classes` (NOT `new_sqlite_classes`), mirroring `SiteBuilderContainer`.
 *
 * @example
 * // worker host routing dispatches jobs./events. → this DO:
 * const id = env.INNGEST_CONTAINER.idFromName('inngest-singleton');
 * return env.INNGEST_CONTAINER.get(id).fetch(request);
 */
export class InngestContainer extends Container<Env> {
  override defaultPort = INNGEST_PORT;
  override enableInternet = true;
  // Durable jobs server must stay warm — hibernation would drop in-flight
  // step execution + the Connect gateway. Long idle window; the platform
  // pings it continuously once functions are registered.
  override sleepAfter = '4h';

  override async fetch(request: Request): Promise<Response> {
    try {
      // Inject the Neon/Upstash conn strings + self-gen auth keys at start time
      // (per-instance startOptions; `envVars` is also a Container field but
      // passing it here keeps the secret read inside the request lifecycle).
      await this.startAndWaitForPorts(
        [INNGEST_PORT],
        { portReadyTimeoutMS: 120000 },
        { envVars: inngestEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `Inngest container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
