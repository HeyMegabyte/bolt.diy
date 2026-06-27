/**
 * @module durable_objects/formbricks_container
 *
 * @description
 * `FormbricksContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs **self-hosted Formbricks** (surveys/forms) for
 * `survey.projectsites.dev`. Mirrors the proven `InngestContainer` pattern: a
 * single platform-owned warm instance at a fixed subdomain, NOT the per-org
 * catalog AppRuntime dispatch.
 *
 * - Image: `containers/formbricks/Dockerfile` (`FROM ghcr.io/formbricks/formbricks`
 *   — local Dockerfile path, the same mechanism `SiteBuilderContainer` +
 *   `InngestContainer` use, which bypasses the account-level
 *   `IMAGE_REGISTRY_NOT_CONFIGURED` blocker that only hits bare
 *   `image = "registry/name:tag"` refs).
 * - Data plane (CF-first escape hatches per `cloudflare-first.md`):
 *     - Postgres → Neon project `Formbricks` (`wild-sound-20069767`)
 *     - Redis    → Upstash `formbricks` (`massive-locust-137311.upstash.io`) —
 *       Formbricks v3 REQUIRES Redis ("will not start without REDIS_URL").
 * - Auth/crypto: `FORMBRICKS_NEXTAUTH_SECRET` + `FORMBRICKS_ENCRYPTION_KEY`
 *   (`openssl rand -hex 32` = 32 bytes) + `FORMBRICKS_CRON_SECRET` are
 *   self-generated, stored as `wrangler secret`, never in git.
 *
 * ## CFC env-injection
 * Worker `FORMBRICKS_*` secrets are mapped to the container's expected env names
 * (`DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`,
 * `CRON_SECRET`) + `WEBAPP_URL`/`NEXTAUTH_URL`, and ride in the 3rd
 * `startAndWaitForPorts` arg. Formbricks boots on :3000 and runs its Prisma
 * migrations on first start (hence the long port-ready timeout).
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Formbricks Next.js server port. */
const FORMBRICKS_PORT = 3000;

/** Public origin Formbricks runs under (drives NEXTAUTH_URL + WEBAPP_URL). */
const FORMBRICKS_ORIGIN = 'https://survey.projectsites.dev';

/**
 * Build the env map injected into the Formbricks container: Neon Postgres,
 * Upstash Redis, self-generated auth/crypto/cron secrets, and the public origin.
 * Empty/missing values are filtered so a missing secret surfaces as a boot
 * failure rather than a silent half-config (Formbricks zod-validates env at boot).
 */
function formbricksEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    DATABASE_URL: env.FORMBRICKS_DATABASE_URL,
    REDIS_URL: env.FORMBRICKS_REDIS_URL,
    NEXTAUTH_SECRET: env.FORMBRICKS_NEXTAUTH_SECRET,
    ENCRYPTION_KEY: env.FORMBRICKS_ENCRYPTION_KEY,
    CRON_SECRET: env.FORMBRICKS_CRON_SECRET,
    WEBAPP_URL: FORMBRICKS_ORIGIN,
    NEXTAUTH_URL: FORMBRICKS_ORIGIN,
    // Formbricks v5 REQUIRES Hub + Cube analytics vars even when unused. Placeholders
    // satisfy the boot env-schema; Hub/analytics stay non-functional (not needed for surveys).
    HUB_API_URL: 'http://localhost:3000',
    HUB_API_KEY: 'unused-placeholder-hub-key',
    CUBEJS_API_URL: 'http://localhost:4000',
    CUBEJS_API_SECRET: 'unused-placeholder-cube-secret',
    // Disable Prisma's migrate advisory lock — Formbricks runs `migrate deploy` on EVERY
    // boot and the advisory lock times out against Neon (P1002). All migrations are already
    // applied, so skipping the lock is a safe no-op that lets the server start.
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted Formbricks survey server, one warm instance for the platform.
 *
 * @remarks
 * Container-backed DO → migrates on the SQLite backend via `new_sqlite_classes`
 * (CF API error 10074 rejects `new_classes` for any container DO), mirroring
 * `SiteBuilderContainer` + `InngestContainer`.
 *
 * @example
 * // worker host routing dispatches survey.projectsites.dev → this DO:
 * const id = env.FORMBRICKS_CONTAINER.idFromName('formbricks-singleton');
 * return env.FORMBRICKS_CONTAINER.get(id).fetch(request);
 */
export class FormbricksContainer extends Container<Env> {
  override defaultPort = FORMBRICKS_PORT;
  override enableInternet = true;
  // Survey server is request-driven; hibernate after a modest idle window to
  // save GB-s, accept the cold-start on the next request.
  override sleepAfter = '1h';

  override async fetch(request: Request): Promise<Response> {
    try {
      // 3-positional-arg form — the ONLY shape @cloudflare/containers 0.3.2
      // (this worker's pinned version) supports. envVars (Neon/Upstash conn
      // strings + self-gen secrets) MUST ride in the 3rd start-config arg.
      // First boot runs Prisma migrations → long port-ready window.
      await this.startAndWaitForPorts(
        [FORMBRICKS_PORT],
        { portReadyTimeoutMS: 180_000 },
        { envVars: formbricksEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `Formbricks container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
