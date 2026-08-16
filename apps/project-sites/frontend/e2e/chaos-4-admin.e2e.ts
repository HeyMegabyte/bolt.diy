/**
 * CHAOS 4 — "The Power Admin": authed full-dashboard sweep.
 *
 * Homepage-first, seeds a real `ps_session` from E2E_API_KEY, then walks EVERY
 * admin section asserting each renders alive with no pageerror / no 5xx / no
 * injected-script execution. Then hammers a couple of interactive surfaces.
 * Skips if E2E_API_KEY is absent (fork/secret-less runs).
 *
 * ⚠️ Does NOT touch the sidebar/admin-shell owned by a concurrent session — it
 * only navigates section ROUTES and reads state.
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

// Section routes (navigate directly; the shell mounts each lazily). EVERY entry
// MUST be a real registered admin child route in app.routes.ts — a route with no
// child renders the admin not-found component, which the render-sweep's assertAlive
// (page has text) CANNOT distinguish from a real section. The `admin-not-found`
// guard below fails on any such dead-end. `/admin/sites` + `/admin/media` were
// REMOVED here (2026-08-16): neither is a registered bare route (only `sites/:id`
// exists; media lived in the reverted admin-v2) so both silently rendered the 404.
const SECTIONS = [
  '/admin',
  '/admin/analytics',
  '/admin/domains',
  '/admin/social',
  '/admin/voice',
  '/admin/billing',
  '/admin/settings',
  '/admin/feature-flags',
  '/admin/seo',
  '/admin/docs',
  '/admin/apps',
  '/admin/mcp',
  '/admin/audit',
  '/admin/snapshots',
  // Real registered sections the prior sweep never covered (coverage expansion):
  '/admin/api-tokens',
  '/admin/forms',
  '/admin/site-features',
  '/admin/deliverability',
  '/admin/logs',
  '/admin/team',
  '/admin/auth-security',
  '/admin/user',
];

test.describe('CHAOS 4 — Power Admin (authed dashboard sweep)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  for (const route of SECTIONS) {
    test(`section ${route} renders alive — no pageerror / 5xx / XSS`, async ({ page }) => {
      const e = trackErrors(page);
      await seedAuth(page, KEY);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500); // Angular lazy chunk + data fetch
      await assertAlive(page);
      // Dead-end guard: a route with no registered child renders the admin
      // not-found component — which assertAlive (text present) passes. This asserts
      // the swept route mounted a REAL section, not the cockpit 404.
      const deadEnd = await page
        .locator('[data-testid="admin-not-found"]')
        .isVisible()
        .catch(() => false);
      expect(deadEnd, `${route} is a DEAD-END — renders the admin 404, not a real section`).toBe(
        false,
      );
      if (
        e.consoleErrors.length ||
        e.pageErrors.length ||
        e.serverErrors.length ||
        e.consoleWarnings.length
      ) {
        console.log(
          `CHAOS4 ${route}:`,
          JSON.stringify({
            err: e.consoleErrors,
            warn: e.consoleWarnings,
            asset404: e.notFoundAssets,
            pageerr: e.pageErrors,
            s5xx: e.serverErrors,
          }),
        );
      }
      expect(await e.xssFired(), `no injected script on ${route}`).toBe(false);
      expect(e.pageErrors, `${route} pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `${route} 5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `${route} console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(
        e.consoleWarnings,
        `${route} console warnings (mission DoD = 0): ${e.consoleWarnings.join('; ')}`,
      ).toEqual([]);
      expect(
        e.notFoundAssets,
        `${route} missing same-origin assets (404): ${e.notFoundAssets.join('; ')}`,
      ).toEqual([]);
    });
  }

  test('settings form: hostile input round-trip does not crash or 5xx', async ({ page }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const inputs = page.locator('input[type="text"], input:not([type]), textarea');
    const n = Math.min(await inputs.count(), 6);
    for (let i = 0; i < n; i++) {
      const inp = inputs.nth(i);
      if (!(await inp.isVisible().catch(() => false))) continue;
      if (await inp.isDisabled().catch(() => true)) continue;
      await inp.fill('<script>window.__xss__=1</script>А'.repeat(50)).catch(() => {});
      await page.waitForTimeout(150);
    }
    await assertAlive(page);
    expect(await e.xssFired(), 'settings did not execute injected script').toBe(false);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });

  test('settings tabs: switching every lazy sub-view stays error-free', async ({ page }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // The settings surface is tabbed; each tab mounts a DISTINCT lazy sub-view
    // (a different data fetch + component). A render-only sweep never enters them
    // — press every tab and assert none logs an app error / warn / 5xx / pageerror.
    const TABS = [
      'Team',
      'AI Chat',
      'MCP',
      'AI Env Vars',
      'Webhooks',
      'Email',
      'Domains',
      'API Tokens',
      'General',
    ];
    let switched = 0;
    for (const label of TABS) {
      const tab = page
        .getByRole('tab', { name: label })
        .or(page.locator(`button:has-text("${label}"), [role="tab"]:has-text("${label}")`))
        .first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click({ timeout: 3000 }).catch(() => {});
      switched++;
      await page.waitForTimeout(600); // lazy chunk + data fetch
      await assertAlive(page);
    }
    console.log(`CHAOS4/settings-tabs switched ${switched}/${TABS.length}`);
    // Selector drift guard: if fewer than 3 tabs were reachable the surface changed.
    expect(switched, 'settings tabs reachable').toBeGreaterThan(2);
    expect(await e.xssFired(), 'no injected script on tab switches').toBe(false);
    expect(e.pageErrors, `tab pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `tab 5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `tab console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(
      e.consoleWarnings,
      `tab console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
    ).toEqual([]);
    expect(e.notFoundAssets, `tab missing assets (404): ${e.notFoundAssets.join('; ')}`).toEqual(
      [],
    );
  });

  // M2 — the one flow the render/interaction sweeps never exercise: mutate real
  // state → navigate away → return → HARD RELOAD → verify PERSISTENCE. Uses AI Env
  // Vars (org-scoped config — the safest reversible CRUD; namespaced test key,
  // deleted via the API in `finally`). Also regression-guards the null-description
  // 400 bug (the form sends description:null for an empty description).
  test('AI Env Vars create → persists across nav + hard reload → cleanup (M2 persistence)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    const testKey = `E2E_PERSIST_${Date.now()}`;
    let createdId: string | null = null;
    try {
      await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const tab = page
        .getByRole('tab', { name: 'AI Env Vars' })
        .or(page.locator('button:has-text("AI Env Vars"), [role="tab"]:has-text("AI Env Vars")'))
        .first();
      await tab.click({ timeout: 4000 });
      await page.waitForTimeout(1500);

      // Create: Add opens the draft form; fill key + value only (no description →
      // the form posts description:null, the exact payload that used to 400).
      await page.locator('button:has-text("Add")').first().click({ timeout: 4000 });
      await page.waitForTimeout(600);
      await page.locator('input[name="key"]').first().fill(testKey);
      await page.locator('input[name="value"]').first().fill('persist-value');
      const createResp = page.waitForResponse(
        (r) => /\/api\/env-vars\b/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 12_000 },
      );
      await page
        .locator('button[type="submit"]')
        .filter({ hasNotText: /cancel/i })
        .first()
        .click({ timeout: 4000 });
      const cr = await createResp;
      expect(cr.status(), 'env var create must 200 (not 400 on null description)').toBe(200);
      const created = (await cr.json().catch(() => ({}))) as { var?: { id?: string } };
      createdId = created.var?.id ?? null;
      await expect(page.locator(`text=${testKey}`).first()).toBeVisible({ timeout: 8000 });

      // Persistence 1 — navigate away, come back, re-open the tab.
      await page.goto('/admin/sites', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await tab.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await expect(
        page.locator(`text=${testKey}`).first(),
        'env var persists after nav-away + back',
      ).toBeVisible({ timeout: 8000 });

      // Persistence 2 — HARD RELOAD (fresh document, no SPA state).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await tab.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await expect(
        page.locator(`text=${testKey}`).first(),
        'env var persists after hard reload',
      ).toBeVisible({ timeout: 8000 });

      await assertAlive(page);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(
        e.consoleWarnings,
        `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
      ).toEqual([]);
    } finally {
      // Always remove the created row (real D1 in the E2E org) — via the API, which
      // avoids the destructive-confirm dialog and never leaves a stray test var.
      if (createdId) {
        await page
          .evaluate(async (id) => {
            const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
            await fetch(`/api/env-vars/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${s.token}` },
            }).catch(() => {});
          }, createdId)
          .catch(() => {});
      }
    }
  });

  // M2 (second real CRUD) — API Tokens, flag-aware. `/api/v1-tokens` is gated on the
  // `public_api` flag; the worker returns 404 when off (doctrine: never 403). Two paths:
  //  • flag OFF (the E2E org's reality) — REGRESSION GUARD: the UI must show the graceful
  //    gate notice and MUST NOT show a create button that 404s. (The frontend detected
  //    flag-off via 503, but the worker returns 404 → the gate was dead code + a dead
  //    create button showed + a scary "Failed to load" toast fired.)
  //  • flag ON — exercise the full create → one-time reveal → persist (nav + hard reload)
  //    → revoke (cleanup via API in finally) round-trip.
  test('API Tokens: flag-off org gets the graceful gate (no dead create button), or full CRUD when enabled', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    let createdId: string | null = null;
    try {
      await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500); // loadTokens() completes → flag state resolved

      const gate = page.locator('[data-testid="api-tokens-flag-gate"]');
      const createBtn = page.locator('[data-testid="at-create-open"]');
      const gateVisible = await gate.isVisible().catch(() => false);

      if (gateVisible) {
        // public_api OFF → the worker 404s the list. The graceful gate notice MUST show
        // and the create button MUST be hidden (never a dead button that 404s on click).
        expect(
          await createBtn.isVisible().catch(() => false),
          'flag-off: create button must be hidden (no dead button that 404s)',
        ).toBe(false);
      } else {
        // public_api ON → full create → reveal → persist → revoke.
        const tokenName = `E2E_CHAOS_${Date.now()}`;
        await createBtn.first().click({ timeout: 5000 });
        await page.waitForTimeout(500);
        await page.locator('[data-testid="at-name-input"]').fill(tokenName);
        const createResp = page.waitForResponse(
          (r) => /\/api\/v1-tokens\b/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 12_000 },
        );
        await page.locator('[data-testid="at-create-submit"]').click({ timeout: 5000 });
        const cr = await createResp;
        expect([200, 201], `token create status ${cr.status()}`).toContain(cr.status());
        const created = (await cr.json().catch(() => ({}))) as { token?: { id?: string } };
        createdId = created.token?.id ?? null;

        await expect(page.locator('[data-testid="at-token-reveal"]')).toBeVisible({
          timeout: 8000,
        });
        const plaintext = await page.locator('[data-testid="at-token-plaintext"]').innerText();
        expect(plaintext.trim().length, 'reveal shows a non-empty token').toBeGreaterThan(10);
        await page.locator('[data-testid="at-reveal-done"]').click({ timeout: 5000 });
        await expect(page.locator(`text=${tokenName}`).first()).toBeVisible({ timeout: 8000 });

        // Persist across nav + HARD reload.
        await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        await expect(page.locator(`text=${tokenName}`).first()).toBeVisible({ timeout: 8000 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        await expect(
          page.locator(`text=${tokenName}`).first(),
          'token persists after hard reload',
        ).toBeVisible({ timeout: 8000 });
      }

      await assertAlive(page);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(
        e.consoleWarnings,
        `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
      ).toEqual([]);
    } finally {
      if (createdId) {
        await page
          .evaluate(async (id) => {
            const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
            await fetch(`/api/v1-tokens/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${s.token}` },
            }).catch(() => {});
          }, createdId)
          .catch(() => {});
      }
    }
  });

  // M2 (third real CRUD) — Team invite → appears in pending → persists → cancel. Validates
  // the iter-102 auth_org hardening (invite-member seat-cap + cancel-invitation) END-TO-END
  // in a real browser. Reversible: the UI Cancel IS the cleanup (soft-deletes the invite); a
  // finally safety-net cancels via API. Seat-aware: at capacity the invite 409s, which the UI
  // shows as a graceful error (also a valid, asserted business result — never a silent success).
  test('Team: invite a member → appears in pending → persists → cancel (M2, validates auth_org)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    const inviteEmail = `e2e-invite-${Date.now()}@example.com`;
    let inviteId: string | null = null;
    // The cancel/remove flows use a native confirm() — auto-accept every dialog.
    page.on('dialog', (d) => d.accept().catch(() => {}));
    try {
      await page.goto('/admin/team', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await expect(page.locator('[data-testid="team-page"]')).toBeVisible({ timeout: 8000 });

      const row = () =>
        page.locator('[data-testid="team-invitation-row"]').filter({ hasText: inviteEmail });

      // The seat line reflects the AUTHORITATIVE cap (iter-102 surfaced the real limit,
      // not a hardcoded default). Check capacity FIRST — at the cap the invite button is
      // disabled by design, so we must NOT try to POST (a disabled click never fires).
      const seatsFull = await page
        .locator('[data-testid="team-seats-full"]')
        .isVisible()
        .catch(() => false);

      if (seatsFull) {
        // At capacity → the invite button MUST be disabled (no dead button that 409s), and
        // the seat line shows the authoritative "N of N" — the graceful, non-lying state.
        await expect(page.locator('[data-testid="team-invite-submit"]')).toBeDisabled();
        await expect(page.locator('[data-testid="team-seats"]')).toContainText(/seats used/i);
      } else {
        await page.locator('[data-testid="team-invite-email"]').fill(inviteEmail);
        const inviteResp = page.waitForResponse(
          (r) =>
            /\/api\/auth\/organization\/invite-member\b/.test(r.url()) &&
            r.request().method() === 'POST',
          { timeout: 12_000 },
        );
        await page.locator('[data-testid="team-invite-submit"]').click({ timeout: 5000 });
        const ir = await inviteResp;

        if (ir.status() === 409) {
          await expect(page.locator('[data-testid="team-error"]')).toBeVisible({ timeout: 6000 });
          await expect(row()).toHaveCount(0);
        } else {
          expect([200, 201], `invite status ${ir.status()}`).toContain(ir.status());
          inviteId = ((await ir.json().catch(() => ({}))) as { id?: string }).id ?? null;

          // Business result: the invite appears in the pending list.
          await expect(row(), 'invite appears in pending').toHaveCount(1, { timeout: 8000 });

          // Persist across nav + HARD reload.
          await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1000);
          await page.goto('/admin/team', { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          await expect(row(), 'invite persists after nav-away + back').toHaveCount(1, {
            timeout: 8000,
          });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          await expect(row(), 'invite persists after hard reload').toHaveCount(1, {
            timeout: 8000,
          });

          // Cancel (the primary reversible action) — the row's Cancel button.
          await row().locator('[data-testid="team-invitation-cancel"]').click({ timeout: 5000 });
          await expect(row(), 'invite removed after cancel').toHaveCount(0, { timeout: 8000 });
          inviteId = null; // cancelled via UI → finally cleanup not needed
        }
      }

      await assertAlive(page);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(
        e.consoleWarnings,
        `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
      ).toEqual([]);
    } finally {
      if (inviteId) {
        await page
          .evaluate(async (id) => {
            const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
            await fetch('/api/auth/organization/cancel-invitation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
              body: JSON.stringify({ invitationId: id }),
            }).catch(() => {});
          }, inviteId)
          .catch(() => {});
      }
    }
  });

  // M2 (third real edit→persist) — Social Auto-Pilot config. The `Auto-Pilot prompt`
  // dialog edits the org-scoped composer config (cadence / prompt / networks) via
  // `POST /api/social/auto-pilot/config` = worker `upsertAutoPilotConfig`, which was
  // hardened iter-107 to THROW on a dropped D1 write instead of returning a lying
  // "saved". This journey proves the round-trip end-to-end: open dialog → change
  // cadence → Save → 200 → HARD RELOAD → reopen → the new cadence PERSISTED. Also
  // presses the AI "Generate preview" button and asserts it never 5xxes. Self-cleaning:
  // restores the original cadence via the API in `finally`.
  test('Social Auto-Pilot: edit cadence → save → persists across hard reload; preview button no 5xx (M2, validates iter-107)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    let original: string | null = null;
    try {
      await page.goto('/admin/social', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000); // Angular lazy chunk + accounts/config/posts fetch

      const openBtn = page.locator('[data-testid="social-auto-pilot-prompt-btn"]');
      await expect(openBtn, 'auto-pilot dialog trigger present').toBeVisible({ timeout: 8000 });
      await openBtn.click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 6000 });

      // The dialog's first <select> is CADENCE. Capture the current value, flip it.
      const cadence = dialog.locator('select').first();
      original = await cadence.inputValue();
      const options = await cadence.locator('option').evaluateAll((os) =>
        (os as HTMLOptionElement[]).map((o) => o.value),
      );
      const target = options.find((o) => o !== original);
      expect(target, 'cadence has ≥2 options to flip between').toBeTruthy();

      await cadence.selectOption(target!);
      const saveResp = page.waitForResponse(
        (r) =>
          /\/api\/social\/auto-pilot\/config/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 12_000 },
      );
      await dialog.getByRole('button', { name: 'Save' }).first().click();
      const sr = await saveResp;
      expect(sr.status(), 'auto-pilot config save must 200 (iter-107: never a lying save)').toBe(
        200,
      );

      // Persistence — HARD RELOAD (fresh document), reopen the dialog, assert the new
      // cadence stuck. This is the real proof the write hit D1, not just optimistic UI.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await openBtn.click({ timeout: 8000 });
      await expect(dialog).toBeVisible({ timeout: 6000 });
      const after = await dialog.locator('select').first().inputValue();
      expect(after, 'cadence persisted across hard reload').toBe(target);

      // Press the AI "Generate preview" button — a meaningful action that calls the
      // model. It may take a while or degrade gracefully (0 connected accounts), but
      // it must NEVER 5xx. We don't block on the (slow) LLM response.
      const preview = dialog.getByRole('button', { name: 'Generate preview' });
      if (await preview.isVisible().catch(() => false)) {
        await preview.click().catch(() => {});
        await page.waitForTimeout(2500);
      }

      await assertAlive(page);
      expect(await e.xssFired(), 'no injected script on the auto-pilot flow').toBe(false);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
        [],
      );
    } finally {
      // Restore the original cadence via the API (org-scoped, bearer-authed) so the
      // shared E2E org is left exactly as found — no destructive dialog needed.
      if (original) {
        const hours = Number(original.split(':').pop()?.trim());
        if (Number.isFinite(hours)) {
          await page
            .evaluate(async (h) => {
              const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
              await fetch('/api/social/auto-pilot/config', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${s.token}`,
                },
                body: JSON.stringify({ cadence_hours: h }),
              }).catch(() => {});
            }, hours)
            .catch(() => {});
        }
      }
    }
  });

  // M2 — the Social composer's honest-validation + draft-preservation contract.
  // The E2E org has 0 connected accounts, so "Post now" cannot publish. Pressing it
  // must give HONEST feedback ("select a platform") — not a dead button, not a 5xx —
  // and must NOT wipe the draft the user just typed (a failed submit preserves work).
  // "Discard" then clears the composer. Presses 2 real compose buttons + asserts the
  // business result of each, with the full console/network DoD.
  test('Social composer: Post-now with no platform validates honestly + preserves the draft; Discard clears it (M2)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/social', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const composer = page.locator('[data-testid="social-composer-textarea"]');
    await expect(composer, 'composer textarea present').toBeVisible({ timeout: 8000 });
    const draft = 'Grand opening this Saturday — fresh coffee on the house. See you there!';
    await composer.fill(draft);

    // Press "Post now" with no platform selected (0 connected accounts).
    await page.getByRole('button', { name: 'Post now', exact: false }).first().click();
    await page.waitForTimeout(2500);

    // Business result: honest validation message (not a dead button, not a silent no-op).
    await expect(
      page.locator('text=/select .* platform|connect .* account|at least one/i').first(),
      'Post-now with no platform shows an honest "select a platform" message',
    ).toBeVisible({ timeout: 6000 });
    // Draft preserved — a failed submit must not wipe the user's typed content.
    expect(await composer.inputValue(), 'composer draft survives a failed post').toBe(draft);

    // "Discard" is an action-armed confirm toast (cockpit pattern), not a one-click
    // wipe: pressing it prompts "Discard this post?" with a Discard action that runs
    // resetComposer(). Press it, confirm via the toast action, assert the draft clears.
    await page.getByRole('button', { name: 'Discard', exact: false }).first().click();
    const confirmToast = page
      .locator('[data-testid="toast-item"]')
      .filter({ hasText: /discard this post/i });
    await expect(confirmToast, 'Discard prompts an action-armed confirm toast').toBeVisible({
      timeout: 6000,
    });
    await confirmToast.locator('button.toast-action').first().click();
    await expect(composer, 'confirming Discard clears the composer draft').toHaveValue('', {
      timeout: 6000,
    });

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script in the composer flow').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  // M2 — cross-device display-name PERSISTENCE (the read-back half). The name saves
  // to BOTH the server (PATCH /api/admin/profile) + localStorage (local-first). The
  // server value must ALSO drive the UI on a FRESH device where localStorage is empty
  // — else the saved name silently reverts to the email-derived default (the server
  // has it, the UI never reads it). Presses Save, asserts the PATCH 2xx + "Saved"
  // affordance + heading, then a local-first reload, then simulates a new device
  // (clears the local cache) and asserts the reload shows the SAVED name from
  // /api/auth/me — not "Test". Restores the original server name in `finally`.
  test('User profile: display name round-trips to the server + shows on a fresh device (M2 persistence)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);

    // App-context fetch (real browser fingerprint → not Bot-Fight challenged, unlike
    // Playwright's `request`) to read + restore the server-persisted name.
    const readServerName = (): Promise<string | null> =>
      page.evaluate(async () => {
        const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
        const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${s.token}` } });
        const j = (await r.json().catch(() => ({}))) as { data?: { display_name?: string | null } };
        return j?.data?.display_name ?? null;
      });
    const patchServerName = (name: string): Promise<void> =>
      page.evaluate(async (nm) => {
        const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
        await fetch('/api/admin/profile', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nm }),
        }).catch(() => {});
      }, name);

    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const originalName = await readServerName();
    const testName = 'Chaos QA Persist ✓';

    try {
      const input = page.locator('[data-testid="us-display-name-input"]');
      await expect(input, 'display-name input present').toBeVisible({ timeout: 8000 });
      await input.fill(testName);

      const save = page.locator('[data-testid="us-display-name-save"]');
      await expect(save, 'Save enables for a valid name').toBeEnabled({ timeout: 4000 });
      const [patchResp] = await Promise.all([
        page.waitForResponse(
          (r) => /\/api\/admin\/profile\b/.test(r.url()) && r.request().method() === 'PATCH',
          { timeout: 15_000 },
        ),
        save.click(),
      ]);
      expect(patchResp.status(), 'profile PATCH persists to the server (2xx)').toBeLessThan(300);

      // Business result: the "Saved" affordance + the heading updates immediately.
      await expect(
        page.locator('[data-testid="us-display-name-saved"]'),
        'shows the Saved confirmation (no silent save)',
      ).toBeVisible({ timeout: 6000 });
      await expect(
        page.locator('[data-testid="us-display-name-heading"]'),
        'heading reflects the new name',
      ).toHaveText(testName, { timeout: 6000 });

      // Local-first persistence: a hard reload (localStorage intact) keeps the name.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await expect(
        page.locator('[data-testid="us-display-name-heading"]'),
        'name survives a hard reload (local-first)',
      ).toHaveText(testName, { timeout: 8000 });

      // FRESH DEVICE: clear ONLY the local display-name cache (auth stays). The saved
      // name must come back from the server (/api/auth/me), NOT revert to the email
      // default — this is the read-back half the write-only PATCH left incomplete.
      await page.evaluate(() => localStorage.removeItem('ps_display_name'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await expect(
        page.locator('[data-testid="us-display-name-heading"]'),
        'saved name shows on a fresh device from the server (not the email-derived default)',
      ).toHaveText(testName, { timeout: 8000 });

      await assertAlive(page);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    } finally {
      // Restore the original server name (or a neutral default) so the account stays clean.
      const restore = originalName && originalName.trim() && originalName !== testName ? originalName : 'Test';
      await patchServerName(restore);
    }
  });

  // M3 — notification prefs cross-device round-trip (FE toggle → debounced POST
  // /api/admin/notifications → per-user memory store → GET-hydrate on a fresh
  // device). Presses the real "Weekly summary" switch, asserts the POST 2xx + the
  // immediate flip, then a local-first reload, then simulates a NEW device (clears
  // the local cache) and waits for the hydrate GET to prove the SERVER value drives
  // the UI — not the localStorage-seeded default. Restores the state in finally.
  test('User notifications: toggle round-trips to the server + shows on a fresh device (M3)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const swName = /Weekly summary/i;
    const sw = page.getByRole('switch', { name: swName });
    await expect(sw, 'the Weekly-summary notification switch is present').toBeVisible({
      timeout: 8000,
    });
    const original = await sw.getAttribute('aria-checked');
    const flipped = original === 'true' ? 'false' : 'true';

    const flipAndSync = async (): Promise<void> => {
      const [postResp] = await Promise.all([
        page.waitForResponse(
          (r) => /\/api\/admin\/notifications\b/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 15_000 },
        ),
        page.getByRole('switch', { name: swName }).click(),
      ]);
      expect(postResp.status(), 'notification pref POST persists to the server (2xx)').toBeLessThan(
        300,
      );
    };

    try {
      await flipAndSync();
      await expect(sw, 'switch reflects the flipped state immediately').toHaveAttribute(
        'aria-checked',
        flipped,
        { timeout: 4000 },
      );

      // Local-first: a hard reload (localStorage intact) keeps the flipped state.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await expect(
        page.getByRole('switch', { name: swName }),
        'flipped state survives a hard reload (local-first)',
      ).toHaveAttribute('aria-checked', flipped, { timeout: 8000 });

      // FRESH DEVICE: clear ONLY the local pref cache (auth stays). The flipped
      // state must return from the server (per-user memory store) via the hydrate
      // GET — NOT revert to the localStorage-seeded default (which is `true`).
      await page.evaluate(() => localStorage.removeItem('ps_notification_prefs'));
      await Promise.all([
        page.waitForResponse(
          (r) => /\/api\/admin\/notifications\b/.test(r.url()) && r.request().method() === 'GET',
          { timeout: 15_000 },
        ),
        page.reload({ waitUntil: 'domcontentloaded' }),
      ]);
      await expect(
        page.getByRole('switch', { name: swName }),
        'flipped state hydrates from the server on a fresh device (not the default)',
      ).toHaveAttribute('aria-checked', flipped, { timeout: 8000 });

      await assertAlive(page);
      expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    } finally {
      // Restore the original toggle state (flip back) so the account stays clean.
      const cur = await page
        .getByRole('switch', { name: swName })
        .getAttribute('aria-checked')
        .catch(() => null);
      if (cur !== null && cur !== original) {
        await flipAndSync().catch(() => {});
      }
    }
  });

  // M4 — destructive-action guard. The "Delete account" flow must NOT be able to
  // fire without the EXACT confirmation phrase. Opens the dialog, asserts the
  // confirm button is disabled, types a WRONG phrase (stays disabled, no ready
  // state), types the CORRECT phrase (enables + ready), then CANCELS — NEVER
  // clicking "Delete forever" (the E2E account must survive). A guard that enabled
  // without the phrase would be a catastrophic irreversible data-loss bug.
  test('User delete-account: destructive guard requires the exact phrase; Cancel is safe (M4)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.locator('[data-testid="delete-account-button"]').click();
    const input = page.locator('[data-testid="delete-account-confirm-input"]');
    const confirmBtn = page.locator('[data-testid="delete-account-confirm"]');
    await expect(input, 'confirm dialog opened').toBeVisible({ timeout: 6000 });

    // Guard 1: disabled with no phrase.
    await expect(confirmBtn, 'Delete is disabled before any phrase').toBeDisabled();

    // Guard 2: a WRONG phrase keeps it disabled + shows no ready state.
    await input.fill('delete');
    await expect(confirmBtn, 'Delete stays disabled on a wrong phrase').toBeDisabled();
    await expect(
      page.locator('[data-testid="delete-confirm-ready"]'),
      'no ready state on a wrong phrase',
    ).toHaveCount(0);

    // Exact phrase: enables + shows the ready affordance.
    await input.fill('delete my account');
    await expect(confirmBtn, 'Delete enables only on the exact phrase').toBeEnabled({
      timeout: 4000,
    });
    await expect(
      page.locator('[data-testid="delete-confirm-ready"]'),
      'ready affordance shows on the exact phrase',
    ).toBeVisible({ timeout: 4000 });

    // NEVER click "Delete forever". Cancel — the account must survive.
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    await expect(input, 'Cancel closes the dialog').toHaveCount(0, { timeout: 4000 });

    // Prove the account is intact: reload /admin/user, still authed + profile renders.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(
      page.locator('[data-testid="us-profile-card"]'),
      'account still exists + admin still authed after the guarded (cancelled) delete',
    ).toBeVisible({ timeout: 8000 });

    await assertAlive(page);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
  });
});
