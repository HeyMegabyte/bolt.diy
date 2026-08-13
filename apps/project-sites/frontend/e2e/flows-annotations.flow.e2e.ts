/**
 * flows-annotations.flow.e2e.ts — Surface: timeline notes (feature
 * `analytics_annotations`) on /admin/snapshots.
 *
 * FINISHED this fire — required THREE real backend fixes first: (1) the create
 * Zod schema demanded a uuid siteId (500'd legitimate non-uuid site ids) →
 * relaxed to a bounded string; (2) the `analytics_annotations` TABLE did not
 * exist in prod (no migration) so create/list/delete SWALLOWED the error as a
 * lying-success → added `0620_create_analytics_annotations.sql` + applied it;
 * (3) the DELETE route is `/api/annotations/:id` (site-agnostic), not nested.
 * THEN built `<app-timeline-notes>` (add + list + delete) + wired it onto Snapshots.
 *
 * This is a MUTATION full-flow: create → assert-persisted (store) → assert-UI →
 * delete → assert-gone. Each mutating test is SELF-CLEANING (unique note marker);
 * a final cleanup test removes any leftover probe rows so the shared org stays clean.
 *
 * Real testids: timeline-notes, timeline-note-input, timeline-note-category,
 * timeline-note-add, timeline-note-item, timeline-note-delete, timeline-notes-empty.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-annotations.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const PANEL = '[data-testid="timeline-notes"]';
const SEEDED_SITE = 'e2e-site-3';
const MARK = 'e2e-note';

async function cleanupProbes(page: import('@playwright/test').Page) {
  const list = await apiFetch<{ data: { id: string; note: string }[] }>(page, `/api/sites/${SEEDED_SITE}/annotations`);
  for (const a of list.body?.data ?? []) {
    if (a.note?.includes(MARK)) await apiFetch(page, `/api/annotations/${a.id}`, { method: 'DELETE' });
  }
}

// Mutation flow serialises to keep create/delete ordering deterministic + org clean.
test.describe.configure({ mode: 'serial' });

test.describe('Full-flow · timeline notes (annotations)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.use({ reducedMotion: 'reduce' });

  test('01 the timeline-notes panel renders on /admin/snapshots with an add form', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL), 'the timeline-notes panel renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /timeline notes/i })).toBeVisible();
    await expect(page.locator('[data-testid="timeline-note-input"]'), 'the add form is present').toBeVisible();
    await snap(page, 'annotations-01-panel');
    expectClean(errors);
  });

  test('02 the category select offers deploy / marketing / incident / other', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const opts = await page.locator('[data-testid="timeline-note-category"] option').allInnerTexts();
    for (const c of ['deploy', 'marketing', 'incident', 'other']) {
      expect(opts.map((o) => o.toLowerCase()), `${c} category offered`).toContain(c);
    }
  });

  test('03 Add is disabled until a note is typed', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="timeline-note-add"]'), 'empty note → disabled').toBeDisabled();
    await page.locator('[data-testid="timeline-note-input"]').fill('a note');
    await expect(page.locator('[data-testid="timeline-note-add"]'), 'typed note → enabled').toBeEnabled();
  });

  test('04 MUTATION journey: add a note → it persists (store) → shows in the list → delete → gone', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await cleanupProbes(page); // start clean

    const note = `${MARK}: launched campaign ${Date.now()}`;
    await page.locator('[data-testid="timeline-note-input"]').fill(note);
    await page.locator('[data-testid="timeline-note-category"]').selectOption('marketing');
    await page.locator('[data-testid="timeline-note-add"]').click();

    // assert-UI: the new note appears in the list.
    const item = page.locator(`[data-testid="timeline-note-item"]:has-text("${note}")`);
    await expect(item, 'the added note shows in the timeline').toBeVisible({ timeout: 8_000 });
    await snap(page, 'annotations-04-added');

    // assert-persisted: the store (GET) has the note.
    await expect(async () => {
      const store = await apiFetch<{ data: { note: string }[] }>(page, `/api/sites/${SEEDED_SITE}/annotations`);
      const notes = (store.body.data ?? []).map((a) => a.note);
      expect(notes, 'the note is persisted in the store').toContain(note);
    }).toPass({ timeout: 8_000 });

    // act: delete via the UI.
    await item.locator('[data-testid="timeline-note-delete"]').click();
    await expect(item, 'the note is removed from the UI').toHaveCount(0, { timeout: 8_000 });

    // assert-persisted: the store no longer has it.
    await expect(async () => {
      const store = await apiFetch<{ data: { note: string }[] }>(page, `/api/sites/${SEEDED_SITE}/annotations`);
      const notes = (store.body.data ?? []).map((a) => a.note);
      expect(notes, 'the note is gone from the store after delete').not.toContain(note);
    }).toPass({ timeout: 8_000 });
    expectClean(errors);
  });

  test('05 a second add persists independently (multi-note timeline)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const note = `${MARK}: v2 deploy ${Date.now()}`;
    await page.locator('[data-testid="timeline-note-input"]').fill(note);
    await page.locator('[data-testid="timeline-note-category"]').selectOption('deploy');
    await page.locator('[data-testid="timeline-note-add"]').click();
    const item = page.locator(`[data-testid="timeline-note-item"]:has-text("${note}")`);
    await expect(item).toBeVisible({ timeout: 8_000 });
    // Its category chip reflects the chosen category.
    await expect(item.locator('.tn-chip--deploy'), 'the deploy chip renders').toBeVisible();
    // Clean up this test's row.
    await item.locator('[data-testid="timeline-note-delete"]').click();
    await expect(item).toHaveCount(0, { timeout: 8_000 });
  });

  test('06 deep-link + reload preserves the timeline-notes panel (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(PANEL), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('07 full journey: snapshots hosts readiness + sparkline + timeline-notes together', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator('[data-testid="readiness-panel"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="health-sparkline"]')).toBeVisible();
    await expect(page.locator(PANEL)).toBeVisible();
    await snap(page, 'annotations-07-journey');
    expectClean(errors);
  });

  test('08 cleanup: remove any leftover probe notes (keep the shared org clean)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await cleanupProbes(page);
    const store = await apiFetch<{ data: { note: string }[] }>(page, `/api/sites/${SEEDED_SITE}/annotations`);
    const leftover = (store.body.data ?? []).filter((a) => a.note?.includes(MARK));
    expect(leftover.length, 'no probe notes remain').toBe(0);
  });
});
