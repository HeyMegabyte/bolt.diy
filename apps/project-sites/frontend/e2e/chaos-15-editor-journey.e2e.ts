/**
 * CHAOS 15 — "The Patient Builder": the editor AI round-trip (THE keystone journey).
 *
 * The one surface every prior chaos spec skipped: bolt.diy INSIDE /admin/editor.
 * Render-integrity + data-reconciliation gates are BLIND to this bug class — a
 * clean render, zero console errors, zero 5xx, and an AI chat that answers
 * NOTHING when you type. Only a typed prompt + an assertion on real answer
 * content can catch it. (Brian 2026-08-18: "there's no proper response in the
 * Editor." This spec is the failing test for that class.)
 *
 * Journey: homepage → /admin/editor → wait out the WebContainer cold boot
 * (30-90s, budgeted not skipped) → type a real prompt into bolt's chat →
 * assert a non-empty AI answer arrives → navigate away → return → warm boot is
 * instant → the editor still answers.
 *
 * Slow by design (~2-4 min). Run it every fire; no fire is done while it's red.
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-15-editor-journey --project=chromium --workers=1
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

// bolt's build-mode chat prompt placeholder (app/components/chat/ChatBox.tsx).
const BOLT_PROMPT_PLACEHOLDER = 'What are we shipping?';
// Deterministic answer probe: the echo token the AI must reproduce verbatim.
const PROBE = 'PONG-CHECK';
const PROBE_PROMPT = `Reply with the exact word ${PROBE} and nothing else.`;

const BOOT_TIMEOUT = 120_000;
const ANSWER_TIMEOUT = 90_000;

test.describe('CHAOS 15 — Editor AI round-trip (keystone)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('editor boots, answers a typed prompt with real content, and re-answers after nav-away + return', async ({
    page,
  }) => {
    test.setTimeout(420_000); // cold WebContainer boot is the long pole
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/editor', { waitUntil: 'domcontentloaded' });

    // The bolt iframe is the embedded editor (embed-only gate serves the real app
    // only when embedded from /admin).
    const frame = page.frameLocator('iframe[src*="editor.projectsites.dev"]').first();

    // ── Cold boot: the chat input appears only after WebContainer finishes
    // "Running Start Application" — condition-based wait, no arbitrary sleep.
    const chatBox = frame.locator(`textarea[placeholder="${BOLT_PROMPT_PLACEHOLDER}"]`);
    await expect(chatBox, `bolt chat input never appeared (WebContainer boot ${BOOT_TIMEOUT / 1000}s)`).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });

    // ── THE assertion that catches the bug class: type a real prompt, an answer
    // with the echo token MUST arrive. A clean render that answers nothing = RED.
    await chatBox.fill(PROBE_PROMPT);
    await chatBox.press('Enter');
    await expect
      .poll(async () => {
        const text = await frame.locator('body').innerText().catch(() => '');
        return text.includes(PROBE);
      }, {
        timeout: ANSWER_TIMEOUT,
        message: `editor AI answered NOTHING within ${ANSWER_TIMEOUT / 1000}s — the exact "no proper response" defect`,
      })
      .toBe(true);

    // ── Warm return: navigate away and back; the persistent-iframe design means
    // no second cold boot — the input must be there quickly and still answer.
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/editor', { waitUntil: 'domcontentloaded' });
    await expect(chatBox, 'warm return: bolt chat input must not cold-boot again').toBeVisible({
      timeout: 30_000,
    });
    await chatBox.fill(PROBE_PROMPT);
    await chatBox.press('Enter');
    await expect
      .poll(async () => {
        const text = await frame.locator('body').innerText().catch(() => '');
        return text.includes(PROBE);
      }, {
        timeout: ANSWER_TIMEOUT,
        message: 'editor AI stopped answering after nav-away + return',
      })
      .toBe(true);

    // Full DoD for the journey.
    await assertAlive(page);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(
      e.consoleWarnings,
      `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
    ).toEqual([]);
  });
});
