/**
 * @module durable_objects/documenso_container
 *
 * @description
 * `DocumensoContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs **self-hosted Documenso** (e-signatures) for
 * `sign.projectsites.dev`. Mirrors `FormbricksContainer` / `InngestContainer`:
 * a single platform-owned warm instance at a fixed subdomain.
 *
 * - Image: `containers/documenso/Dockerfile` (`FROM documenso/documenso` —
 *   local Dockerfile path, bypasses `IMAGE_REGISTRY_NOT_CONFIGURED`).
 * - Data plane: Postgres → Neon project `Documenso` (`shiny-wind-41827027`).
 *   Documenso is Postgres-only (NO Redis).
 * - Crypto/auth: `DOCUMENSO_NEXTAUTH_SECRET` + `DOCUMENSO_ENCRYPTION_KEY` +
 *   `DOCUMENSO_ENCRYPTION_SECONDARY_KEY` (each `openssl rand -base64 32`, >=32
 *   chars), self-generated, stored as `wrangler secret`, never in git.
 * - Signing: a self-signed P12 rides as base64 in `DOCUMENSO_SIGNING_CERT_B64`
 *   (+ `DOCUMENSO_SIGNING_PASSPHRASE`). The cert is OPTIONAL for boot — Documenso
 *   serves its login page without it; only document SIGNING needs it.
 *
 * ## CFC env-injection
 * Worker `DOCUMENSO_*` secrets are mapped to Documenso's expected env names
 * (`NEXT_PRIVATE_DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`,
 * `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`,
 * `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`, `NEXT_PRIVATE_SIGNING_PASSPHRASE`)
 * + the public/internal URLs, and ride in the 3rd `startAndWaitForPorts` arg.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Documenso Next.js server port. */
const DOCUMENSO_PORT = 3000;

/** Public origin Documenso runs under. */
const DOCUMENSO_ORIGIN = 'https://sign.projectsites.dev';

/**
 * Build the env map injected into the Documenso container. Empty/missing values
 * are filtered so a missing required secret surfaces as a boot failure rather
 * than a silent half-config (Documenso validates env at boot).
 */
function documensoEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    NEXT_PRIVATE_DATABASE_URL: env.DOCUMENSO_DATABASE_URL,
    NEXTAUTH_SECRET: env.DOCUMENSO_NEXTAUTH_SECRET,
    NEXT_PRIVATE_ENCRYPTION_KEY: env.DOCUMENSO_ENCRYPTION_KEY,
    NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY: env.DOCUMENSO_ENCRYPTION_SECONDARY_KEY,
    NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS: env.DOCUMENSO_SIGNING_CERT_B64,
    NEXT_PRIVATE_SIGNING_PASSPHRASE: env.DOCUMENSO_SIGNING_PASSPHRASE,
    NEXT_PUBLIC_WEBAPP_URL: DOCUMENSO_ORIGIN,
    NEXT_PRIVATE_INTERNAL_WEBAPP_URL: 'http://localhost:3000',
    // Documenso runs `prisma migrate deploy` on every boot; the advisory lock times
    // out against Neon (P1002 → container start AbortError). All migrations are
    // already applied, so skipping the lock is a safe no-op that lets the server boot.
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted Documenso e-signature server, one warm instance for the platform.
 *
 * @remarks
 * Container-backed DO → migrates on the SQLite backend via `new_sqlite_classes`
 * (CF API error 10074 rejects `new_classes` for any container DO), mirroring
 * `SiteBuilderContainer` + `InngestContainer` + `FormbricksContainer`.
 *
 * @example
 * const id = env.DOCUMENSO_CONTAINER.idFromName('documenso-singleton');
 * return env.DOCUMENSO_CONTAINER.get(id).fetch(request);
 */
export class DocumensoContainer extends Container<Env> {
  override defaultPort = DOCUMENSO_PORT;
  override enableInternet = true;
  override sleepAfter = '1h';

  override async fetch(request: Request): Promise<Response> {
    try {
      // 3-positional-arg form — the ONLY shape @cloudflare/containers 0.3.2 (this
      // worker's pinned version) supports. First boot runs Prisma migrations →
      // long port-ready window.
      await this.startAndWaitForPorts(
        [DOCUMENSO_PORT],
        { portReadyTimeoutMS: 180_000 },
        { envVars: documensoEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `Documenso container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
