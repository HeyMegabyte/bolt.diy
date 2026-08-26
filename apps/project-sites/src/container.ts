import { Container } from '@cloudflare/containers';
import type { Env } from './types/env.js';

/**
 * SiteBuilderContainer — Async Claude Code executor with heartbeat polling
 *
 * Architecture:
 * 1. Dockerfile pre-bakes: Claude Code CLI, git, cuser, skills repo, template repo, inspect.js,
 *    upload-to-r2.mjs, container-server.mjs, and /var/jobs persistence dir.
 * 2. Entrypoint runs `node /home/cuser/container-server.mjs` which starts the HTTP server on :8080
 *    and persists job state to /var/jobs/{jobId}.json so heartbeat polling survives container
 *    restarts/hibernation.
 * 3. POST /build → starts Claude Code async, returns { jobId } immediately
 * 4. GET /status?jobId=X → returns { status, step, elapsed, fileCount, uploadResult }
 * 5. GET /result?jobId=X → returns { files[], status, error, uploadResult } when complete
 * 6. Single `claude -p` run handles: research, logo, building, GPT-4o self-inspection, fixes
 * 7. Container does NOT touch D1 or R2 directly — workflow handles D1; container uploads via REST.
 */
export class SiteBuilderContainer extends Container<Env> {
  override defaultPort = 8080;
  override enableInternet = true;
  // Idle hibernation timer. REVERTED 3m → 15m (2026-08-26) after the 3m value
  // EVICTED ACTIVE BUILDS: the fire-19 wellness build hibernated mid-generation,
  // got the one-shot restart, hibernated AGAIN, and was abandoned
  // ("Container DO evicted before build completed"). The theory that the 30s
  // /status polls reset the idle timer did NOT hold — a CPU-bound build phase
  // (npm install, a long `claude -p` turn) can run >3m without a NEW incoming
  // request to the container, so a 3m timer fires mid-build. 15m is the
  // proven-safe floor (fires 12-16 completed without eviction; their only
  // defect was image-VERSION skew, never hibernation). Convergence is already
  // handled SAFELY by maybeSelfTerminate (container-server.mjs), which hard-exits
  // an instance 8s after it goes idle POST-build (guarded by a no-running-jobs
  // check) — that forces the fresh-image cold-start WITHOUT risking a live build.
  // So sleepAfter only needs to be high enough to never evict an in-flight build;
  // it is NOT the convergence lever. Never drop it below the longest plausible
  // no-request gap inside a build again.
  override sleepAfter = '15m';

  override entrypoint = ['node', '/home/cuser/container-server.mjs'];

  override async fetch(request: Request): Promise<Response> {
    try {
      await this.startAndWaitForPorts([8080], { portReadyTimeoutMS: 180000 });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Container start failed: ${err}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
