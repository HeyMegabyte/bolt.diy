/**
 * CHAOS 17 — Voice config round-trips (agent settings + MCP attachments + shell).
 *
 * Stitched-journey coverage for the voice surfaces of the admin SPA:
 *   /admin/voice?tab=agent    (agent-settings editor)
 *   /admin/voice?tab=mcps     (MCP attachment toggles)
 *   /admin/voice?tab=numbers  (number search + keypad preview)
 *
 * Two round-trip guarantees are the heart of this spec:
 *   1. Saving agent settings MUST NOT wipe mcp_connection_ids — the iter-154
 *      field-mismatch regression (full-replace PUT nulled a sibling-owned
 *      column) is guarded by capturing the MCP attachment set BEFORE a settings
 *      save and asserting byte-equality AFTER (SPA re-mount AND hard reload).
 *   2. MCP attachment toggles persist across SPA re-mount and hard reload.
 *
 * Marker values are toggle-written and self-consistent across aborted runs:
 * every run ends by restoring the ORIGINAL captured value, so a crashed run
 * merely leaves an alternate marker that the next run treats as the baseline.
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts chaos-17-voice-config
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';
const MARKER_A = 'E2E-VOICE-CHAOS-A';
const MARKER_B = 'E2E-VOICE-CHAOS-B';

test.describe('CHAOS 17 — Voice config round-trips', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  /** Load /admin/voice?tab=agent and await the agent-settings GET (registered pre-nav). */
  async function settingsLoad(page: Page): Promise<void> {
    const resp = page.waitForResponse(
      (r) => r.url().includes('/voice/agent-settings') && r.request().method() === 'GET',
      { timeout: 30_000 },
    );
    await page.goto('/admin/voice?tab=agent', { waitUntil: 'domcontentloaded' });
    await resp.catch(() => null);
  }

  /**
   * Pin the e2e site BEFORE any voice round-trip. `AdminStateService.selectedSite`
   * resolves from the site list, which floats across the org's 3 sites — a save
   * writes row-A while a post-reload GET reads row-B (D1 showed the marker land
   * on e2e-site-2 while the GET read another row — the iter-181 journey flake).
   */
  async function pinSite(page: Page): Promise<void> {
    const sel = page.locator('[aria-label="Select site"]');
    await expect(sel).toBeVisible({ timeout: 15_000 });
    const current = (await sel.textContent())?.trim() ?? '';
    if (!current.includes('Cedar Ridge')) {
      await sel.click();
      const opt = page.locator('[role="option"]').filter({ hasText: 'Cedar Ridge Bakeshop' }).first();
      await expect(opt).toBeVisible();
      await opt.click();
    }
  }

  /** Wait until the MCP panel has settled into one of its honest states. */
  async function mcpsPanelReady(page: Page): Promise<void> {
    await page
      .locator('[data-testid="mcps-error"], [data-testid="empty-state"], li.mcp-row')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Sorted "checked" aria-labels of every MCP row checkbox (the attachment set). */
  async function captureMcpAttachments(page: Page): Promise<string[]> {
    const rows = page.locator('li.mcp-row');
    const labels: string[] = [];
    for (let i = 0; i < (await rows.count()); i++) {
      const cb = rows.nth(i).locator('input[type="checkbox"]').first();
      const label = (await cb.getAttribute('aria-label')) ?? `cb-${i}`;
      if (await cb.isChecked().catch(() => false)) {
        labels.push(label);
      }
    }
    return labels.sort();
  }

  test('agent-settings round-trip: save persists (SPA re-mount + hard reload) WITHOUT wiping mcp_connection_ids (iter-154 regression guard)', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(240_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await settingsLoad(page);
    await pinSite(page);

    // MCP panel lives on its OWN tab (app-voice-mcps mounts on tab=mcps) —
    // the settings editor does not render mcp rows. Visit the mcps tab to
    // capture the attachment set, then return to the agent tab for the save.
    await page.locator('[data-testid="voice-tab-mcps"]').click();
    await mcpsPanelReady(page);
    const mcpBefore = await captureMcpAttachments(page);
    console.log(`agent-settings: mcp attachments before save = [${mcpBefore.join(', ')}]`);
    await page.locator('[data-testid="voice-tab-agent"]').click();
    await settingsLoad(page);

    // Capture the ORIGINAL signature BEFORE any save.
    const sigInput = page.locator('textarea[name="sms-prompt"]').first();
    await expect(sigInput).toBeVisible({ timeout: 15_000 });
    const original = (await sigInput.inputValue()).trim();
    console.log(`agent-settings: original SMS prompt = "${original.slice(0, 40)}…"`);

    // Toggle-write a marker that is self-consistent across aborted runs.
    const target = original === MARKER_A ? MARKER_B : MARKER_A;
    await sigInput.fill(target);
    const saveBtn = page.getByRole('button', { name: /Save/i }).first();
    await saveBtn.click();

    // Success: toast fires, button re-enables, and the value is what we wrote.
    await expect(page.locator('[data-testid="toast-item"]').filter({ hasText: 'Voice settings saved' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    console.log(`agent-settings: saved prompt marker "${target}" — toast confirmed`);

    // THE GUARD: saving settings must not have touched the sibling-owned attachment set.
    const mcpAfterSave = await captureMcpAttachments(page);
    expect(mcpAfterSave, 'mcp_connection_ids untouched by agent-settings save').toEqual(mcpBefore);

    // SPA re-mount (tab away + back triggers a fresh GET) — value persists.
    await page.locator('[data-testid="voice-tab-mcps"]').click();
    await mcpsPanelReady(page);
    await page.locator('[data-testid="voice-tab-agent"]').click();
    await settingsLoad(page);
    await expect(page.locator('textarea[name="sms-prompt"]').first()).toHaveValue(target, {
      timeout: 15_000,
    });
    console.log('agent-settings: persisted across SPA re-mount (tab away + back)');

    // Hard reload — value persists from the server. Re-pin AFTER the reload:
    // selectedSite is in-memory only and resets to sites[0], so an un-pinned
    // post-reload GET can read a different site's row.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await pinSite(page);
    await expect(page.locator('textarea[name="sms-prompt"]').first()).toHaveValue(target, {
      timeout: 15_000,
    });
    console.log('agent-settings: persisted across hard reload');

    // RESTORE the original value (leave-as-found).
    await sigInput.fill(original);
    await saveBtn.click();
    await expect(page.locator('[data-testid="toast-item"]').filter({ hasText: 'Voice settings saved' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await pinSite(page);
    await expect(page.locator('textarea[name="sms-prompt"]').first()).toHaveValue(original, {
      timeout: 15_000,
    });
    const mcpAfterRestore = await captureMcpAttachments(page);
    expect(mcpAfterRestore, 'mcp attachments intact after restore').toEqual(mcpBefore);
    console.log('agent-settings: original SMS prompt restored, attachments re-verified');

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });

  test('mcp attachments round-trip: toggle → footer counter → save → persist (SPA re-mount + hard reload) → restore', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(240_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/voice?tab=mcps', { waitUntil: 'domcontentloaded' });
    await pinSite(page);
    await mcpsPanelReady(page);

    const rows = page.locator('li.mcp-row');
    if ((await rows.count()) === 0) {
      // Honest empty branch: helpful empty state + CTA (no lying-empty).
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No connections yet')).toBeVisible();
      console.log('mcps: honest empty state — no connections to toggle');
    } else {
      // Toggle ONE attachment and watch the footer counter reflect it.
      const cb = page.locator('input[type="checkbox"][aria-label$="to voice agent"]').first();
      await expect(cb).toBeVisible({ timeout: 15_000 });
      const originalChecked = await cb.isChecked();
      const counter = page.getByText(/\d+ connection\(s\) attached/).first();
      await expect(counter).toBeVisible({ timeout: 15_000 });
      const beforeText = await counter.innerText();
      await cb.click();
      await expect(cb).toBeChecked({ checked: !originalChecked, timeout: 10_000 });
      const afterText = await counter.innerText();
      expect(afterText, `footer counter reflects the toggle (was "${beforeText}")`).not.toBe(beforeText);
      console.log(`mcps: toggled one attachment → counter "${beforeText}" → "${afterText}"`);

      // Save — toast + button disabled (saved state).
      const saveBtn = page.getByRole('button', { name: 'Save attachments' });
      await saveBtn.click();
      await expect(page.locator('[data-testid="toast-item"]').filter({ hasText: 'Attachments saved' }))
        .toBeVisible({ timeout: 15_000 });
      await expect(saveBtn).toBeDisabled({ timeout: 10_000 });
      console.log('mcps: attachments saved — toast + disabled save button');

      // SPA re-mount (tab away + back) — toggle persists.
      await page.locator('[data-testid="voice-tab-agent"]').click();
      await expect(page.locator('textarea[name="sms-prompt"]').first()).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-testid="voice-tab-mcps"]').click();
      await mcpsPanelReady(page);
      await expect(cb).toBeChecked({ checked: !originalChecked, timeout: 15_000 });
      console.log('mcps: attachment persisted across SPA re-mount');

      // Hard reload — toggle persists from the server.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await mcpsPanelReady(page);
      await expect(cb).toBeChecked({ checked: !originalChecked, timeout: 15_000 });
      console.log('mcps: attachment persisted across hard reload');

      // RESTORE (leave-as-found).
      await cb.click();
      await expect(cb).toBeChecked({ checked: originalChecked, timeout: 10_000 });
      await page.getByRole('button', { name: 'Save attachments' }).click();
      await expect(page.locator('[data-testid="toast-item"]').filter({ hasText: 'Attachments saved' }))
        .toBeVisible({ timeout: 15_000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await mcpsPanelReady(page);
      await expect(cb).toBeChecked({ checked: originalChecked, timeout: 15_000 });
      console.log('mcps: original attachment state restored + persisted');
    }

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });

  test('voice shell: live pill + stat strip + 6-tab section nav + number search with keypad preview → honest result/error/empty', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(240_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/voice?tab=numbers', { waitUntil: 'domcontentloaded' });
    await pinSite(page);

    // Shell chrome: section marker, live pill, stat strip.
    await expect(page.locator('[data-testid="voice-section"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="voice-live-pill"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-stat-strip"]')).toBeVisible();
    console.log('shell: voice-section + live pill + stat strip rendered');

    // Section tabs — all six reachable in order.
    const tabs = ['numbers', 'conversations', 'test', 'agent', 'mcps', 'share'];
    for (const tab of tabs) {
      const btn = page.locator(`[data-testid="voice-tab-${tab}"]`);
      await expect(btn).toBeVisible();
      expect(await btn.getAttribute('role')).toBe('tab');
      await btn.click();
      await expect(btn).toHaveAttribute('aria-selected', 'true');
    }
    console.log('shell: all six voice tabs navigated with aria-selected feedback');

    // Back to numbers — keypad preview + search.
    await page.locator('[data-testid="voice-tab-numbers"]').click();
    const search = page.locator('[data-testid="voice-search-q"]').first();
    await expect(search).toBeVisible({ timeout: 15_000 });

    // Keypad preview is conditional on a vanity WORD (digits-only queries need
    // no translation — queryDigits() returns null until letters are typed).
    // Type MOVE → the preview chip renders the translated digits.
    const preview = page.locator('[data-testid="voice-keypad-preview"]').first();
    await expect(preview, 'no preview chip before a vanity word is typed').toHaveCount(0);
    await search.fill('MOVE');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText('6683'); // MOVE → 6683 on the keypad
    console.log('shell: keypad preview shows MOVE→6683');

    // Search settles into ONE honest state: results | branded error | none.
    await search.fill('866');
    await expect
      .poll(
        async () => {
          if ((await page.locator('[role="listbox"][aria-label="Available numbers"]').count()) > 0) {
            return 'results';
          }
          if (await page.locator('[data-testid="voice-search-error"]').isVisible().catch(() => false)) {
            return 'error';
          }
          return 'none';
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000, 5_000] },
      )
      .not.toBe('none');

    const state = await (async () => {
      if ((await page.locator('[role="listbox"][aria-label="Available numbers"]').count()) > 0) {
        return 'results';
      }
      return 'error';
    })();
    if (state === 'results') {
      // Presence-only: Buy buttons exist; NEVER clicked (provisions a real number).
      await expect(page.locator('[aria-label^="Buy "]').first()).toBeVisible({ timeout: 15_000 });
      console.log('shell: number search returned purchasable results (presence only)');
    } else {
      await expect(page.locator('[data-testid="voice-search-error"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
      console.log('shell: number search failed honestly — branded error + Retry surfaced');
    }
    // Regenerate affordance present (presence only — never clicked).
    await expect(page.getByRole('button', { name: 'Regenerate' }).first()).toBeVisible();
    console.log('shell: Regenerate affordance present (presence only)');

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    // The number-search 501 is the worker's DOCUMENTED honest state for dead
    // Twilio vendor creds (TWILIO_NOT_AUTHENTICATED — the API rejects the
    // configured key). Narrow-allowlist EXACTLY that URL; every other 5xx
    // still fails. The honest-UI branch above already asserted the branded
    // error + Retry. Credential rotation is a vendor-minted secret (Brian).
    const twilio501 = e.serverErrors.filter((s: string) => s === '501 https://projectsites.dev/api/voice/numbers/search?contains=866');
    const others = e.serverErrors.filter((s: string) => s !== '501 https://projectsites.dev/api/voice/numbers/search?contains=866');
    expect(others, `5xx: ${others.join('; ')}`).toEqual([]);
    if (twilio501.length > 0) {
      console.log('shell: Twilio 501 (dead vendor creds) — honest documented state, UI showed branded error + Retry');
    }
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });
});
