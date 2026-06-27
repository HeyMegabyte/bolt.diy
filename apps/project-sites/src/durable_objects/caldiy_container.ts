/**
 * @module durable_objects/caldiy_container
 *
 * @description
 * `CaldiyContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs **self-hosted cal.diy** (the community Cal.com distribution,
 * enterprise features removed) for `schedule.projectsites.dev`. Mirrors
 * `DocumensoContainer` / `InngestContainer`: a single
 * platform-owned warm instance at a fixed subdomain.
 *
 * - Image: `containers/caldiy/Dockerfile` (`FROM calcom/cal.diy` — local
 *   Dockerfile path, bypasses `IMAGE_REGISTRY_NOT_CONFIGURED`).
 * - Data plane: Postgres → Neon project `Caldiy` (`empty-surf-47784419`).
 *   cal.diy is Postgres-only (NO Redis).
 * - Crypto/auth: `CALDIY_NEXTAUTH_SECRET` + `CALDIY_ENCRYPTION_KEY`
 *   (`CALENDSO_ENCRYPTION_KEY`, AES-256), each `openssl rand -base64 32`,
 *   self-generated, stored as `wrangler secret`, never in git.
 *
 * ## CFC env-injection
 * Worker `CALDIY_*` secrets map to cal.com's expected env names (`DATABASE_URL`,
 * `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`) + the public/auth URLs, riding in
 * the 3rd `startAndWaitForPorts` arg. `NEXT_PUBLIC_WEBAPP_URL` is a build-time
 * var but the image rebuilds its static files at start when it differs → a slow
 * first boot (hence the long port-ready window), then warm.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** cal.diy (Cal.com) Next.js server port. */
const CALDIY_PORT = 3000;

/** Public origin cal.diy runs under. */
const CALDIY_ORIGIN = 'https://schedule.projectsites.dev';

/**
 * Build the env map injected into the cal.diy container. Empty/missing values
 * are filtered so a missing required secret surfaces as a boot failure rather
 * than a silent half-config.
 */
function caldiyEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    DATABASE_URL: env.CALDIY_DATABASE_URL,
    // cal.com's prisma schema requires BOTH url + directUrl; without
    // DATABASE_DIRECT_URL prisma fails to load → the app 500s on every request.
    DATABASE_DIRECT_URL: env.CALDIY_DATABASE_DIRECT_URL,
    NEXTAUTH_SECRET: env.CALDIY_NEXTAUTH_SECRET,
    CALENDSO_ENCRYPTION_KEY: env.CALDIY_ENCRYPTION_KEY,
    NEXT_PUBLIC_WEBAPP_URL: CALDIY_ORIGIN,
    NEXTAUTH_URL: CALDIY_ORIGIN,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted cal.diy scheduling server, one warm instance for the platform.
 *
 * @remarks
 * Container-backed DO → migrates on the SQLite backend via `new_sqlite_classes`
 * (CF API error 10074 rejects `new_classes` for any container DO), mirroring the
 * other platform containers.
 *
 * @example
 * const id = env.CALDIY_CONTAINER.idFromName('caldiy-singleton');
 * return env.CALDIY_CONTAINER.get(id).fetch(request);
 */
export class CaldiyContainer extends Container<Env> {
  override defaultPort = CALDIY_PORT;
  override enableInternet = true;
  override sleepAfter = '1h';

  override async fetch(request: Request): Promise<Response> {
    try {
      // 3-positional-arg form — the ONLY shape @cloudflare/containers 0.3.2 (this
      // worker's pinned version) supports. First boot runs Prisma migrations AND
      // rebuilds static files for the runtime NEXT_PUBLIC_WEBAPP_URL → long window.
      await this.startAndWaitForPorts(
        [CALDIY_PORT],
        { portReadyTimeoutMS: 240_000 },
        { envVars: caldiyEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `cal.diy container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
