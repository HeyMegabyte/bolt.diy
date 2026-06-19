/**
 * Browser job EXECUTION for `browser.projectsites.dev` (doctrine §5/§8).
 *
 * @remarks
 * Runs screenshot/pdf jobs on **CF Browser Run** (via the gateway's
 * `connectBrowser`), stores the artifact in **R2** under a tenant-scoped key, and
 * returns a `completed` envelope. The browser drive is abstracted behind
 * {@link BrowserRunner} so the orchestration (key → run → store → envelope) is
 * unit-testable with a stub; the real CF runner is integration-level (same
 * `@cloudflare/playwright` path as `vision_qa.ts`).
 */
import type { Env } from '../types/env.js';
import { connectBrowser } from './browser_gateway.js';

/** A minimal browser drive — screenshot or render-to-PDF a URL. */
export interface BrowserRunner {
  screenshot(url: string, viewport?: { width: number; height: number }): Promise<Uint8Array>;
  pdf(url: string): Promise<Uint8Array>;
}

export interface ArtifactJob {
  readonly tenantId: string;
  readonly siteId: string;
  readonly url: string;
  readonly timeoutMs?: number;
}

export interface ArtifactResult {
  readonly status: 'completed';
  readonly purpose: 'screenshot' | 'pdf';
  readonly artifactKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** Tenant-scoped, time-stamped R2 key for a browser artifact. */
export function browserArtifactKey(job: { tenantId: string; siteId: string }, purpose: 'screenshot' | 'pdf', stamp: string): string {
  const ext = purpose === 'pdf' ? 'pdf' : 'png';
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `browser-jobs/${safe(job.tenantId)}/${safe(job.siteId)}/${stamp}-${purpose}.${ext}`;
}

/**
 * Run a screenshot/pdf job: drive the runner, store to R2, return the envelope.
 *
 * @param stamp - A caller-supplied timestamp/id (keeps the function deterministic;
 *   `Date.now()` is not available in this runtime's pure layer).
 * @throws on a runner or storage failure (the route maps it to a 5xx envelope).
 */
export async function runArtifactJob(
  env: Pick<Env, 'SITES_BUCKET'>,
  purpose: 'screenshot' | 'pdf',
  job: ArtifactJob,
  runner: BrowserRunner,
  stamp: string,
): Promise<ArtifactResult> {
  const bytes = purpose === 'pdf' ? await runner.pdf(job.url) : await runner.screenshot(job.url);
  const key = browserArtifactKey(job, purpose, stamp);
  const contentType = purpose === 'pdf' ? 'application/pdf' : 'image/png';
  await env.SITES_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  return { status: 'completed', purpose, artifactKey: key, contentType, sizeBytes: bytes.byteLength };
}

/**
 * The real CF Browser Run runner — connects via the gateway (CF primary) and
 * drives Playwright. Integration-level; not unit-tested (needs a live browser).
 */
export async function cfBrowserRunner(env: Env): Promise<{ runner: BrowserRunner; release: () => Promise<void> }> {
  const gw = await connectBrowser(env, {}); // routes CF-first per the LAW
  // The gateway returns a `@cloudflare/playwright` Browser typed `unknown`.
  const browser = gw.browser as {
    newPage(): Promise<{
      setViewportSize(v: { width: number; height: number }): Promise<void>;
      goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
      screenshot(o?: { fullPage?: boolean }): Promise<Uint8Array>;
      pdf(): Promise<Uint8Array>;
      close(): Promise<void>;
    }>;
  };
  const runner: BrowserRunner = {
    async screenshot(url, viewport = { width: 1280, height: 800 }) {
      const page = await browser.newPage();
      try {
        await page.setViewportSize(viewport);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
        return await page.screenshot({ fullPage: false });
      } finally {
        await page.close();
      }
    },
    async pdf(url) {
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
        return await page.pdf();
      } finally {
        await page.close();
      }
    },
  };
  return { runner, release: gw.release };
}
