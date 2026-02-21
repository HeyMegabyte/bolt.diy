/**
 * E2E tests for the "AI Edit" feature:
 * - Clicking "AI Edit" opens bolt.megabyte.space with the correct importChatFrom URL
 * - The /api/sites/by-slug/:slug/chat endpoint returns valid chat JSON
 * - The editSiteInBolt() function constructs the correct URL
 * - Chat data has messages array and description
 */
import { test, expect } from './fixtures';

test.describe('AI Edit – chat API endpoint', () => {
  test('GET /api/sites/by-slug/:slug/chat returns valid chat JSON', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty('messages');
    expect(json).toHaveProperty('description');
    expect(Array.isArray(json.messages)).toBe(true);
    expect(json.messages.length).toBeGreaterThan(0);
  });

  test('chat endpoint returns messages with required fields', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    for (const msg of json.messages) {
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(['user', 'assistant']).toContain(msg.role);
      expect(typeof msg.content).toBe('string');
    }
  });

  test('chat endpoint returns 404 for non-existent slug', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/nonexistent-slug-xyz/chat');
    expect(res.status()).toBe(404);
  });

  test('chat endpoint includes CORS headers', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    expect(res.headers()['access-control-allow-origin']).toBe('*');
    expect(res.headers()['content-type']).toContain('application/json');
  });
});

test.describe('AI Edit – editSiteInBolt() URL construction', () => {
  test('editSiteInBolt function is defined and constructs correct URL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    // Verify the editSiteInBolt function exists
    const fnExists = await page.evaluate(() => typeof (window as any).editSiteInBolt === 'function');
    expect(fnExists).toBe(true);
  });

  test('editSiteInBolt generates correct bolt URL with importChatFrom', async ({ page }) => {
    await page.goto('/');

    // Capture the URL that would be opened
    const boltUrl = await page.evaluate(() => {
      // Override window.open to capture the URL
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('my-test-site');
      window.open = origOpen;

      return capturedUrl;
    });

    expect(boltUrl).toContain('bolt.megabyte.space');
    expect(boltUrl).toContain('importChatFrom=');

    // The importChatFrom param should point to the chat API
    const url = new URL(boltUrl);
    const importFrom = url.searchParams.get('importChatFrom');
    expect(importFrom).toBeTruthy();
    expect(importFrom).toContain('/api/sites/by-slug/my-test-site/chat');
  });

  test('editSiteInBolt URL-encodes the slug properly', async ({ page }) => {
    await page.goto('/');

    const boltUrl = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('my site & stuff');
      window.open = origOpen;

      return capturedUrl;
    });

    // The slug should be properly encoded in the URL
    const url = new URL(boltUrl);
    const importFrom = url.searchParams.get('importChatFrom');
    expect(importFrom).toContain('my%20site%20%26%20stuff');
  });
});

test.describe('AI Edit – admin dashboard integration', () => {
  test('AI Edit button markup is present for published sites', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();

    // The editSiteInBolt function should be defined in the page
    expect(html).toContain('editSiteInBolt');
    // The AI Edit button is rendered via JS for published sites, but the function must exist
    expect(html).toContain('Edit in AI Editor');
  });

  test('AI Edit button opens bolt with chat import URL', async ({ page }) => {
    await page.goto('/');

    // Simulate what happens when the admin dashboard renders a published site
    // and user clicks AI Edit - verify the flow by calling editSiteInBolt directly
    const result = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      // Call the function as if clicking AI Edit
      (window as any).editSiteInBolt('example-business');
      window.open = origOpen;

      // Parse the generated URL
      const u = new URL(capturedUrl);
      return {
        host: u.host,
        importChatFrom: u.searchParams.get('importChatFrom'),
      };
    });

    expect(result.host).toBe('bolt.megabyte.space');
    expect(result.importChatFrom).toBeTruthy();
    expect(result.importChatFrom).toContain('/api/sites/by-slug/example-business/chat');
  });
});
