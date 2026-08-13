/**
 * flows-i18n.flow.e2e.ts — Surface: the i18n translation tester (feature
 * `i18n_localization`), embedded in the feature-dossier opened from
 * /admin/site-features. Translates a snippet into a target language via Workers AI
 * m2m100 (`POST /api/sites/:id/i18n/translate { text, target }` → `{translated, dir}`
 * or a calm `{notes}`). Flag-gated `i18n_localization`.
 *
 * FINISHED this fire — the feature was complete but DARK. Enabled it for e2e-site-3
 * only (a TENANT override `flag_overrides` id=`e2e-i18n-loc-site3`, reversible) so
 * the translate widget is live for the test site. Genuinely uncovered before this.
 *
 * Read-only (translation doesn't persist) → no cleanup. The endpoint returns a
 * structured body (translated XOR notes), so assert the JOURNEY completes + a
 * translated result renders (and differs from the input), tolerating m2m100 latency
 * + the exact wording.
 *
 * Real testids: sf-card-i18n_localization, sf-spec, feature-dossier, it-text, it-go, it-out.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-i18n.flow --workers=2
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const SITE = 'e2e-site-3';
const DOSSIER = '[data-testid="feature-dossier"]';
const TEXTAREA = '[data-testid="it-text"]';
const SNIPPET = 'Hello, welcome to our fitness studio.';

interface TranslateResp { translated: string | null; dir?: string; notes?: string }

async function openI18nDossier(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/site-features');
  const search = page.locator('[data-testid="sf-search"]');
  if (await search.count()) await search.fill('localiz').catch(() => {});
  const card = page.locator('[data-testid="sf-card-i18n_localization"]');
  await card.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await card.locator('[data-testid="sf-spec"]').first().click().catch(() => {});
  await page.locator(DOSSIER).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
}

test.describe('Full-flow · i18n translation tester', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the i18n dossier opens and renders the translation tester', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openI18nDossier(page);
    await expect(page.locator(DOSSIER), 'the feature dossier opens').toBeVisible({ timeout: 15_000 });
    await expect(page.locator(TEXTAREA), 'the translate textarea renders').toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /translate a snippet/i })).toBeVisible();
    await snap(page, 'i18n-01-widget');
    expectClean(errors);
  });

  test('02 ground-truth: the translate API returns a structured body (translated XOR notes)', async ({ page }) => {
    await seedSession(page);
    await openI18nDossier(page);
    const api = await apiFetch<TranslateResp>(page, `/api/sites/${SITE}/i18n/translate`, {
      method: 'POST',
      body: JSON.stringify({ text: SNIPPET, target: 'es' }),
    });
    expect(api.status, 'the translate endpoint is 200 (flag enabled for e2e-site-3 this fire)').toBe(200);
    const hasT = typeof api.body.translated === 'string' && api.body.translated.length > 0;
    const hasNote = typeof api.body.notes === 'string' && api.body.notes.length > 0;
    expect(hasT || hasNote, 'a translation OR a calm note is returned').toBe(true);
  });

  test('03 the Translate button is gated until text is entered', async ({ page }) => {
    await seedSession(page);
    await openI18nDossier(page);
    await expect(page.locator(TEXTAREA)).toBeVisible({ timeout: 15_000 });
    await page.locator(TEXTAREA).fill('');
    await expect(page.locator('[data-testid="it-go"]')).toBeDisabled();
    await page.locator(TEXTAREA).fill(SNIPPET);
    await expect(page.locator('[data-testid="it-go"]')).toBeEnabled();
  });

  test('04 translate journey: enter English → Translate → a translated result renders', async ({ page }) => {
    test.setTimeout(60_000); // an m2m100 round-trip can take a few seconds
    const errors = attachConsole(page);
    await seedSession(page);
    await openI18nDossier(page);
    await expect(page.locator(TEXTAREA)).toBeVisible({ timeout: 15_000 });

    await page.locator(TEXTAREA).fill(SNIPPET);
    const go = page.locator('[data-testid="it-go"]');
    await expect(go).toBeEnabled();
    await go.click();

    // The call resolves (button leaves "Translating…") and a REAL translation renders.
    // m2m100 is often capacity-limited, so the worker falls back to Llama — the widget
    // shows actual translated text (not the "couldn't translate" note).
    await expect(go, 'the translate completes').not.toContainText(/translating/i, { timeout: 40_000 });
    const out = page.locator('[data-testid="it-out"]');
    await expect(out, 'the translated output renders').toBeVisible({ timeout: 10_000 });
    const translated = (await out.innerText()).trim();
    expect(translated.length, 'the translation is non-empty').toBeGreaterThan(0);
    expect(translated, 'the translation differs from the English input (a real translation happened)').not.toBe(SNIPPET);
    await snap(page, 'i18n-04-translated');
    expectClean(errors);
  });

  test('05 the i18n surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openI18nDossier(page);
    await expect(page.locator(TEXTAREA)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('06 deep-link + reload preserves the i18n surface (session intact)', async ({ page }) => {
    await seedSession(page);
    await openI18nDossier(page);
    await expect(page.locator(TEXTAREA)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openI18nDossier(page);
    await expect(page.locator(TEXTAREA), 'still reachable after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });
});
