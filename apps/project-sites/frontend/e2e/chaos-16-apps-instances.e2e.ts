/**
 * CHAOS 16 — App instances (list + detail journeys).
 *
 * Stitched-journey coverage for the app-instances surface of the admin SPA:
 *   /admin/apps/instances        (AppInstancesComponent — list)
 *   /admin/apps/instances/:id    (AppInstanceDetailComponent — detail)
 *
 * Drives ONLY read-only + client-local interactions against PROD. NEVER clicks
 * anything that mutates real Cloudflare infra: Restart / Stop / Delete /
 * Destroy / "Save & restart" (env save restarts the container) are asserted for
 * presence / enabled / disabled state only. Confirm dialogs are opened and
 * CANCELLED. Every branch (rows / honest empty / error card) is handled so the
 * suite stays green regardless of the e2e org's live instance inventory.
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts chaos-16-apps-instances
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 16 — App instances (list + detail)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  /** Wait until the list has settled into one of its three honest states. */
  async function waitForListSettled(page: Page): Promise<void> {
    await page
      .locator(
        '[data-testid^="apps-instance-"], [data-testid="empty-state"], [data-testid="error-card"]',
      )
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
  }

  /** Classify the list's settled state. */
  async function listState(page: Page): Promise<'rows' | 'empty' | 'error'> {
    if ((await page.locator('[data-testid^="apps-instance-"]').count()) > 0) {
      return 'rows';
    }
    if (await page.locator('[data-testid="empty-state"]').isVisible().catch(() => false)) {
      return 'empty';
    }
    return 'error';
  }

  test('list journey: rows with live status + cost, per-status row menu, Open detail → back (SWR re-paint)', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(120_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });

    // Wait for the first list fetch so we never assert against the skeleton.
    await page
      .waitForResponse(
        (r) => /\/api\/apps\/instances(\?|$)/.test(r.url()) && r.request().method() === 'GET',
        { timeout: 15_000 },
      )
      .catch(() => {
        console.log('list: no /api/apps/instances response observed (stale route?)');
      });
    await waitForListSettled(page);

    const rows = page.locator('[data-testid^="apps-instance-"]');
    const state = await listState(page);
    console.log(`list: settled state = ${state}`);

    if (state === 'rows') {
      // Header surface — kicker, h2, catalog CTA (presence only; never provisions).
      await expect(page.getByRole('heading', { name: 'App Instances' })).toBeVisible();
      await expect(page.getByText('App store')).toBeVisible();
      const deployLink = page.getByRole('link', { name: 'Deploy new app' });
      await expect(deployLink).toBeVisible();
      await expect(deployLink).toHaveAttribute('href', '/admin/apps');

      // Rows carry a real status pill + a resolvable hostname link.
      const inspected = Math.min(3, await rows.count());
      for (let i = 0; i < inspected; i++) {
        const row = rows.nth(i);
        const status = await row.locator('[data-status]').getAttribute('data-status');
        expect(
          status,
          `row ${i} has a known status (got ${status})`,
        ).toMatch(/^(provisioning|running|error|stopped)$/);
        const host = row.locator('a[aria-label^="Open "]');
        await expect(host).toHaveCount(1);
        expect(await host.getAttribute('aria-label')).toContain('.app.projectsites.dev');
        // Cost estimate is rendered when the worker returns one.
        const cost = row.locator('[aria-label^="Estimated cost "]');
        if ((await cost.count()) > 0) {
          await expect(cost).toContainText(/~\$\d+(\.\d+)?\/mo/);
        }
        console.log(`list: row ${i} status=${status}`);
      }

      // Running-instances pill is present iff ≥1 row is running.
      const runningRows = await page.locator('[data-testid^="apps-instance-"] [data-status="running"]').count();
      const pill = page.locator('[aria-label="Running instances"]');
      if (runningRows > 0) {
        await expect(pill).toBeVisible();
        await expect(pill).toHaveText(/^\d+ running$/);
      } else {
        await expect(pill).toHaveCount(0);
      }

      // ⋯ menu — items mirror the row's live status.
      const firstRow = rows.first();
      const menu = firstRow.locator('button[aria-label^="Actions for "]');
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Open detail' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible(); // always offered
      const firstStatus = (await firstRow.locator('[data-status]').getAttribute('data-status')) ?? '';
      if (firstStatus === 'running' || firstStatus === 'error') {
        await expect(page.getByRole('button', { name: 'Restart' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0);
      }
      if (firstStatus === 'running') {
        await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      }
      console.log(`list: menu for status=${firstStatus} — Open detail + Delete present, Restart/Stop gated`);

      // Real-user path into the detail route via the row menu.
      await page.getByRole('button', { name: 'Open detail' }).click();
      await expect(page).toHaveURL(/\/admin\/apps\/instances\/[^/]+$/);
      await expect(page.getByRole('link', { name: 'All instances' })).toBeVisible();

      // Back via the detail breadcrumb — stale-while-revalidate cache re-paints the list instantly.
      await page.getByRole('link', { name: 'All instances' }).click();
      await expect(page).toHaveURL(/\/admin\/apps\/instances$/);
      await expect(rows.first()).toBeVisible({ timeout: 10_000 });
      console.log('list: returned via "All instances" — cached list re-painted');
    } else if (state === 'empty') {
      // Honest empty state — the CTA is the first-result action (catalog, never a deploy click).
      await expect(page.locator('[data-testid="empty-title"]')).toHaveText('No app instances yet');
      await expect(page.locator('[data-testid="empty-cta"]')).toHaveText('Browse the app store');
      await page.locator('[data-testid="empty-cta"]').click();
      await expect(page).toHaveURL(/\/admin\/apps$/, { timeout: 10_000 });
      await page.goBack();
      await expect(page.locator('[data-testid="empty-title"]')).toHaveText('No app instances yet', {
        timeout: 10_000,
      });
      console.log('list: honest empty → catalog CTA → back re-painted the empty state');
    } else {
      // Error card — honest failure surface with a retry affordance (presence only).
      await expect(page.locator('[data-testid="error-title"]')).toHaveText(
        "Couldn't load your apps",
        { timeout: 10_000 },
      );
      await expect(page.locator('[data-testid="error-retry"]')).toBeVisible();
      console.log('list: error card surfaced (no lying-empty)');
    }

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });

  test('detail journey: logs refresh, env editor gating (required-hint ↔ Save & restart), auto fields locked, hard-refresh persistence, not-found branch', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(120_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });
    await waitForListSettled(page);

    const rows = page.locator('[data-testid^="apps-instance-"]');
    const state = await listState(page);
    console.log(`detail: list settled state = ${state}`);

    if (state === 'rows') {
      // Enter the detail route by clicking the first row (real user path).
      const row = rows.first();
      const rowId = (await row.getAttribute('data-testid')) ?? 'unknown';
      await row.click();
      await expect(page).toHaveURL(/\/admin\/apps\/instances\/[^/]+$/, { timeout: 10_000 });
      await expect(page.getByRole('link', { name: 'All instances' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Environment variables' })).toBeVisible();
      const detailStatus = await page.locator('[data-status]').first().getAttribute('data-status');
      expect(detailStatus, `detail status known (got ${detailStatus})`).toMatch(
        /^(provisioning|running|error|stopped)$/,
      );
      const hostLink = page.locator('a.inst-host').first();
      await expect(hostLink).toBeVisible();
      expect(await hostLink.innerText()).toContain('.app.projectsites.dev');
      console.log(`detail: ${rowId} status=${detailStatus} host=${(await hostLink.innerText()).trim()}`);

      // Logs card — live counter label + on-demand Refresh (read-only GET).
      const logsCounter = page.locator('span[aria-live="polite"]', {
        hasText: /lines · (polling 5s|paused)/,
      });
      await expect(logsCounter).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('pre')).toBeVisible({ timeout: 10_000 }); // logs box (empty msg or lines)
      await page
        .waitForResponse(
          (r) => /\/api\/apps\/instances\/[^/]+\/logs(\?|$)/.test(r.url()) && r.request().method() === 'GET',
          { timeout: 15_000 },
        )
        .catch(() => {
          console.log('detail: no logs response observed');
        });
      await page.getByRole('button', { name: 'Refresh logs' }).click();
      await expect(page.getByRole('button', { name: 'Refresh logs' })).toBeVisible({ timeout: 10_000 });
      console.log('detail: logs refresh round-trip completed');

      // Env editor — only if the catalog app exposes env vars; auto fields are locked.
      const envInputs = page.locator('[data-testid^="env-input-"]');
      const saveBtn = page.getByRole('button', { name: 'Save & restart' });
      const envCount = await envInputs.count();
      if (envCount > 0) {
        const autoLabel = page
          .locator('label', { hasText: 'auto' })
          .filter({ has: page.locator('[data-testid^="env-input-"]') })
          .first();
        if (await autoLabel.isVisible().catch(() => false)) {
          await expect(autoLabel.locator('input')).toBeDisabled();
          console.log('detail: auto-resolved env input is disabled (locked)');
        }
        const hint = page.locator('[data-testid="env-required-hint"]');
        if (await hint.isVisible().catch(() => false)) {
          // Type a value into the first missing required var → hint clears, Save enables.
          const hintText = (await hint.innerText()) ?? '';
          const keys = hintText
            .replace(/^Required before restart:\s*/, '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
          expect(keys.length, `hint names ≥1 required var (got "${hintText}")`).toBeGreaterThan(0);
          const firstKey = keys[0]!;
          const input = page.locator(`[data-testid="env-input-${firstKey}"]`);
          await expect(input).toBeVisible();
          await input.fill('chaos16-e2e-secret');
          await expect(hint, 'required-hint clears once the var is typed').toBeHidden({ timeout: 5_000 });
          await expect(saveBtn, 'Save & restart enables with all required vars set').toBeEnabled({
            timeout: 5_000,
          });
          // Clear it again → hint returns, button re-disables. (Never click Save: it restarts the container.)
          await input.fill('');
          await expect(hint, 'required-hint returns when the field is cleared').toBeVisible({
            timeout: 5_000,
          });
          await expect(saveBtn, 'Save & restart re-disables on missing required var').toBeDisabled({
            timeout: 5_000,
          });
          console.log(`detail: env gating verified via required var ${firstKey} (typed → cleared)`);
        } else {
          await expect(saveBtn, 'Save & restart enabled when no required var is missing').toBeEnabled({
            timeout: 5_000,
          });
          console.log('detail: no required vars missing — Save & restart enabled (never clicked)');
        }
      } else {
        const unavailable = page.getByText('Catalog entry unavailable — env editor disabled.');
        if (await unavailable.isVisible().catch(() => false)) {
          console.log('detail: catalog entry unavailable — env editor honestly disabled');
        } else {
          console.log('detail: catalog app exposes no env vars — no env inputs (honest)');
        }
      }

      // Meta grid — Instance ID + Created labels render.
      await expect(page.getByText('Instance ID', { exact: true })).toBeVisible();
      await expect(page.getByText('Created', { exact: true })).toBeVisible();

      // Hard refresh — route param re-loads the same instance (persisted state).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('link', { name: 'All instances' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Environment variables' })).toBeVisible();
      await expect(page.locator('[data-status]').first()).toHaveAttribute(
        'data-status',
        /^(provisioning|running|error|stopped)$/,
      );
      console.log('detail: hard refresh re-rendered the same instance from the route param');
    } else if (state === 'empty') {
      await expect(page.locator('[data-testid="empty-title"]')).toHaveText('No app instances yet');
      console.log('detail: no instances to open — asserted the honest empty state instead');
    } else {
      await expect(page.locator('[data-testid="error-title"]')).toHaveText("Couldn't load your apps", {
        timeout: 10_000,
      });
      console.log('detail: list error card — no detail reachable');
    }

    // Route-param branch: a bogus id renders the branded not-found notice (never a crash).
    await page.goto('/admin/apps/instances/__chaos16_ghost_id__', { waitUntil: 'domcontentloaded' });
    const notFound = page.getByRole('alert').filter({ hasText: 'Instance not found.' });
    await expect(notFound).toBeVisible({ timeout: 15_000 });
    await expect(notFound).toContainText('No instance with id __chaos16_ghost_id__');
    console.log('detail: not-found branch renders "Instance not found." + the bogus id');

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });

  test('confirm dialogs: ⋯ menu Esc-closes, Stop/Delete open the branded confirm and CANCEL leaves the instance untouched', async ({ page }) => {
    const e = trackErrors(page);
    test.setTimeout(120_000);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });
    await waitForListSettled(page);

    const rows = page.locator('[data-testid^="apps-instance-"]');
    const state = await listState(page);
    console.log(`confirm: list settled state = ${state}`);

    if (state === 'rows') {
      const row = rows.first();
      const menu = row.locator('button[aria-label^="Actions for "]');
      const rowCountBefore = await rows.count();

      // Open the menu, then dismiss it with Esc (keyboard path).
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Open detail' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      console.log('confirm: menu closed via Escape');

      // Re-open; drive the destructive action the row's status actually offers.
      await menu.click();
      const status = (await row.locator('[data-status]').getAttribute('data-status')) ?? '';
      const action = status === 'running' ? 'Stop' : 'Delete';
      await page.getByRole('button', { name: action }).click();

      // Branded confirm dialog opens (never accept — cancel leaves infra untouched).
      await expect(page.locator('[data-testid="confirm-message"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="confirm-accept"]')).toHaveText(action);
      await page.locator('[data-testid="confirm-cancel"]').click();
      await expect(page.locator('[data-testid="confirm-message"]')).toBeHidden({ timeout: 5_000 });
      expect(await rows.count(), `row count unchanged after cancel (was ${rowCountBefore})`).toBe(
        rowCountBefore,
      );
      console.log(`confirm: "${action}" dialog cancelled — ${rowCountBefore} instances still listed`);
    } else {
      await expect(page.locator('[data-testid="empty-title"]')).toHaveText('No app instances yet');
      await expect(page.getByRole('link', { name: 'Deploy new app' })).toBeVisible();
      console.log('confirm: no instances — asserted empty state + header CTA presence');
    }

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual([]);
  });
});
