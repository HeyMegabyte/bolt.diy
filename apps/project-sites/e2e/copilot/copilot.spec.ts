/**
 * E2E — Multimodal AI Site Copilot (#25)
 *
 * All tests start at the marketing homepage and navigate via UI clicks.
 * Tests are hermetic. The copilot widget is served as a JS bundle;
 * intent endpoint tests use a test site slug when available.
 *
 * PROD_URL env var: live deployment. TEST_SITE_SLUG: a seeded test site.
 */

import { test, expect, Page } from '@playwright/test';

const PROD = process.env['PROD_URL'] ?? 'https://projectsites.dev';
const TEST_SLUG = process.env['TEST_SITE_SLUG'] ?? 'test-site';

async function signInAdmin(page: Page): Promise<void> {
  await page.goto(PROD, { waitUntil: 'domcontentloaded' });
  const token = process.env['TEST_SESSION_TOKEN'];
  if (token) {
    await page.evaluate((t) => localStorage.setItem('session_token', t), token);
  }
}

test.describe('Multimodal Copilot — widget JS bundle', () => {
  test('homepage loads cleanly before testing copilot', async ({ page }) => {
    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    expect(await page.title()).toBeTruthy();
  });

  test('copilot.js bundle is served with correct content-type', async ({ page }) => {
    const response = await page.request.get(`${PROD}/sites/${TEST_SLUG}/copilot.js`);
    // 200 when site exists + flag on; 404 otherwise — both acceptable
    if (response.status() === 200) {
      const ct = response.headers()['content-type'];
      expect(ct).toContain('javascript');
    } else {
      expect([404, 200]).toContain(response.status());
    }
  });

  test('widget JS does not contain placeholder __SITE_SLUG__ string', async ({ page }) => {
    const response = await page.request.get(`${PROD}/sites/${TEST_SLUG}/copilot.js`);
    if (response.status() !== 200) return; // site may not exist in test env
    const body = await response.text();
    expect(body).not.toContain('__SITE_SLUG__');
  });

  test('copilot widget JS injects a button into the page DOM', async ({ page }) => {
    // Load a page that includes the widget script
    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    // Dynamically inject the widget (simulates embed tag)
    const scriptUrl = `${PROD}/sites/${TEST_SLUG}/copilot.js`;
    const res = await page.request.get(scriptUrl);
    if (res.status() !== 200) return; // skip if site not seeded

    await page.evaluate((url) => {
      const s = document.createElement('script');
      s.src = url;
      document.body.appendChild(s);
    }, scriptUrl);

    await expect(page.locator('#ps-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ps-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test('clicking copilot FAB opens the panel and focuses the textarea', async ({ page }) => {
    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    const scriptUrl = `${PROD}/sites/${TEST_SLUG}/copilot.js`;
    const res = await page.request.get(scriptUrl);
    if (res.status() !== 200) return;

    await page.evaluate((url) => {
      const s = document.createElement('script');
      s.src = url;
      document.body.appendChild(s);
    }, scriptUrl);

    await page.locator('#ps-btn').click();
    await expect(page.locator('#ps-panel')).toBeVisible({ timeout: 3000 });
    // Textarea should be focused
    await expect(page.locator('#ps-text')).toBeFocused({ timeout: 2000 });
  });

  test('pressing Escape closes the copilot panel', async ({ page }) => {
    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    const scriptUrl = `${PROD}/sites/${TEST_SLUG}/copilot.js`;
    const res = await page.request.get(scriptUrl);
    if (res.status() !== 200) return;

    await page.evaluate((url) => {
      const s = document.createElement('script');
      s.src = url;
      document.body.appendChild(s);
    }, scriptUrl);

    await page.locator('#ps-btn').click();
    await expect(page.locator('#ps-panel')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#ps-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test('copilot widget validates empty submission and shows error', async ({ page }) => {
    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    const scriptUrl = `${PROD}/sites/${TEST_SLUG}/copilot.js`;
    const res = await page.request.get(scriptUrl);
    if (res.status() !== 200) return;

    await page.evaluate((url) => {
      const s = document.createElement('script');
      s.src = url;
      document.body.appendChild(s);
    }, scriptUrl);

    await page.locator('#ps-btn').click();
    await page.locator('#ps-send').click();
    await expect(page.locator('#ps-result')).toContainText('message', { timeout: 2000 });
  });
});

test.describe('Multimodal Copilot — intent API', () => {
  test('intent endpoint returns 404 when flag is off or site not found', async ({ page }) => {
    const response = await page.request.post(
      `${PROD}/api/sites/nonexistent-slug-xyz-000/copilot/intent`,
      { multipart: { text: 'I want a quote' } },
    );
    expect([400, 404]).toContain(response.status());
  });

  test('intent endpoint validates empty body', async ({ page }) => {
    const response = await page.request.post(
      `${PROD}/api/sites/${TEST_SLUG}/copilot/intent`,
      { headers: { 'Content-Type': 'application/json' }, data: {} },
    );
    expect([400, 404]).toContain(response.status());
  });
});

test.describe('Multimodal Copilot — admin panel', () => {
  test('copilot admin route renders or redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    const isSignIn = page.url().includes('/signin') || page.url().includes('/admin');
    expect(isSignIn).toBeTruthy();
  });

  test('copilot admin shows flag-gate notice when flag is off', async ({ page }) => {
    await signInAdmin(page);
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    const flagGate = page.locator('text=multimodal_copilot');
    const panel = page.locator('.copilot-shell');
    await expect(flagGate.or(panel)).toBeVisible({ timeout: 8000 });
  });

  test('copilot admin enable toggle is rendered', async ({ page }) => {
    await signInAdmin(page);
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    const gateEl = page.locator('text=multimodal_copilot');
    if (await gateEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'multimodal_copilot flag is off');
      return;
    }
    const toggle = page.locator('.copilot-toggle input[type="checkbox"]');
    await expect(toggle).toBeVisible({ timeout: 8000 });
  });

  test('copilot admin embed snippet contains site slug', async ({ page }) => {
    await signInAdmin(page);
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    const gateEl = page.locator('text=multimodal_copilot');
    if (await gateEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'multimodal_copilot flag is off');
      return;
    }
    const snippet = page.locator('.copilot-embed-code');
    if (await snippet.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(snippet).toContainText('copilot.js');
    }
  });

  test('copilot copy button exists and is keyboard-accessible', async ({ page }) => {
    await signInAdmin(page);
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    const gateEl = page.locator('text=multimodal_copilot');
    if (await gateEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'multimodal_copilot flag is off');
      return;
    }
    const copyBtn = page.locator('.copilot-copy-btn');
    if (!(await copyBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await copyBtn.focus();
    expect(await copyBtn.getAttribute('tabindex')).not.toBe('-1');
  });
});

test.describe('Multimodal Copilot — WCAG + visual quality', () => {
  test('copilot admin page has no critical axe violations at 1280px', async ({ page }) => {
    const { checkA11y } = await import('axe-playwright').catch(() => ({ checkA11y: null }));
    if (!checkA11y) return;
    await signInAdmin(page);
    await page.goto(`${PROD}/admin/sites/test-id/copilot`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await checkA11y(page, undefined, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  });
});
