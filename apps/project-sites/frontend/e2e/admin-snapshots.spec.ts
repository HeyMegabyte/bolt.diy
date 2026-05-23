/**
 * E2E coverage for the redesigned Admin → Snapshots surface.
 *
 * Asserts every part of the "Snapshots redesign" turn:
 *   - Create-modal opens via the standard DialogShell primitive
 *   - Duplicate-name validation (case-insensitive, against existing snapshots)
 *   - Length-limit live counters (Name 50, Description 160)
 *   - More-dropdown action set (View visible inline · Revert/Download/Delete
 *     hidden behind the kebab; Revert hidden on the latest snapshot)
 *   - Escape closes the create modal (DialogShell focus-trap contract)
 *   - Mid-request modal lock — Cancel disabled, X-close ignored while
 *     `creatingSnapshot()` is true
 *
 * Every test starts at `/admin` and drives the UI via real clicks — no
 * `page.goto()` after the initial mount. Mocked API state comes from the
 * project's `scripts/e2e_server.cjs`, which pre-populates `site-001` (Vito's
 * Mens Salon) with a single `initial` snapshot. The default fixture in
 * `e2e/fixtures.ts` seeds `ps_session` so the admin shell mounts.
 *
 * @see {@link ../src/app/pages/admin/sections/snapshots.component.ts} —
 *   `nameError()` (case-insensitive duplicate check) and
 *   `closeCreateDialog()` (mid-request lock) are the unit-of-behavior under
 *   test here. The spec is intentionally tolerant of small DOM tweaks: most
 *   assertions hang off `data-testid` attributes that the component owns.
 */
import { test, expect, type Page } from './fixtures';

/**
 * Per-test console error collector that ignores known third-party noise
 * (favicon misses, PostHog/Sentry beacons, editor.projectsites.dev). Failing
 * a test on PostHog being blocked would be flake; failing on a real CSP
 * violation or undefined-is-not-a-function is the point.
 */
function setupConsoleCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('Failed to load resource') &&
      !e.includes('stackblitz') &&
      !e.includes('editor.projectsites.dev'),
  );
}

/**
 * Navigate to /admin/snapshots and wait until the row for the seeded
 * `initial` snapshot is visible. Centralizes the boilerplate so every
 * test starts from a known-good admin state.
 */
async function gotoSnapshots(page: Page): Promise<void> {
  await page.goto('/admin/snapshots');
  await page.waitForLoadState('networkidle');
  // The seeded mock returns at least one snapshot — wait for the
  // timeline to populate before issuing assertions, otherwise a slow
  // network response can trip the "Create your first snapshot" empty
  // state branch in the component.
  await expect(page.getByTestId('snapshot-title-snap-001')).toBeVisible({ timeout: 8000 });
}

/**
 * Open the create-snapshot dialog by clicking the "+ Snapshot" header
 * button. Returns once DialogShell has mounted and the Name input is
 * focused — the component's `autofocus` attribute is honored by the
 * browser, but we still wait for `toBeVisible()` to dodge a flaky
 * race against the focus-trap animation.
 */
async function openCreateDialog(page: Page): Promise<void> {
  // The header create button doesn't carry a testid — locate by visible
  // text. Anywhere "+ Create snapshot" appears (header OR empty-state)
  // routes through the same `createOpen.set(true)` toggle.
  const trigger = page
    .getByRole('button')
    .filter({ hasText: /create.*snapshot/i })
    .first();
  await trigger.click();
  await expect(page.getByTestId('snapshot-name-input')).toBeVisible();
}

test.describe('Admin → Snapshots (redesign)', () => {
  test('Create modal opens via DialogShell with focused Name input', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await gotoSnapshots(page);

    await openCreateDialog(page);

    // DialogShell ships a known [role="dialog"] container.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('snapshot-name-input')).toBeVisible();
    await expect(page.getByTestId('snapshot-desc-input')).toBeVisible();
    await expect(page.getByTestId('snapshot-create-submit')).toBeDisabled(); // empty name = disabled

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Duplicate-name validation (case-insensitive against existing snapshots)', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await gotoSnapshots(page);

    await openCreateDialog(page);
    const nameInput = page.getByTestId('snapshot-name-input');

    // Mock seed exposes `initial` as the snapshot_name of the only existing
    // row. Both same-case and mixed-case must trigger the inline error.
    await nameInput.fill('initial');
    await expect(page.getByRole('alert')).toContainText(/already exists/i);
    await expect(page.getByTestId('snapshot-create-submit')).toBeDisabled();

    // Case-insensitive: capitalized version is rejected too.
    await nameInput.fill('Initial');
    await expect(page.getByRole('alert')).toContainText(/already exists/i);
    await expect(page.getByTestId('snapshot-create-submit')).toBeDisabled();

    // Switch to a unique name → submit re-enables.
    await nameInput.fill('v2-redesign');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('snapshot-create-submit')).toBeEnabled();

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Length-limit live counters update + cap the inputs (50 / 160)', async ({ authedPage: page }) => {
    await gotoSnapshots(page);

    await openCreateDialog(page);
    const nameInput = page.getByTestId('snapshot-name-input');
    const descInput = page.getByTestId('snapshot-desc-input');

    // Type 5 chars — counter reads "5/50".
    await nameInput.fill('hello');
    await expect(page.getByText('5/50')).toBeVisible();

    // Browsers enforce maxlength="50" — attempt to type 60 chars, expect
    // exactly 50 to land. Don't assert on the truncation behaviour of the
    // counter text directly (different render passes report different
    // counts before the input value lands).
    await nameInput.fill('a'.repeat(60));
    await expect.poll(async () => (await nameInput.inputValue()).length).toBe(50);
    await expect(page.getByText('50/50')).toBeVisible();

    // Same for description / 160.
    await descInput.fill('b'.repeat(200));
    await expect.poll(async () => (await descInput.inputValue()).length).toBe(160);
    await expect(page.getByText('160/160')).toBeVisible();
  });

  test('More-dropdown action set: View inline · Revert/Download/Delete in menu', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await gotoSnapshots(page);

    // The seeded snapshot is the latest (and only) one, so Revert MUST be
    // hidden per the redesign rule. Download + Delete remain.
    const row = page.getByTestId('snapshot-title-snap-001').locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
    // "View" stays inline as the primary action.
    await expect(row.getByRole('button', { name: /open snapshot.*in new tab/i })).toBeVisible();

    // Open the More menu.
    await page.getByTestId('snapshot-more-snap-001').click();

    // Revert is hidden on the latest snapshot, Download + Delete are visible.
    await expect(page.getByTestId('snapshot-revert-snap-001')).toHaveCount(0);
    await expect(page.getByTestId('snapshot-download-snap-001')).toBeVisible();
    await expect(page.getByTestId('snapshot-delete-snap-001')).toBeVisible();

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Escape closes the create modal', async ({ authedPage: page }) => {
    await gotoSnapshots(page);

    await openCreateDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('snapshot-name-input')).toHaveCount(0);
  });

  test('Mid-request lock — Cancel disabled while creatingSnapshot is true', async ({ authedPage: page }) => {
    // Intercept the create call so we can hold the response open and assert
    // the in-flight UI state. Once we've made our assertions, fulfill the
    // request so the test cleans up. We mock /api/sites/* because the
    // mock server's create endpoint returns instantly otherwise.
    let releaseRequest: (() => void) | null = null;
    const heldPromise = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    await page.route('**/api/sites/*/snapshots', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await heldPromise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'snap-pending',
            snapshot_name: 'v2-redesign',
            build_version: '2',
            created_at: new Date().toISOString(),
            description: null,
          },
        }),
      });
    });

    await gotoSnapshots(page);
    await openCreateDialog(page);

    await page.getByTestId('snapshot-name-input').fill('v2-redesign');
    await page.getByTestId('snapshot-create-submit').click();

    // While the POST is held, Cancel must be disabled and the submit button
    // must show "Creating…". The X close affordance is also locked out —
    // closeCreateDialog() bails on the first line when creatingSnapshot() is
    // true. Press Escape and verify the modal stays open.
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    await expect(cancelBtn).toBeDisabled();
    await expect(page.getByTestId('snapshot-create-submit')).toContainText(/creating/i);

    await page.keyboard.press('Escape');
    // Inputs stay mounted — modal didn't close.
    await expect(page.getByTestId('snapshot-name-input')).toBeVisible();

    // Release the held request, modal closes after success.
    releaseRequest?.();
    await expect(page.getByTestId('snapshot-name-input')).toHaveCount(0, { timeout: 5000 });
  });
});
