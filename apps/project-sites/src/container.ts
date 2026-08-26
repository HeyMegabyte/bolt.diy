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
  // Idle hibernation timer. The build's workflow polls /status every 30s, and
  // those HTTP requests reset this idle timer — so ANY value comfortably above the
  // 30s poll interval is safe from mid-build hibernation (the old 15m was overly
  // conservative). Lowered to 3m (2026-08-26) to ACCELERATE warm-container image
  // convergence: stale pre-fix instances (which lack the setStatus self-terminate)
  // only die via THIS idle timer, then cold-start fresh on the latest image; 3m
  // vs 15m makes the whole pool converge ~5× faster after a container-code deploy,
  // killing the version-skew that caused non-deterministic thin/misclassified
  // builds (fires 12-15). Pairs with maybeSelfTerminate (container-server.mjs),
  // which hard-exits new-image instances the instant they go idle post-build.
  override sleepAfter = '3m';

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
