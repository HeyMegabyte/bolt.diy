/**
 * CHAOS 3 — "The Locked-Out User": auth + access control.
 *
 * Homepage-first → sign-in. Feeds magic-link hostile emails, checks the OAuth
 * entry, and asserts protected routes bounce an UNauthed caller (no sensitive
 * data leaks to an unauthenticated session).
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth, EVIL } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 3 — Locked-Out User (auth + access control)', () => {
  test('sign-in page renders from homepage, shell alive, no app errors', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/');
    await page.goto('/signin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await assertAlive(page);
    console.log('CHAOS3/signin console:', JSON.stringify(e.consoleErrors));
    console.log('CHAOS3/signin warn   :', JSON.stringify(e.consoleWarnings));
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  test('magic-link input rejects/handles hostile emails without crash or XSS', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/signin');
    await page.waitForTimeout(1500);
    const email = page
      .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
      .first();
    if (await email.isVisible().catch(() => false)) {
      for (const evil of [
        '',
        'notanemail',
        EVIL.xssScript,
        `${EVIL.xssImg}@x.com`,
        EVIL.sqli,
        'a@a',
      ]) {
        await email.fill(evil).catch(() => {});
        await page.keyboard.press('Tab').catch(() => {});
        await page.waitForTimeout(200);
        await assertAlive(page);
      }
    }
    expect(await e.xssFired(), 'no injected script executed on the sign-in form').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });

  test('magic-link API never 5xx on hostile email (validation, not crash)', async ({ request }) => {
    for (const bad of ['', 'notanemail', EVIL.xssScript, EVIL.sqli, 'a@a']) {
      const r = await request
        .post('https://projectsites.dev/api/auth/magic-link', {
          data: { email: bad },
          failOnStatusCode: false,
          timeout: 15_000,
        })
        .catch(() => null);
      if (r)
        expect(r.status(), `magic-link "${bad.slice(0, 15)}" → ${r.status()}`).toBeLessThan(500);
    }
  });

  test('UNauthed protected routes do not leak — bounce or empty, never real data', async ({
    page,
  }) => {
    // No ps_session seeded. /admin etc. must NOT render authed content.
    for (const route of ['/admin', '/admin/billing', '/admin/settings', '/editor']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      await assertAlive(page);
      // Should have bounced to signin OR shown a gate — assert no obvious authed
      // artifacts (a real sites table / analytics numbers) are visible.
      const url = page.url();
      const leaked = await page
        .locator(
          '[data-testid="sites-table"], [data-testid="admin-analytics"], text=/Monthly recurring/i',
        )
        .first()
        .isVisible()
        .catch(() => false);
      expect(leaked, `unauthed ${route} leaked authed content (url=${url})`).toBe(false);
    }
  });

  test('OAuth start endpoint issues a redirect (302), not a 5xx', async ({ request }) => {
    const r = await request
      .get('https://projectsites.dev/api/auth/google', {
        maxRedirects: 0,
        failOnStatusCode: false,
        timeout: 15_000,
      })
      .catch(() => null);
    // 302 to Google, or 200/4xx if disabled — just never a 5xx (null = network/timeout, tolerate).
    if (r) expect(r.status()).toBeLessThan(500);
  });

  // M3 — the "Active sessions" panel on /admin/auth-security reconciles with the
  // LIVE `sessions` table via GET /api/auth/list-sessions (a per-user security
  // surface: see + revoke your active sessions). This is a cross-system journey
  // (SPA ↔ auth middleware ↔ D1 sessions) AND a regression guard for the
  // better_auth-swallow class: those legacy `/api/auth/*` paths are shadowed if
  // the better_auth middleware turns ON without allowlisting them, silently
  // 404-ing the panel to "unavailable" for every real user.
  test('M3: /admin/auth-security sessions panel is reachable + not lying-unavailable (list-sessions 200, refresh re-fires)', async ({
    page,
  }) => {
    test.skip(!KEY, 'E2E_API_KEY not set');
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    // A 404 here = the legacy path was swallowed → panel dead for every user.
    const listResp = page
      .waitForResponse((r) => r.url().includes('/api/auth/list-sessions'), { timeout: 20_000 })
      .catch(() => null);
    await page.goto('/');
    await page.goto('/admin/auth-security', { waitUntil: 'domcontentloaded' });
    const first = await listResp;
    expect(
      first?.status(),
      'GET /api/auth/list-sessions must be 200, not 404-swallowed by the better_auth middleware',
    ).toBe(200);
    await page.waitForTimeout(3000);
    await assertAlive(page);
    await expect(page.locator('[data-testid="auth-security-page"]')).toBeVisible({
      timeout: 10_000,
    });

    // The panel renders exactly one valid state — never a crash.
    const listShown = await page
      .locator('[data-testid="as-sessions-list"]')
      .isVisible()
      .catch(() => false);
    const emptyShown = await page
      .locator('[data-testid="as-sessions-empty"]')
      .isVisible()
      .catch(() => false);
    const unavailShown = await page
      .locator('[data-testid="as-sessions-unavailable"]')
      .isVisible()
      .catch(() => false);
    expect(
      listShown || emptyShown || unavailShown,
      'sessions panel shows a valid state (list / empty / unavailable)',
    ).toBe(true);
    // A 200 array must NOT render the "unavailable" fallback — that's reserved for a
    // non-array/stale body. Showing "unavailable" over a working 200 = a lying panel.
    expect(
      unavailShown,
      'list-sessions returned 200 but the panel showed "unavailable" (lying-unavailable over a working endpoint)',
    ).toBe(false);

    // Refresh must re-fire list-sessions (the panel is live, not a one-shot render).
    const refreshResp = page
      .waitForResponse((r) => r.url().includes('/api/auth/list-sessions'), { timeout: 15_000 })
      .catch(() => null);
    await page
      .locator('[data-testid="as-sessions-refresh"]')
      .first()
      .click()
      .catch(() => {});
    const refreshed = await refreshResp;
    expect(refreshed?.status(), 'refresh re-fires list-sessions 200').toBe(200);

    // The 2FA enrollment entry point is present (not a dead/missing control).
    await expect(page.locator('[data-testid="as-2fa-enroll"]')).toBeVisible();

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  // M3 — /admin/billing plan/entitlement reconciliation (cross-system: SPA ↔ billing
  // service ↔ D1 subscriptions). The plan LABEL (from GET /billing/subscription) and the
  // entitlement CHIPS (from GET /billing/entitlements) must tell the SAME story. Both
  // derive the effective plan through the shared status gate `status IN ('active',
  // 'trialing')` (server SSOT `resolveActiveOrgPlan`; the frontend mirrors it). This is a
  // regression guard for the trialing-drift class: a prior active-ONLY gate on either side
  // made a TRIALING paid subscriber show a "Free" label beside PAID entitlement chips (10
  // domains + analytics Included) — a visible lying-UI divergence. It also proves the
  // entitlements endpoint is LIVE (not dark/404) and returns a self-consistent bundle.
  test('M3: /admin/billing plan label + entitlement chips reconcile (no trialing-drift divergence, endpoint live)', async ({
    page,
  }) => {
    test.skip(!KEY, 'E2E_API_KEY not set');
    const e = trackErrors(page);
    await seedAuth(page, KEY);

    // A 404/5xx here = the entitlements endpoint is dark → chips would render blank/stale.
    const entResp = page
      .waitForResponse((r) => r.url().includes('/api/billing/entitlements'), { timeout: 20_000 })
      .catch(() => null);
    await page.goto('/');
    await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
    const ent = await entResp;
    expect(ent?.status(), 'GET /api/billing/entitlements must be 200 (live, not dark/404)').toBe(
      200,
    );

    // Endpoint self-consistency: getEntitlements(plan) is a deterministic bundle — the three
    // grants must agree on paid-vs-free (analytics on ⟺ >0 custom domains ⟺ >1 seat).
    const body = (await ent!.json().catch(() => ({}))) as {
      data?: { maxCustomDomains?: number; maxTeamSeats?: number; analyticsEnabled?: boolean };
    };
    const d = body.data ?? {};
    const endpointPaid = !!d.analyticsEnabled;
    expect(
      (d.maxCustomDomains ?? 0) > 0,
      `entitlements bundle incoherent: analytics=${d.analyticsEnabled} but customDomains=${d.maxCustomDomains}`,
    ).toBe(endpointPaid);
    expect(
      (d.maxTeamSeats ?? 0) > 1,
      `entitlements bundle incoherent: analytics=${d.analyticsEnabled} but seats=${d.maxTeamSeats}`,
    ).toBe(endpointPaid);

    await page.waitForTimeout(3000);
    await assertAlive(page);
    await expect(page.locator('[data-testid="subscription-card"]')).toBeVisible({
      timeout: 10_000,
    });

    // DISPLAY reconciliation — the plan LABEL and the analytics CHIP must agree, and both
    // must match the endpoint. Before the fix a trialing sub showed 'Free' + 'Included'.
    const planText = (
      (await page.locator('[data-testid="subscription-plan"]').first().textContent()) ?? ''
    ).trim();
    const analyticsChip = (
      (await page.locator('[data-testid="entitlement-analytics"]').first().textContent()) ?? ''
    ).trim();
    const labelPaid = /Pro|\$50/i.test(planText);
    const chipPaid = /Included/i.test(analyticsChip);

    expect(
      labelPaid,
      `plan LABEL ("${planText}") disagrees with analytics CHIP ("${analyticsChip}") — trialing-drift lying-UI divergence`,
    ).toBe(chipPaid);
    expect(
      chipPaid,
      `analytics CHIP ("${analyticsChip}") disagrees with entitlements ENDPOINT (analyticsEnabled=${d.analyticsEnabled})`,
    ).toBe(endpointPaid);

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  // M3 — /admin/deliverability is a cross-system integration: the SPF/DKIM/DMARC wizard
  // resolves LIVE DNS for the entered domain via GET /api/sites/:id/deliverability. Guards
  // two things at once: (1) the integration is LIVE (a configured domain scores > 0 and
  // renders the SPF/DKIM/DMARC breakdown), and (2) it reflects REAL DNS — a NONEXISTENT
  // domain MUST score 0. A regression to a lying constant (an always-100 stub) would pass a
  // naive "renders a score" check but FAIL the nonexistent→0 tripwire ([[verify-against-source-of-truth]]).
  test('M3: /admin/deliverability resolves real DNS (configured domain scores; nonexistent → 0, not a lying constant)', async ({
    page,
  }) => {
    test.skip(!KEY, 'E2E_API_KEY not set');
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/');
    await page.goto('/admin/deliverability', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await assertAlive(page);

    const input = page.locator('[data-testid="deliverability-domain"]');
    const btn = page.locator('[data-testid="deliverability-check-btn"]');
    // Flag-off (email_deliverability_wizard) renders a calm gate, not the input — skip then.
    test.skip(
      !(await input.isVisible().catch(() => false)),
      'deliverability wizard flag off (calm gate) — nothing to drive',
    );

    const runCheck = async (domain: string): Promise<{ status: number; score: number }> => {
      await input.fill('');
      await input.fill(domain);
      await page.waitForTimeout(400);
      const respP = page
        .waitForResponse((r) => /\/deliverability\?/.test(r.url()), { timeout: 20_000 })
        .catch(() => null);
      await btn.click().catch(() => {});
      const resp = await respP;
      await page.waitForTimeout(1500);
      const scoreText = (
        (await page
          .locator('[data-testid="deliverability-score"]')
          .first()
          .textContent()
          .catch(() => '')) ?? ''
      ).trim();
      return { status: resp?.status() ?? 0, score: Number.parseInt(scoreText || 'NaN', 10) };
    };

    // (1) A configured, real sending domain resolves LIVE (200) and scores > 0, with the
    //     SPF / DKIM / DMARC breakdown rendered.
    const configured = await runCheck('megabyte.space');
    expect(configured.status, 'deliverability check must be 200 (live integration)').toBe(200);
    expect(configured.score, 'a configured domain must score > 0').toBeGreaterThan(0);
    await expect(page.locator('[data-testid="deliverability-result"]')).toBeVisible();
    for (const tid of ['deliverability-spf', 'deliverability-dkim', 'deliverability-dmarc']) {
      await expect(page.locator(`[data-testid="${tid}"]`)).toBeVisible();
    }

    // (2) THE anti-lying-constant tripwire: a nonexistent domain has no DNS → MUST score 0.
    //     An always-100 stub (or a check that ignores the domain) would fail here.
    const missing = await runCheck('nonexistent-zzz-9182734-chaos.com');
    expect(missing.status, 'nonexistent-domain check still 200 (graceful)').toBe(200);
    expect(
      missing.score,
      `a nonexistent domain must score 0 (got ${missing.score}) — a nonzero score means a lying constant, not real DNS`,
    ).toBe(0);

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  // M1/M4 — Better Auth's captcha plugin gates email+password sign-in on a Turnstile
  // token the /signin form renders no widget for → a raw password submit returns
  // "Missing CAPTCHA response". The UI must GUIDE the user to a live method (magic-link
  // / OAuth) instead of stranding them on that cryptic dead-end. This also proves the
  // passwordless path is live so the auth journey is never fully dead.
  test('M1/M4: password sign-in degrades to actionable magic-link guidance (no captcha dead-end)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await page.goto('/');
    // Reach /signin via the header Sign In control (real navigation), fall back to a
    // direct visit if the control moved.
    await page
      .getByRole('button', { name: /^sign in$/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);
    if (!page.url().includes('/signin')) await page.goto('/signin');

    await page.getByTestId('sign-in-email').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('sign-in-email').fill('chaos-pw@example.com');
    await page.getByTestId('sign-in-password').fill('Some-Password-12345');
    await page.getByTestId('sign-in-submit').click();

    // The dead-end is now graceful degradation → the user is steered to a working path.
    await expect(page.getByText(/magic link/i).first()).toBeVisible({ timeout: 10_000 });
    const pageText = await page.evaluate(() => document.body.innerText);
    expect(pageText, 'the raw captcha error must never reach the user').not.toContain(
      'Missing CAPTCHA response',
    );

    // The live passwordless path works (in-page fetch carries the WAF cf_clearance a
    // raw request context lacks) → the auth journey is never fully dead. Bound the fetch
    // (AbortSignal.timeout) so a tarpit stall fails FAST here, not at the test ceiling.
    const mlStatus = await page.evaluate(async () => {
      try {
        const r = await fetch('https://projectsites.dev/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `chaos-ml-${Date.now()}@example.com` }),
          // Generous bound (endpoint is ~1-2s direct): tolerates a slow email-provider
          // blip, but a genuine rate-limit-tarpit STALL fails fast here (→0) instead of
          // hanging to the 60s test ceiling.
          signal: AbortSignal.timeout(30_000),
        });
        return r.status;
      } catch {
        return 0; // aborted/network — surfaced as a distinct, non-hanging failure below
      }
    });
    // 200 = sent. 429 = the per-IP rate limiter kicked in (this suite hammers auth under
    // full-parallel load) — that's HONEST backpressure, NOT a dead-end (the path is alive,
    // temporarily throttled). A dead-end would be a 5xx / 4xx-that-blocks-all-users / a
    // hang (→0), all of which still fail here.
    expect(
      [200, 429],
      `magic-link (the live passwordless path) must be alive — 200 (sent) or 429 (rate-limited backpressure); got ${mlStatus}`,
    ).toContain(mlStatus);

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });
});
