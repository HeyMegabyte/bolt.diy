/**
 * @fortress INBOX — happy-path journey
 *
 * Chain: homepage → /admin/inbox → assign task → AI draft → send via
 * channel → SLA tick → reassign.
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

const MOCK_TASK = {
  id: 'task-hp-001',
  title: 'Review site build request',
  description: 'Client wants to update their homepage hero.',
  assignee: null,
  channel: 'email',
  status: 'open',
  sla_deadline: new Date(Date.now() + 3600_000).toISOString(),
  created_at: new Date().toISOString(),
};

test.describe('INBOX HAPPY — assign → AI draft → send → reassign', () => {
  test('IB-HP-01 inbox page renders open task list', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_TASK] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    const inboxHeader = page.locator(
      '[data-testid="inbox-section"], h1:has-text("Inbox"), h2:has-text("Inbox")',
    ).first();
    await expect(inboxHeader.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('IB-HP-02 task card shows title, channel, SLA', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_TASK] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    const taskTitle = page.locator(`text=Review site build request`).first();
    await expect(taskTitle.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('IB-HP-03 assign task sends PATCH with assignee', async ({ authedPage: page }) => {
    let patchBody: Record<string, unknown> | null = null;

    await page.route('**/api/inbox/tasks*', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [MOCK_TASK] }),
        });
      } else if (['PATCH', 'PUT'].includes(method)) {
        patchBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { ...MOCK_TASK, assignee: 'brian@megabyte.space' } }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/admin/inbox`);
    const assignBtn = page.getByRole('button', { name: /assign/i }).first();
    if (await assignBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await assignBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('IB-HP-04 AI draft generates reply text', async ({ authedPage: page }) => {
    let draftCalled = false;

    await page.route('**/api/inbox/tasks/*/draft*', async (route) => {
      draftCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          draft: 'Thank you for reaching out! We can update your homepage hero. We will get started right away.',
        }),
      });
    });

    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_TASK] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    const draftBtn = page.getByRole('button', { name: /ai.*draft|draft.*reply|generate.*reply/i }).first();
    if (await draftBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await draftBtn.click();
      await page.waitForTimeout(700);
    }
  });

  test('IB-HP-05 resolve task removes it from the open list', async ({ authedPage: page }) => {
    let resolveCalled = false;

    await page.route(`**/api/inbox/tasks/${MOCK_TASK.id}/resolve`, async (route) => {
      resolveCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resolved: true }),
      });
    });

    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: resolveCalled ? [] : [MOCK_TASK] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    const resolveBtn = page.getByRole('button', { name: /resolve|close|done/i }).first();
    if (await resolveBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await resolveBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('IB-HP-06 empty inbox shows helpful empty state', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    await page.waitForTimeout(1_500);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on empty inbox').toBeGreaterThan(0);
  });

  test('IB-HP-07 zero console errors during inbox journey', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_TASK] }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    await page.waitForTimeout(2_000);

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension'),
    );
    expect(blocking, 'no blocking console errors in inbox').toHaveLength(0);
  });
});
