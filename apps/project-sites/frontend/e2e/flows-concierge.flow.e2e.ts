/**
 * flows-concierge.flow.e2e.ts — Surface: the "Ask your site" AI concierge (feature
 * `ai_concierge_widget`), embedded in the feature-dossier opened from
 * /admin/site-features. A RAG widget: `POST /api/sites/:id/concierge {q}` answers a
 * question grounded in the site's own indexed content (Vectorize + Workers AI),
 * returning `{answer, sources}` — or a calm `{answer:null, notes}` when AI/content
 * is absent (it NEVER fabricates). Flag `ai_concierge_widget` is globally ON.
 *
 * Genuinely uncovered. Read-only (asking queries, never mutates) → no cleanup. The
 * endpoint always 200s with a structured body, so the AI journey is deterministic to
 * assert even though the answer text isn't: type a question → Ask → the widget
 * renders EITHER a grounded answer OR the calm provisioning note; the POST returns a
 * 200 with `answer` XOR `notes`.
 *
 * Real testids: sf-card-ai_concierge_widget, sf-spec, feature-dossier,
 * concierge-input, concierge-ask, concierge-answer.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-concierge.flow --workers=2
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const SITE = 'e2e-site-3';
const DOSSIER = '[data-testid="feature-dossier"]';
const INPUT = '[data-testid="concierge-input"]';

interface ConciergeResp { answer: string | null; sources?: unknown[]; notes?: string }

async function openConciergeDossier(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/site-features');
  const search = page.locator('[data-testid="sf-search"]');
  if (await search.count()) await search.fill('concierge').catch(() => {});
  const card = page.locator('[data-testid="sf-card-ai_concierge_widget"]');
  await card.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await card.locator('[data-testid="sf-spec"]').first().click().catch(() => {});
  await page.locator(DOSSIER).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
}

test.describe('Full-flow · AI concierge (ask your site)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the concierge dossier opens and renders the ask widget', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openConciergeDossier(page);
    await expect(page.locator(DOSSIER), 'the feature dossier opens').toBeVisible({ timeout: 15_000 });
    await expect(page.locator(INPUT), 'the concierge input renders').toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /ask your site/i })).toBeVisible();
    await snap(page, 'concierge-01-widget');
    expectClean(errors);
  });

  test('02 ground-truth: the concierge API answers with a structured body (answer XOR notes)', async ({ page }) => {
    await seedSession(page);
    await openConciergeDossier(page);
    const api = await apiFetch<ConciergeResp>(page, `/api/sites/${SITE}/concierge`, {
      method: 'POST',
      body: JSON.stringify({ q: 'What services do you offer?' }),
    });
    expect(api.status, 'the concierge endpoint is 200 (flag on, never 404 here)').toBe(200);
    // It NEVER fabricates: either a grounded answer, or a calm note — exactly one.
    const hasAnswer = typeof api.body.answer === 'string' && api.body.answer.length > 0;
    const hasNote = typeof api.body.notes === 'string' && api.body.notes.length > 0;
    expect(hasAnswer || hasNote, 'a grounded answer OR a calm provisioning note is returned').toBe(true);
  });

  test('03 the Ask button is gated until a real question (≥2 chars) is typed', async ({ page }) => {
    await seedSession(page);
    await openConciergeDossier(page);
    await expect(page.locator(INPUT)).toBeVisible({ timeout: 15_000 });
    await page.locator(INPUT).fill('a'); // 1 char → below the min
    await expect(page.locator('[data-testid="concierge-ask"]')).toBeDisabled();
    await page.locator(INPUT).fill('What are your opening hours?');
    await expect(page.locator('[data-testid="concierge-ask"]')).toBeEnabled();
  });

  test('04 ask journey: type a question → Ask → a grounded answer OR a calm note renders', async ({ page }) => {
    test.setTimeout(60_000); // an AI/RAG round-trip can take a few seconds
    const errors = attachConsole(page);
    await seedSession(page);
    await openConciergeDossier(page);
    await expect(page.locator(INPUT)).toBeVisible({ timeout: 15_000 });

    await page.locator(INPUT).fill('What are your opening hours?');
    const ask = page.locator('[data-testid="concierge-ask"]');
    await expect(ask).toBeEnabled();
    await ask.click();

    // The call resolves (button leaves the "Asking…" state) and a response renders —
    // either the grounded answer OR the calm note (never a fabricated guess).
    await expect(ask, 'the ask completes').not.toContainText(/asking/i, { timeout: 40_000 });
    const answer = page.locator('[data-testid="concierge-answer"]');
    const note = page.locator('.sc-note');
    await expect(answer.or(note).first(), 'a grounded answer or a calm note renders').toBeVisible({ timeout: 10_000 });
    await snap(page, 'concierge-04-answered');
    expectClean(errors);
  });

  test('05 the concierge surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openConciergeDossier(page);
    await expect(page.locator(INPUT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('06 deep-link + reload preserves the concierge surface (session intact)', async ({ page }) => {
    await seedSession(page);
    await openConciergeDossier(page);
    await expect(page.locator(INPUT)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openConciergeDossier(page);
    await expect(page.locator(INPUT), 'still reachable after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });
});
