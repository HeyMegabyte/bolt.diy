/**
 * Bolt.diy chat-readiness guard (B7 from .claude/RECS.md).
 *
 * The admin shell's `BoltEmbedService` dismisses its "loading veil" only when
 * the embedded bolt.diy iframe posts `PS_BOLT_CHAT_READY`. The current
 * `editor.projectsites.dev` build emits that postMessage via a MutationObserver
 * that watches for the chat composer's placeholder string:
 *
 *   "Build a professional website for"
 *
 * If an upstream bolt.diy merge ever renames that placeholder, the
 * MutationObserver never fires, the veil never lifts, and the admin Editor tab
 * appears permanently broken. This spec is the canary — it fails the CI build
 * the moment the string disappears OR the postMessage stops emitting.
 *
 * Two assertions, both with 30s budgets that match the production veil timeout:
 *   1. Visible DOM contains the placeholder string somewhere
 *   2. The window receives a `PS_BOLT_CHAT_READY` postMessage
 *
 * @see apps/project-sites/frontend/src/app/services/bolt-embed.service.ts
 * @see .claude/RECS.md  (Backlog item B7)
 */
import { expect, test } from '@playwright/test';

const EDITOR_URL = 'https://editor.projectsites.dev/?embedded=true';
const PLACEHOLDER = 'Build a professional website for';
const READY_MESSAGE = 'PS_BOLT_CHAT_READY';
const READY_TIMEOUT_MS = 30_000;

test.describe('bolt.diy chat readiness (PS_BOLT_CHAT_READY contract)', () => {
  test('chat composer placeholder string is still shipped', async ({ page }) => {
    // We pre-install the postMessage listener BEFORE navigating so we never
    // miss an early-emit race. `__bolt_ready_messages` accumulates every
    // matching message — we read it back via `waitForFunction` below.
    await page.addInitScript(() => {
      (window as unknown as { __bolt_ready_messages: string[] }).__bolt_ready_messages = [];
      window.addEventListener('message', (event: MessageEvent) => {
        // Filter to plain string payloads + structured `{type:'PS_BOLT_CHAT_READY'}`
        // shape so we accept either contract bolt.diy might use.
        const payload =
          typeof event.data === 'string'
            ? event.data
            : event.data && typeof event.data === 'object' && 'type' in event.data
              ? String((event.data as { type: unknown }).type)
              : null;
        if (payload === 'PS_BOLT_CHAT_READY') {
          (window as unknown as { __bolt_ready_messages: string[] }).__bolt_ready_messages.push(
            payload,
          );
        }
      });
    });

    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });

    // Assertion 1 — DOM contains the placeholder. Wait up to 30s; the
    // WebContainer boot + chat composer mount can take 20-25s on cold cache.
    // We probe via `getByText` with `exact: false` so partial string matches
    // (e.g. "Build a professional website for [Business]") still satisfy.
    await expect(page.getByText(PLACEHOLDER, { exact: false }).first()).toBeVisible({
      timeout: READY_TIMEOUT_MS,
    });
  });

  test('PS_BOLT_CHAT_READY postMessage fires within 30s of iframe load', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __bolt_ready_messages: string[] }).__bolt_ready_messages = [];
      window.addEventListener('message', (event: MessageEvent) => {
        const payload =
          typeof event.data === 'string'
            ? event.data
            : event.data && typeof event.data === 'object' && 'type' in event.data
              ? String((event.data as { type: unknown }).type)
              : null;
        if (payload === 'PS_BOLT_CHAT_READY') {
          (window as unknown as { __bolt_ready_messages: string[] }).__bolt_ready_messages.push(
            payload,
          );
        }
      });
    });

    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });

    // Assertion 2 — the `PS_BOLT_CHAT_READY` postMessage lands on `window`
    // within 30s. `waitForFunction` polls every 100ms; failure throws after
    // the budget elapses with the standard Playwright timeout receipt.
    await page.waitForFunction(
      (expected: string) => {
        const messages = (window as unknown as { __bolt_ready_messages?: string[] })
          .__bolt_ready_messages;
        return Array.isArray(messages) && messages.includes(expected);
      },
      READY_MESSAGE,
      { timeout: READY_TIMEOUT_MS, polling: 100 },
    );
  });
});
