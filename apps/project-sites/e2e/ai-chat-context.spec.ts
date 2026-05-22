/**
 * @fileoverview Playwright E2E for the per-site AI Chat extras panel:
 *   1. Sign-in via stubbed session.
 *   2. Open admin settings → AI Chat tab.
 *   3. Toggle "Allow web research".
 *   4. Upload a sample PDF via the file input.
 *   5. Confirm the file appears in the knowledge files list.
 *   6. Open the Context Summary modal, confirm markdown rendered.
 */
import { test, expect } from './fixtures.js';
import type { Page, Route } from '@playwright/test';

const SITE_ID = 'site-extras-1';
const ORG_ID = 'org-extras-1';
const USER_ID = 'user-extras-1';

interface ContextFile {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  source: 'upload' | 'drive';
  drive_file_id: string | null;
  extracted_chars: number;
  created_at: string;
}

const settingsState = {
  allow_web_research: false,
  drive_connected: false,
  drive_folder_id: null as string | null,
  drive_folder_name: null as string | null,
  drive_last_synced_at: null as string | null,
};

const files: ContextFile[] = [];

async function stubBackend(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'extras-token', email: 'test@megabyte.space' }),
    );
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { user_id: USER_ID, org_id: ORG_ID, email: 'test@megabyte.space' } }),
    });
  });

  await page.route('**/api/sites', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: SITE_ID,
            slug: 'extras-test',
            business_name: 'Extras Test',
            status: 'published',
            org_id: ORG_ID,
          },
        ],
      }),
    });
  });

  await page.route(`**/api/sites/${SITE_ID}/ai-settings`, async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      if ('allow_web_research' in body) {
        settingsState.allow_web_research = !!body['allow_web_research'];
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { saved: true } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { site_id: SITE_ID, slug: 'extras-test', business_name: 'Extras Test', ...settingsState } }),
    });
  });

  await page.route(`**/api/sites/${SITE_ID}/ai/context/files`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: files }),
    });
  });

  await page.route(`**/api/sites/${SITE_ID}/ai/context/upload`, async (route: Route) => {
    const id = `f-${files.length + 1}`;
    files.unshift({
      id,
      filename: 'sample.pdf',
      content_type: 'application/pdf',
      size_bytes: 1024,
      source: 'upload',
      drive_file_id: null,
      extracted_chars: 42,
      created_at: new Date().toISOString(),
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id, filename: 'sample.pdf', size_bytes: 1024, extracted_chars: 42 } }),
    });
  });

  await page.route(`**/api/sites/${SITE_ID}/ai/context/summary`, async (route: Route) => {
    const md = `# AI Chat context — Extras Test\n\n## System prompt\n\n_Using platform default._\n\n## Web research\n\n${settingsState.allow_web_research ? 'Enabled' : 'Disabled'}.\n\n## Knowledge files (${files.length})\n\n${files.map((f) => `### ${f.filename}\n\n- ${f.extracted_chars} chars`).join('\n\n')}`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { markdown: md, total_chars: files.reduce((a, f) => a + f.extracted_chars, 0), file_count: files.length },
      }),
    });
  });
}

test.describe('AI Chat extras', () => {
  test('toggle web research, upload PDF, open summary modal', async ({ page }) => {
    files.length = 0;
    settingsState.allow_web_research = false;

    await stubBackend(page);
    await page.goto('/admin/settings?tab=ai-chat');

    const extras = page.locator('[data-testid="ai-chat-extras-web-research"]');
    await expect(extras).toBeVisible();

    // 1. Toggle web research.
    const toggle = page.locator('[data-testid="ai-chat-extras-allow-web-research"]');
    await toggle.check();
    await expect(toggle).toBeChecked();

    // 2. Upload PDF via setInputFiles.
    const sampleBuf = Buffer.from('%PDF-1.4 minimal sample');
    await page.locator('[data-testid="ai-chat-extras-file-input"]').setInputFiles({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: sampleBuf,
    });

    // 3. Confirm file appears in the list.
    const list = page.locator('[data-testid="ai-chat-extras-files-list"]');
    await expect(list.getByText('sample.pdf')).toBeVisible({ timeout: 8000 });

    // 4. Open Context Summary modal.
    await page.locator('[data-testid="ai-chat-extras-view-summary"]').click();
    const summaryBody = page.locator('[data-testid="ai-chat-extras-summary-body"]');
    await expect(summaryBody).toBeVisible();
    await expect(summaryBody.getByRole('heading', { name: /AI Chat context/i })).toBeVisible();
    await expect(page.locator('[data-testid="ai-chat-extras-summary-stats"]')).toContainText('1 files');
  });
});
