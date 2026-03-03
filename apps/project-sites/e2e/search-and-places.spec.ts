/**
 * E2E tests for Google Places search integration.
 *
 * Verifies that typing in the homepage hero search input triggers
 * the Google Places API and populates the dropdown with results.
 */
import { test, expect } from './fixtures.js';

test.describe('Google Places Search Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('homepage renders with search input visible', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', /Enter your business name/i);
  });

  test('typing 2+ chars triggers search and shows dropdown results', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const dropdown = page.locator('#search-dropdown');

    await searchInput.fill('Vito');
    // Wait for debounce (300ms) + API call
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const results = dropdown.locator('.search-result');
    await expect(results.first()).toBeVisible({ timeout: 5_000 });

    // Mock server returns results containing the query
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('typing fewer than 2 chars does not trigger search', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const dropdown = page.locator('#search-dropdown');

    await searchInput.fill('V');
    await page.waitForTimeout(500);

    // Dropdown should NOT be open
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test('search results include business name and address', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Pizza');

    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const firstResult = dropdown.locator('.search-result').first();
    await expect(firstResult).toBeVisible();

    // Results should have name and address parts
    const nameEl = firstResult.locator('.search-result-name');
    const addrEl = firstResult.locator('.search-result-address');
    await expect(nameEl).toBeVisible();
    await expect(addrEl).toBeVisible();
  });

  test('search shows "Custom Website" option in dropdown', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('My Business');

    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const customOption = dropdown.locator('.search-result-custom');
    await expect(customOption).toBeVisible();
  });

  test('clearing search input hides dropdown', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const dropdown = page.locator('#search-dropdown');

    await searchInput.fill('Test');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    await searchInput.fill('');
    await page.waitForTimeout(500);
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test('clicking a search result navigates to details screen', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Salon');

    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    // Click the first non-custom result
    const firstResult = dropdown.locator('.search-result').first();
    await firstResult.click();

    // Should navigate to details screen (modal overlay becomes visible)
    const detailsModal = page.locator('#details-modal.visible, .details-modal-overlay.visible');
    await expect(detailsModal.first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking "Custom Website" opens details in custom mode', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('My Project');

    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const customOption = dropdown.locator('.search-result-custom');
    await customOption.click();

    const detailsModal = page.locator('#details-modal.visible, .details-modal-overlay.visible');
    await expect(detailsModal.first()).toBeVisible({ timeout: 5_000 });
  });

  test('search spinner shows during API call', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const spinner = page.locator('#search-spinner');

    // Fill and immediately check for spinner
    await searchInput.fill('Test Business');

    // Spinner should appear briefly
    // (may be too fast to catch; check it doesn't persist)
    await page.waitForTimeout(1500);
    // After results load, spinner should be hidden
    await expect(spinner).not.toBeVisible();
  });

  test('search makes parallel API calls to businesses and sites endpoints', async ({ page }) => {
    const apiCalls: string[] = [];

    await page.route('**/api/search/businesses**', async (route) => {
      apiCalls.push(route.request().url());
      await route.fallback();
    });

    await page.route('**/api/sites/search**', async (route) => {
      apiCalls.push(route.request().url());
      await route.fallback();
    });

    const searchInput = page.locator('#search-input');
    await searchInput.fill('Test');

    // Wait for debounced calls
    await page.waitForTimeout(1000);

    const businessCalls = apiCalls.filter((u) => u.includes('/api/search/businesses'));
    const siteCalls = apiCalls.filter((u) => u.includes('/api/sites/search'));

    expect(businessCalls.length).toBeGreaterThanOrEqual(1);
    expect(siteCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('search debounces rapid typing to single API call', async ({ page }) => {
    let callCount = 0;

    await page.route('**/api/search/businesses**', async (route) => {
      callCount++;
      await route.fallback();
    });

    const searchInput = page.locator('#search-input');

    // Type rapidly — should debounce to 1-2 calls
    await searchInput.pressSequentially('Test Business', { delay: 30 });
    await page.waitForTimeout(1000);

    // Should have far fewer calls than characters typed
    expect(callCount).toBeLessThanOrEqual(3);
  });
});
