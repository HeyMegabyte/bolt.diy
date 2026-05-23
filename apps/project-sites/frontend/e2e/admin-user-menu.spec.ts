/**
 * E2E coverage for the admin user-avatar dropdown menu.
 *
 * Asserts:
 *  - clicking the avatar reveals the menu
 *  - the menu closes when clicking outside
 *  - each routed item navigates to its unique section AND closes the menu
 *  - the "Keyboard shortcuts" item opens the shortcuts dialog
 *  - the "Language" toggle flips the chip between EN ⇄ ES
 *  - the "Sign out" item clears the session
 *
 * Every test starts from the admin homepage (no `page.goto` after the initial
 * load) and drives the UI via real clicks — keeps the suite TDD-honest.
 */
import { test, expect, type Page } from './fixtures';

/** Per-test console error capture — fails the test if anything unexpected logs. */
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
      !e.includes('Failed to load resource') &&
      !e.includes('stackblitz') &&
      !e.includes('editor.projectsites.dev'),
  );
}

async function openMenu(page: Page): Promise<void> {
  await page.getByTestId('user-avatar-btn').click();
  await expect(page.getByTestId('user-menu')).toBeVisible();
}

test.describe('Admin user menu', () => {
  test('avatar click reveals menu with all 6 items', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // menu hidden by default
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    await openMenu(page);

    // every item present + visible
    await expect(page.getByTestId('user-menu-billing')).toBeVisible();
    await expect(page.getByTestId('user-menu-user-settings')).toBeVisible();
    await expect(page.getByTestId('user-menu-project-settings')).toBeVisible();
    await expect(page.getByTestId('user-menu-shortcuts')).toBeVisible();
    await expect(page.getByTestId('user-menu-language')).toBeVisible();
    await expect(page.getByTestId('user-menu-signout')).toBeVisible();

    expect(filterNoise(errors)).toEqual([]);
  });

  test('clicking outside closes the menu', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    // click the main content area to dismiss
    await page.locator('main').first().click({ position: { x: 50, y: 50 } });
    await expect(page.getByTestId('user-menu')).toHaveCount(0);
  });

  test('Billing & credits → /admin/billing (unique section)', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    await page.getByTestId('user-menu-billing').click();

    await expect(page).toHaveURL(/\/admin\/billing(\?|$)/);
    // unique billing heading proves the right section mounted
    await expect(page.getByRole('heading', { name: 'Billing & Plan' })).toBeVisible();
    // menu must close on navigation
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    expect(filterNoise(errors)).toEqual([]);
  });

  test('User settings → /admin/user (unique section)', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    await page.getByTestId('user-menu-user-settings').click();

    await expect(page).toHaveURL(/\/admin\/user(\?|$)/);
    await expect(page.getByRole('heading', { name: 'User settings' })).toBeVisible();
    // User-settings-specific control proves the unique section is mounted (not a stub)
    await expect(page.getByTestId('density-select')).toBeVisible();
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Project settings → /admin/settings (unique section)', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    await page.getByTestId('user-menu-project-settings').click();

    await expect(page).toHaveURL(/\/admin\/settings(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Keyboard shortcuts → opens shortcuts dialog (menu-as-action)', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    await page.getByTestId('user-menu-shortcuts').click();

    // shortcuts dialog mounts
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    // user menu closes
    await expect(page.getByTestId('user-menu')).toHaveCount(0);
    // URL stays on admin
    expect(new URL(page.url()).pathname).toMatch(/^\/admin/);

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Language toggle flips EN ⇄ ES and closes menu', async ({ authedPage: page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    const langBtn = page.getByTestId('user-menu-language');
    const before = await langBtn.textContent();

    await langBtn.click();

    // menu closes after the toggle
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    // re-open and inspect the new label
    await openMenu(page);
    const after = await page.getByTestId('user-menu-language').textContent();

    expect((before ?? '').trim()).not.toBe((after ?? '').trim());
    // one side says English, the other says Español
    const combined = `${before ?? ''}|${after ?? ''}`;
    expect(combined).toMatch(/English/);
    expect(combined).toMatch(/Español/);

    // flip back so we don't leak language state into other tests
    await page.getByTestId('user-menu-language').click();

    expect(filterNoise(errors)).toEqual([]);
  });

  test('Sign out clears the session and bounces to /signin', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await openMenu(page);
    await page.getByTestId('user-menu-signout').click();

    // Either we navigate to /signin OR back to homepage — both clear session.
    await page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 5000 });
    const session = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(session).toBeNull();
  });
});
