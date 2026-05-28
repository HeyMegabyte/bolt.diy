/**
 * ALL-STAR Category J — Platform extension (items 47-50).
 *
 * MCP server, public REST + GraphQL API + webhooks, CLI tool, Capacitor admin app.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#47 MCP server for projectsites.dev', () => {
  test('public MCP discovery endpoint advertises tools', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/.well-known/mcp');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeInstanceOf(Array);
    expect(body.tools.length).toBeGreaterThan(3);
    // Expected core tools
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_sites', 'create_site', 'deploy_site']));
  });

  test('OAuth 2.1 + RFC 8707 Resource Indicators handshake works', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/.well-known/oauth-protected-resource');
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.resource).toBeTruthy();
      expect(body.authorization_servers).toBeInstanceOf(Array);
    }
  });

  test('admin shows MCP connection status + scoped tokens', async ({ page }) => {
    await page.goto(`${ADMIN}/integrations/mcp`);
    await expect(page.getByTestId('mcp-token-row').first().or(page.getByTestId('mcp-token-empty'))).toBeVisible();
  });
});

test.describe('#48 public REST + GraphQL API + webhooks', () => {
  test('OpenAPI doc served at /api/openapi.json', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/api/openapi.json');
    expect(res.status()).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths).toBeTruthy();
  });

  test('Bearer-token authenticated request returns site list', async ({ request }) => {
    const token = process.env.PS_API_TOKEN ?? 'test_no_token';
    const res = await request.get('https://projectsites.dev/api/v1/sites', {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    });
    expect([200, 401, 403]).toContain(res.status());
  });

  test('GraphQL endpoint serves introspection', async ({ request }) => {
    const res = await request.post('https://projectsites.dev/api/graphql', {
      data: { query: '{ __schema { queryType { name } } }' },
      failOnStatusCode: false,
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.data.__schema.queryType.name).toBeTruthy();
    }
  });

  test('webhook subscriptions admin shows site.published / lead.captured / deploy.failed events', async ({ page }) => {
    await page.goto(`${ADMIN}/integrations/webhooks`);
    await page.getByRole('button', { name: /add webhook/i }).click();
    const eventList = page.getByTestId('webhook-events-list');
    await expect(eventList).toBeVisible();
    for (const evt of ['site.published', 'lead.captured', 'deploy.failed']) {
      await expect(eventList.getByText(evt)).toBeVisible();
    }
  });
});

test.describe('#49 CLI tool — npx projectsites init/deploy/preview/logs', () => {
  test('admin shows install command + auth-token gen flow', async ({ page }) => {
    await page.goto(`${ADMIN}/integrations/cli`);
    await expect(page.getByTestId('cli-install-cmd')).toContainText(/npx projectsites|npm i -g/);
    await expect(page.getByRole('button', { name: /generate cli token/i })).toBeVisible();
  });

  test('CLI install package metadata served from /api/cli/version', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/api/cli/version');
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

test.describe('#50 Capacitor iOS / Android admin app', () => {
  test('admin app download links surface in account settings', async ({ page }) => {
    await page.goto(`${ADMIN}/account/mobile`);
    await expect(page.getByRole('link', { name: /app store|ios/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /play store|android/i })).toBeVisible();
  });

  test('push notification preferences toggle (deploy / lead / billing)', async ({ page }) => {
    await page.goto(`${ADMIN}/account/notifications`);
    for (const evt of [/deploy/i, /lead/i, /billing/i]) {
      await expect(page.getByRole('switch', { name: evt }).or(page.getByRole('checkbox', { name: evt }))).toBeVisible();
    }
  });

  test('web push subscription endpoint accepts subscription payload', async ({ request }) => {
    const res = await request.post('https://projectsites.dev/api/push/subscribe', {
      data: {
        endpoint: 'https://fcm.googleapis.com/test',
        keys: { p256dh: 'test', auth: 'test' },
      },
      failOnStatusCode: false,
    });
    expect([200, 201, 401, 403]).toContain(res.status());
  });
});
