/**
 * @module e2e/helpers/browserbase
 *
 * Real-browser harness for the P0-ADMIN visual-verification mandate (Brian
 * 2026-08-02): every admin feature must WORK + be POPULATED, verified in a REAL
 * managed browser both technically AND visually.
 *
 * Connects Playwright to a managed Browserbase Chromium session over CDP. Use
 * this when a run wants managed real-browser scale/replay/proxy; the existing
 * `playwright.prod.config.ts` already drives local real-Chromium for the bulk of
 * the suite, so prefer this for the authed-admin visual sweeps + AI-vision steps.
 *
 * Requires `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (both in get-secret;
 * export them into the test env before running). If either is unset, callers
 * should fall back to the local Chromium context (fail-open, never fail-closed).
 *
 * @example
 * ```ts
 * import { chromium } from '@playwright/test';
 * import { createBrowserbaseSession, browserbaseConnectUrl } from './helpers/browserbase.js';
 * const s = await createBrowserbaseSession();
 * const browser = await chromium.connectOverCDP(browserbaseConnectUrl(s.id));
 * const page = await browser.newPage();
 * await page.goto('https://projectsites.dev');
 * // …authed-admin navigation + screenshot + assertions…
 * await browser.close();
 * ```
 */

/** A created Browserbase session. */
export interface BrowserbaseSession {
  readonly id: string;
}

/** True when Browserbase creds are present (else callers use local Chromium). */
export function browserbaseAvailable(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

/**
 * Create a managed Browserbase Chromium session.
 *
 * @returns The session (its `id` feeds {@link browserbaseConnectUrl}).
 * @throws {Error} When creds are missing or the API rejects the request.
 */
export async function createBrowserbaseSession(
  opts?: { timeoutSec?: number },
): Promise<BrowserbaseSession> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('Browserbase creds missing (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID)');
  }
  // `timeout` (seconds) is the session's max duration — bump it for long
  // multi-section sweeps so the shared session doesn't expire mid-run.
  const reqBody: { projectId: string; timeout?: number } = { projectId };
  if (opts?.timeoutSec) reqBody.timeout = opts.timeoutSec;
  const res = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    throw new Error(`Browserbase session create failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

/**
 * The CDP connect URL for a Browserbase session — pass to
 * `chromium.connectOverCDP(...)`.
 *
 * @param sessionId - The `id` from {@link createBrowserbaseSession}.
 */
export function browserbaseConnectUrl(sessionId: string): string {
  const apiKey = process.env.BROWSERBASE_API_KEY ?? '';
  return `wss://connect.browserbase.com?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(sessionId)}`;
}
