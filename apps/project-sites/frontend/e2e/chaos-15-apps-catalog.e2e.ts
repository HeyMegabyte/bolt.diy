/**
 * CHAOS 15 — "The App Curator": the /admin/apps catalog + app detail deploy surface.
 *
 * iter-151 named apps catalog/install/instances an under-probed surface (rich
 * testid-mapped UI, ZERO E2E). This spec drives EVERY actionable element of the
 * catalog as two long stitched customer journeys — per the loop doctrine a master
 * test mutates, navigates away, returns, and asserts the business result at each
 * step (here: the filtered grid, not the endpoint).
 *
 * Journey 1 — Catalog: render → search → Esc-clear → lifecycle pills (All/Live/
 * Coming soon) → composite search+lifecycle → category multi-select union →
 * clear → card → detail (h2, features, deploy surface) → pager next → back →
 * tag pill round-trip (detail tag → catalog chip → clear) → absurd search →
 * empty state → reset. Every filter control is pressed AND its grid result
 * asserted (card counts are deterministic — 9 apps: 4 live, 5 soon, 7 categories).
 *
 * Journey 2 — Deploy surface: live app (deploy CTA + env/subdomain form, values
 * persist — the deploy button itself is NEVER clicked: it provisions real
 * container infra) → coming-soon app (honest disabled contract, no CTA) →
 * AI recommends navigation → pager prev/next cycling.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-15-apps-catalog
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

/** Screenshot a journey milestone (visual inspection evidence; failures tolerated). */
async function snap(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/chaos-15/${name}.png`, fullPage: true })
    .catch(() => {});
}

/** Card count assertion helper — deterministic, not the rolling counter. */
async function expectCards(page: import('@playwright/test').Page, n: number, msg: string) {
  await expect(page.locator('[data-testid^="apps-card-"]'), msg).toHaveCount(n, {
    timeout: 10_000,
  });
}

/** The full error gate shared by every journey end. */
async function expectClean(e: Awaited<ReturnType<typeof trackErrors>>) {
  expect(await e.xssFired(), 'no injected script fired').toBe(false);
  expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
  expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
  expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
    [],
  );
}

test.describe('CHAOS 15 — Apps catalog + detail (every filter pressed, every result asserted)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('Catalog master journey — search → lifecycle → categories → card → detail → pager → tag chip → empty state → reset', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    // ── Render: the full catalog, with its header pill and grid semantics. ──
    await expect(page.locator('[data-testid="apps-card-umami"]'), 'catalog renders').toBeVisible({
      timeout: 20_000,
    });
    await expectCards(page, 9, 'all 9 apps render');
    await expect(page.locator('[aria-label="Catalog size"]'), 'header pill shows catalog size').toContainText(
      '9',
    );
    await expect(page.locator('[role="list"][aria-label="App catalog"]'), 'grid is a labelled list').toBeVisible();
    // Lifecycle badges on cards (live vs soon) render with the card, not only after filtering.
    await expect(page.locator('[data-testid="apps-pill-live-umami"]'), 'umami is Live-badged').toBeVisible();
    await expect(page.locator('[data-testid="apps-pill-soon-lobe-chat"]'), 'lobe-chat is Soon-badged').toBeVisible();
    await expect(page.locator('[data-testid="apps-installs-umami"]'), 'install count renders').toBeVisible();
    await snap(page, '01-catalog-initial');

    // ── Search: narrows to exactly the match, replaces on re-type. ──
    const search = page.locator('[data-testid="apps-search-input"]');
    await search.fill('listmonk');
    await expectCards(page, 1, 'search "listmonk" → 1 card');
    await expect(page.locator('[data-testid="apps-card-listmonk"]'), 'the match is listmonk').toBeVisible();
    await expect(page.locator('[data-testid="apps-result-status"]'), 'sr-only live region announces the count').toContainText(
      '1',
    );
    await snap(page, '02-search-listmonk');

    await search.fill('open-webui');
    await expectCards(page, 1, 're-typing replaces the filter (open-webui)');
    await expect(page.locator('[data-testid="apps-card-open-webui"]'), 'the match is open-webui').toBeVisible();
    await expect(page.locator('[data-testid="apps-card-listmonk"]'), 'old match gone').toHaveCount(0);

    await search.press('Escape');
    await expectCards(page, 9, 'Esc clears the search');
    await expect(search, 'input value cleared').toHaveValue('');

    // ── Lifecycle pills: tab semantics + exact subsets. ──
    const soon = page.locator('[data-testid="apps-lifecycle-soon"]');
    const live = page.locator('[data-testid="apps-lifecycle-live"]');
    const all = page.locator('[data-testid="apps-lifecycle-all"]');
    await expect(soon, 'soon pill is a tab').toHaveAttribute('role', 'tab');
    await soon.click();
    await expect(soon, 'soon pill selected').toHaveAttribute('aria-selected', 'true');
    await expectCards(page, 5, 'Coming soon → 5 apps');
    await expect(page.locator('[data-testid="apps-card-lobe-chat"]'), 'soon app present').toBeVisible();
    await expect(page.locator('[data-testid="apps-card-umami"]'), 'live app hidden under soon').toHaveCount(0);
    await snap(page, '03-lifecycle-soon');

    await live.click();
    await expect(live, 'live pill selected').toHaveAttribute('aria-selected', 'true');
    await expect(soon, 'soon pill deselected').toHaveAttribute('aria-selected', 'false');
    await expectCards(page, 4, 'Live → 4 apps');
    await expect(page.locator('[data-testid="apps-card-umami"]'), 'live app present').toBeVisible();
    await expect(page.locator('[data-testid="apps-card-langflow"]'), 'soon app hidden under live').toHaveCount(0);

    // Composite: lifecycle + search stack (union of constraints).
    await search.fill('umami');
    await expectCards(page, 1, 'live ∩ "umami" → 1');
    await search.press('Escape');
    await expectCards(page, 4, 'Esc restores the live-only view');
    await all.click();
    await expectCards(page, 9, 'All restores the full catalog');
    await expect(search, 'input still empty after composite clears').toHaveValue('');

    // ── Category multi-select: menu open/close, union-filter, badge, clear. ──
    const catTrigger = page.locator('[data-testid="apps-category-filter"]');
    const catMenu = page.locator('[data-testid="apps-category-menu"]');
    await catTrigger.click();
    await expect(catTrigger, 'menu open state exposed').toHaveAttribute('aria-expanded', 'true');
    await expect(catMenu, 'category menu renders').toBeVisible();
    // All 7 categories render as checkboxes.
    for (const c of ['analytics', 'knowledge', 'productivity', 'marketing', 'ai', 'agent-platform', 'ai-ops']) {
      await expect(page.locator(`[data-testid="apps-category-opt-${c}"]`), `category option ${c}`).toBeVisible();
    }

    await page.locator('[data-testid="apps-category-opt-analytics"]').check();
    await expectCards(page, 1, 'category analytics → 1 app (umami)');
    await expect(page.locator('[data-testid="apps-card-umami"]'), 'umami is the analytics app').toBeVisible();

    await page.locator('[data-testid="apps-category-opt-ai"]').check();
    await expectCards(page, 3, 'categories UNION (analytics + ai → 3)');
    await expect(page.locator('[data-testid="apps-card-open-webui"]'), 'ai app in union').toBeVisible();
    await expect(page.locator('[data-testid="apps-card-lobe-chat"]'), 'ai app in union').toBeVisible();
    await snap(page, '04-category-union');

    await page.locator('[data-testid="apps-category-clear"]').click();
    await expectCards(page, 9, 'category Clear restores all 9');
    await page.locator('button[aria-label="Close category filter"]').click();
    await expect(catMenu, 'menu closes via backdrop').toHaveCount(0);
    await expect(catTrigger, 'closed state exposed').toHaveAttribute('aria-expanded', 'false');

    // ── Card → detail: the catalog's primary action. ──
    await page.locator('[data-testid="apps-card-umami"]').click();
    await expect(page, 'navigates to the app detail route').toHaveURL(/\/admin\/apps\/umami$/);
    await expect(page.locator('h2.section-h'), 'detail h2 is the app name').toHaveText('Umami');
    await expect(page.locator('[data-testid="apps-feature-list"]'), 'feature list renders').toBeVisible();
    await expect(page.locator('[data-testid="apps-ai-recommends"]'), 'AI recommends section renders').toBeVisible();
    await expect(page.locator('[data-testid="apps-pager"]'), 'pager renders').toBeVisible();
    await snap(page, '05-detail-umami');

    // Pager: first app has no prev, next lands on the advertised app.
    await expect(page.locator('[data-testid^="apps-prev-"]'), 'first app has no previous').toHaveCount(0);
    const nextLink = page.locator('[data-testid^="apps-next-"]').first();
    const nextId = (await nextLink.getAttribute('data-testid'))!.replace('apps-next-', '');
    await nextLink.click();
    await expect(page, 'pager next lands on the advertised app').toHaveURL(new RegExp(`/admin/apps/${nextId}$`));
    await expect(page.locator('h2.section-h'), 'detail h2 changed').not.toHaveText('Umami');

    // ←/→ keyboard nav: the same prev/next contract without a pointer.
    await page.keyboard.press('ArrowLeft');
    await expect(page, 'ArrowLeft returns to the previous app').toHaveURL(/\/admin\/apps\/umami$/);
    await expect(page.locator('h2.section-h'), 'umami h2 restored via keyboard').toHaveText('Umami');
    await page.keyboard.press('ArrowRight');
    await expect(page, 'ArrowRight advances to the next app').toHaveURL(new RegExp(`/admin/apps/${nextId}$`));

    // Back link returns to the catalog (list state intact).
    await page.locator('a.back-link').click();
    await expect(page, 'back link returns to the catalog').toHaveURL(/\/admin\/apps$/);
    await expectCards(page, 9, 'catalog intact after the detail round-trip');

    // ── Tag round-trip: detail tag pill → catalog chip filter → clear chip. ──
    await page.locator('[data-testid="apps-card-umami"]').click();
    const tagPill = page.locator('[data-testid^="apps-detail-tag-"]').first();
    const tagAria = await tagPill.getAttribute('aria-label'); // "Find apps tagged X"
    const tag = tagAria!.replace('Find apps tagged ', '');
    await tagPill.click();
    await expect(page, 'tag pill navigates back to the catalog with the tag filter').toHaveURL(/\/admin\/apps\?tag=/);
    const chip = page.locator('[data-testid="apps-tag-filter"]');
    await expect(chip, 'active tag chip renders').toBeVisible();
    await expect(chip, 'chip names the tag').toHaveAttribute('aria-label', `Clear tag filter ${tag}`);
    await expect(page.locator('[data-testid="apps-card-umami"]'), 'tagged app still visible').toBeVisible();
    await snap(page, '06-tag-chip');

    await chip.click();
    await expectCards(page, 9, 'chip clear restores all 9');
    await expect(page.locator('[data-testid="apps-tag-filter"]'), 'chip removed').toHaveCount(0);

    // ── Empty state: absurd query → honest empty → primary CTA resets. ──
    await search.fill('zzzz-no-such-app');
    await expect(page.locator('[data-testid="empty-state"]'), 'empty state for absurd query').toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="empty-title"]'), 'empty title names the reset').toContainText(
      /clear|filter|match/i,
    );
    await snap(page, '07-empty-state');
    await page.locator('[data-testid="empty-cta"]').click();
    await expectCards(page, 9, 'empty-state primary CTA resets filters');
    await expect(search, 'search cleared by reset').toHaveValue('');
    await snap(page, '08-catalog-restored');

    await assertAlive(page);
    await expectClean(e);
  });

  test('Deploy surface journey — live CTA + env/subdomain form persistence, honest coming-soon contract, AI recs + pager navigation', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    // ── Live app (umami): all 3 required env vars are platform-auto-injected
    //    and the subdomain is PRE-FILLED with a valid suggestion — so the causal
    //    gate is: suggestion = unlocked → cleared = locked + honest help →
    //    invalid value = locked + inline error → valid custom = unlocked again.
    //    (Deploy itself is NEVER clicked — it provisions real container infra.) ──
    await page.locator('[data-testid="apps-card-umami"]').click();
    await expect(page, 'on umami detail').toHaveURL(/\/admin\/apps\/umami$/);
    const cta = page.locator('[data-testid="apps-deploy-cta"]');
    const help = page.locator('[data-testid="apps-deploy-help"]');
    await expect(cta, 'live app shows the deploy CTA').toBeVisible({ timeout: 20_000 });
    // Auto-provisioned env vars render as read-only platform chips, not inputs.
    await expect(page.locator('.env-table[role="table"]'), 'env table renders').toBeVisible();
    await expect(page.locator('.env-auto').first(), 'auto env renders as a platform chip').toBeVisible();
    await expect(page.locator('[data-testid^="apps-env-input-"]'), 'umami has no user env inputs (all auto)').toHaveCount(0);

    const sub = page.locator('[data-testid="apps-deploy-subdomain"]');
    await expect(sub, 'subdomain input renders').toBeVisible();
    const suggestion = await sub.inputValue();
    expect(suggestion, `subdomain pre-filled with a valid suggestion (got "${suggestion}")`).toMatch(
      /^[a-z0-9-]{3,40}$/,
    );
    await expect(cta, 'CTA unlocked by the pre-filled valid suggestion').toBeEnabled();
    await expect(help, 'no help when the form is valid').toHaveCount(0);

    // Clearing the subdomain locks the CTA and surfaces the honest help.
    await sub.fill('');
    await expect(cta, 'cleared subdomain re-locks the CTA').toBeDisabled();
    await expect(help, 'honest help visible while locked').toBeVisible();
    await expect(help, 'generic help branch (no missing required env)').toContainText(
      /unlock deploy/i,
    );

    // An invalid value locks the CTA too, with the inline field error.
    await sub.fill('A');
    await expect(cta, 'invalid subdomain keeps the CTA locked').toBeDisabled();
    await expect(page.locator('.form-help--err'), 'inline subdomain error surfaces').toBeVisible();
    await snap(page, '09-deploy-form-locked');

    // A valid custom value unlocks again; arrow nav is ignored while typing in
    // the field (no accidental page-away).
    await sub.fill('chaos-app');
    await expect(sub, 'subdomain value persists').toHaveValue('chaos-app');
    await page.keyboard.press('ArrowRight');
    await expect(page, 'arrow nav ignored while typing in a form control').toHaveURL(
      /\/admin\/apps\/umami$/,
    );
    await expect(cta, 'valid subdomain unlocks the deploy CTA').toBeEnabled();
    await expect(help, 'help clears once the form is valid').toHaveCount(0);
    await expect(page.locator('.form-help--err'), 'inline error clears with a valid value').toHaveCount(0);
    await expect(
      page.locator('[role="group"][aria-label^="Total monthly cost"]'),
      'cost total group renders with its computed label',
    ).toBeVisible();
    await snap(page, '10-deploy-form-unlocked');
    // Leave the field as found (nothing was submitted).
    await sub.fill(suggestion);
    await expect(cta, 'suggestion restored — CTA back to its initial unlocked state').toBeEnabled();

    // ── Required-env gate (open-webui): OPENAI_API_KEY is required and NOT
    //    auto-provisioned, while the subdomain arrives pre-filled valid — the
    //    causal chain is env-missing (locked + named help) → env filled
    //    (unlocked). ──
    await page.locator('a.back-link').click();
    await page.locator('[data-testid="apps-card-open-webui"]').click();
    await expect(page, 'on open-webui detail').toHaveURL(/\/admin\/apps\/open-webui$/);
    const envInputs = page.locator('[data-testid^="apps-env-input-"]');
    await expect(envInputs, 'open-webui renders 2 user env inputs').toHaveCount(2);
    const apiKey = page.locator('[data-testid="apps-env-input-OPENAI_API_KEY"]');
    await expect(apiKey, 'required env input is marked aria-invalid while empty').toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(cta, 'CTA locked while required env missing').toBeDisabled();
    await expect(help, 'help names the missing required env').toContainText('OPENAI_API_KEY');
    await expect(help, 'help uses the Set-required-env branch').toContainText(/set required env/i);

    // Optional env typing persists (no gate effect while the required var is missing).
    const ollama = page.locator('[data-testid="apps-env-input-OLLAMA_BASE_URL"]');
    await ollama.fill('http://ollama.internal:11434');
    await expect(ollama, 'optional env value persists').toHaveValue('http://ollama.internal:11434');
    await expect(cta, 'optional env alone does not unlock').toBeDisabled();

    // Filling the required var unlocks the CTA (subdomain already suggested-valid).
    await apiKey.fill('sk-chaos-test-key');
    await expect(apiKey, 'required env value persists').toHaveValue('sk-chaos-test-key');
    await expect(apiKey, 'aria-invalid clears once filled').toHaveAttribute('aria-invalid', 'false');
    await expect(cta, 'required env filled unlocks the CTA').toBeEnabled();
    await expect(help, 'help clears on the fully valid form').toHaveCount(0);
    await snap(page, '12-deploy-form-open-webui');
    // Cleanup: clear the env values back to the locked initial state.
    await apiKey.fill('');
    await ollama.fill('');
    await expect(cta, 'form back to locked after cleanup').toBeDisabled();
    await expect(help, 'help back to naming the missing env after cleanup').toContainText(
      'OPENAI_API_KEY',
    );

    // ── Coming-soon app: honest disabled contract, no live CTA. ──
    await page.locator('a.back-link').click();
    await page.locator('[data-testid="apps-card-lobe-chat"]').click();
    await expect(page, 'on lobe-chat detail').toHaveURL(/\/admin\/apps\/lobe-chat$/);
    await expect(page.locator('[data-testid="apps-deploy-soon"]'), 'soon app shows the coming-soon contract').toBeVisible();
    await expect(page.locator('[data-testid="apps-deploy-cta"]'), 'soon app must NOT show a live deploy CTA').toHaveCount(0);
    await snap(page, '13-deploy-soon');

    // ── AI recommends: each rec card navigates to its advertised app. ──
    await page.locator('a.back-link').click();
    await page.locator('[data-testid="apps-card-open-webui"]').click();
    await expect(page.locator('[data-testid="apps-ai-recommends"]'), 'recs section on open-webui').toBeVisible();
    const recCard = page.locator('[data-testid^="apps-rec-"]').first();
    const recId = (await recCard.getAttribute('data-testid'))!.replace('apps-rec-', '');
    await recCard.click();
    await expect(page, 'rec card navigates to the advertised app').toHaveURL(new RegExp(`/admin/apps/${recId}$`));

    // ── Pager: mid-list detail has BOTH prev and next; each lands correctly. ──
    await expect(page.locator('[data-testid="apps-pager"]'), 'pager renders on detail').toBeVisible();
    const prevLink = page.locator('[data-testid^="apps-prev-"]').first();
    await expect(prevLink, 'mid-list app has a previous').toBeVisible();
    const prevId = (await prevLink.getAttribute('data-testid'))!.replace('apps-prev-', '');
    await prevLink.click();
    await expect(page, 'pager prev lands on the advertised app').toHaveURL(new RegExp(`/admin/apps/${prevId}$`));
    const nextLink2 = page.locator('[data-testid^="apps-next-"]').first();
    const nextId2 = (await nextLink2.getAttribute('data-testid'))!.replace('apps-next-', '');
    await nextLink2.click();
    await expect(page, 'pager next lands on the advertised app').toHaveURL(new RegExp(`/admin/apps/${nextId2}$`));
    expect(nextId2, 'pager round-trip returns to the origin app').toBe(recId);

    // ── Back to catalog: the full journey ends where it started. ──
    await page.locator('a.back-link').click();
    await expectCards(page, 9, 'catalog intact at journey end');

    await assertAlive(page);
    await expectClean(e);
  });
});
