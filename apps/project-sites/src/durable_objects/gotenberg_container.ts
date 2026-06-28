/**
 * @module durable_objects/gotenberg_container
 *
 * @description
 * `GotenbergContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs **self-hosted Gotenberg** (Office→PDF conversion via
 * LibreOffice + Chromium) for `convert.projectsites.dev`. Mirrors the
 * `InngestContainer` / `DocumensoContainer` dedicated-container pattern: a
 * single platform-owned warm instance at a fixed subdomain.
 *
 * - Image: `containers/gotenberg/Dockerfile` (`FROM gotenberg/gotenberg:8`,
 *   local-Dockerfile path → CF builds it into its managed registry, bypassing
 *   the external-registry block).
 * - Consumer: Documenso's document-conversion path. Documenso POSTs office
 *   files to `NEXT_PRIVATE_DOCUMENT_CONVERSION_URL` (= https://convert.projectsites.dev)
 *   with basic auth; Gotenberg returns the PDF.
 * - Auth: the endpoint is reachable over the public edge, so Gotenberg runs with
 *   `--api-enable-basic-auth` and validates `GOTENBERG_API_BASIC_AUTH_USERNAME` /
 *   `_PASSWORD`, injected here from the `GOTENBERG_AUTH_*` worker secrets. Stateless
 *   (no DB/Redis) — idle-hibernates after 30m, boots in seconds.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Gotenberg API port (image default). */
const GOTENBERG_PORT = 3000;

/**
 * Inject the basic-auth credentials Gotenberg validates when started with
 * `--api-enable-basic-auth`. Empty/missing values are filtered so a missing
 * secret surfaces as a boot failure rather than an unauthenticated open service.
 */
function gotenbergEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    GOTENBERG_API_BASIC_AUTH_USERNAME: env.GOTENBERG_AUTH_USERNAME,
    GOTENBERG_API_BASIC_AUTH_PASSWORD: env.GOTENBERG_AUTH_PASSWORD,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted Gotenberg conversion server, one warm instance for the platform.
 *
 * @example
 * const id = env.GOTENBERG_CONTAINER.idFromName('gotenberg-singleton');
 * return env.GOTENBERG_CONTAINER.get(id).fetch(request);
 */
export class GotenbergContainer extends Container<Env> {
  override defaultPort = GOTENBERG_PORT;
  override enableInternet = true;
  override sleepAfter = '30m';

  override async fetch(request: Request): Promise<Response> {
    try {
      // 3-positional-arg form — the shape @cloudflare/containers 0.3.2 supports.
      await this.startAndWaitForPorts(
        [GOTENBERG_PORT],
        { portReadyTimeoutMS: 120_000 },
        { envVars: gotenbergEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `Gotenberg container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
