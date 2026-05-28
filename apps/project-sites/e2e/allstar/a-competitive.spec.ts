/**
 * ALL-STAR Category A — Compete-or-die against Lovable / V0 / Bolt.
 *
 * Each `test.describe` block tests one of items 1-8 from `_ideas-50-allstar.md`,
 * starting from the desired end-state and working backwards through real-user
 * navigation (homepage → click nav → interact → assert).
 *
 * Status: TDD-RED — these specs drive the implementation; do NOT make them
 * conditional/skip just because the impl isn't shipped. The build fails until
 * impl lands.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';
const EDITOR = '/admin/editor';

test.describe('#1 multi-model router in bolt.diy', () => {
  test('user picks Claude Opus 4.7 / Sonnet 4.6 / Workers AI / GPT-5 per prompt', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /sign in|admin/i }).first().click();
    await page.goto(EDITOR);

    const modelPicker = page.getByTestId('bolt-model-picker');
    await expect(modelPicker).toBeVisible();

    // Expected models surfaced; build fails if any disappears (regression)
    for (const label of ['Claude Opus 4.7', 'Claude Sonnet 4.6', 'Workers AI Llama 3.3 70B', 'GPT-5']) {
      await expect(modelPicker.getByText(label)).toBeVisible();
    }

    await modelPicker.click();
    await page.getByRole('option', { name: 'Workers AI Llama 3.3 70B' }).click();
    await expect(modelPicker).toContainText('Workers AI');

    // Selection persists across reload (D1-backed preference)
    await page.reload();
    await expect(page.getByTestId('bolt-model-picker')).toContainText('Workers AI');
  });

  test('per-prompt override token-cost preview before send', async ({ page }) => {
    await page.goto(EDITOR);
    await page.getByTestId('bolt-prompt-input').fill('Add a pricing section');
    const costPreview = page.getByTestId('prompt-cost-preview');
    await expect(costPreview).toContainText(/\$0\.\d{2,4}/);
    // Workers AI = free; switch model, expect $0.00
    await page.getByTestId('bolt-model-picker').click();
    await page.getByRole('option', { name: /Workers AI/ }).click();
    await expect(costPreview).toContainText(/\$0\.00|free/i);
  });
});

test.describe('#2 one-click Supabase + Neon DB provisioning', () => {
  test('user provisions Neon Postgres for a generated site in <60s', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /database/i }).click();

    await page.getByRole('button', { name: /provision postgres|add database/i }).click();
    await page.getByRole('radio', { name: /neon/i }).check();
    await page.getByRole('button', { name: /create|provision/i }).click();

    // Provisioning runs via Workflow v2; UI shows step-progress
    await expect(page.getByTestId('provisioning-step-create-project')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('provisioning-step-connection-string')).toBeVisible({ timeout: 45_000 });

    // Final state — DB binding wired, conn string redacted in UI
    await expect(page.getByTestId('database-binding')).toContainText(/DATABASE_URL/);
    await expect(page.getByTestId('database-binding')).not.toContainText(/postgres:\/\/[^•]+/); // redacted
  });

  test('Supabase alternative provisions auth + storage in one flow', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /database/i }).click();
    await page.getByRole('button', { name: /provision postgres|add database/i }).click();
    await page.getByRole('radio', { name: /supabase/i }).check();
    await page.getByRole('button', { name: /create|provision/i }).click();
    await expect(page.getByTestId('supabase-auth-enabled')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('supabase-storage-enabled')).toBeVisible();
  });
});

test.describe('#3 SOC 2 immutable audit trail with hash-chain', () => {
  test('every admin mutation is logged with prev-hash + self-hash', async ({ page, request }) => {
    await page.goto(`${ADMIN}/audit`);
    const rows = page.getByTestId('audit-row');
    await expect(rows.first()).toBeVisible();

    // Each row exposes prev_hash + hash columns; clicking opens detail with chain verification
    await rows.first().click();
    const detail = page.getByTestId('audit-detail');
    await expect(detail.getByTestId('audit-hash')).toContainText(/^[a-f0-9]{64}$/);
    await expect(detail.getByTestId('audit-prev-hash')).toContainText(/^[a-f0-9]{64}$|^genesis$/);
    await expect(detail.getByTestId('audit-chain-valid')).toContainText(/verified/i);
  });

  test('tampering detection — invalid chain row shows red flag', async ({ page }) => {
    await page.goto(`${ADMIN}/audit?filter=tampered`);
    // Even on a clean prod DB, the UI must surface a "0 tampered events" or render the empty state
    await expect(
      page.getByTestId('tampered-count').or(page.getByTestId('audit-empty-tampered'))
    ).toBeVisible();
  });
});

test.describe('#4 GitHub two-way sync (commit-on-save, PR-per-branch)', () => {
  test('user connects GitHub via OAuth and pushes site changes', async ({ page }) => {
    await page.goto(`${ADMIN}/integrations/github`);
    const connectBtn = page.getByRole('button', { name: /connect github/i });
    if (await connectBtn.isVisible()) {
      // Connect button opens OAuth popup — assert href, don't follow
      await expect(connectBtn).toHaveAttribute('data-oauth-url', /github\.com\/login\/oauth\/authorize/);
    } else {
      // Already connected — show repo picker + branch
      await expect(page.getByTestId('github-repo-picker')).toBeVisible();
      await expect(page.getByTestId('github-branch-picker')).toBeVisible();
    }
  });

  test('commit-on-save creates real commit visible in repo list', async ({ page }) => {
    await page.goto(`${ADMIN}/integrations/github/activity`);
    await expect(page.getByTestId('github-commit-row').first()).toBeVisible();
    await expect(page.getByTestId('github-commit-row').first()).toContainText(/^[a-f0-9]{7}/);
  });
});

test.describe('#5 live token-burn meter in editor', () => {
  test('header shows tokens consumed today + monthly projection', async ({ page }) => {
    await page.goto(EDITOR);
    const meter = page.getByTestId('token-burn-meter');
    await expect(meter).toBeVisible();
    await expect(meter).toContainText(/\d+(\.\d+)?[KM]?\s*\/\s*\d+(\.\d+)?[KM]?/); // used / limit
    await expect(page.getByTestId('monthly-projection')).toContainText(/projection|forecast/i);
  });

  test('meter warns at 80% with toast + email-out-of-the-loop link', async ({ page }) => {
    await page.goto(`${ADMIN}/billing/usage`);
    // 80% threshold detail row visible (even if user is at 0%, the threshold marker is there)
    await expect(page.getByTestId('threshold-warning-80')).toBeVisible();
    await expect(page.getByTestId('threshold-warning-100')).toBeVisible();
  });

  test('clicking meter opens detailed per-model breakdown', async ({ page }) => {
    await page.goto(EDITOR);
    await page.getByTestId('token-burn-meter').click();
    await expect(page.getByTestId('usage-breakdown-modal')).toBeVisible();
    await expect(page.getByTestId('usage-breakdown-modal')).toContainText(/opus|sonnet|workers ai/i);
  });
});

test.describe('#6 snapshot-per-prompt rollback with diff preview', () => {
  test('history tab shows every AI edit as a snapshot row', async ({ page }) => {
    await page.goto(EDITOR);
    await page.getByRole('tab', { name: /history|snapshots/i }).click();
    await expect(page.getByTestId('snapshot-row').first()).toBeVisible();
  });

  test('clicking a snapshot row opens diff with revert button', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=history`);
    await page.getByTestId('snapshot-row').first().click();
    await expect(page.getByTestId('snapshot-diff-viewer')).toBeVisible();
    await expect(page.getByRole('button', { name: /revert|restore/i })).toBeVisible();
  });

  test('revert creates a NEW snapshot (forward-only history)', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=history`);
    const rowsBefore = await page.getByTestId('snapshot-row').count();
    await page.getByTestId('snapshot-row').nth(1).click();
    await page.getByRole('button', { name: /revert|restore/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    // Forward-only — count increases by 1, never decreases
    await expect.poll(async () => page.getByTestId('snapshot-row').count()).toBeGreaterThan(rowsBefore);
  });
});

test.describe('#7 streaming-first generation (<8s to first paint)', () => {
  test('hero section renders before total generation completes', async ({ page }) => {
    await page.goto(`${ADMIN}/new`);
    await page.getByTestId('site-prompt-input').fill('Bakery in Newark NJ called Bayonne Bakery');
    const t0 = Date.now();
    await page.getByRole('button', { name: /generate|create/i }).click();

    // Hero should appear within 8s — strict gate
    await expect(page.getByTestId('preview-hero')).toBeVisible({ timeout: 8_000 });
    const heroAt = Date.now() - t0;
    expect(heroAt).toBeLessThan(8_000);

    // Remaining sections stream in after
    await expect(page.getByTestId('preview-section-features')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('preview-section-pricing')).toBeVisible({ timeout: 45_000 });
  });

  test('streaming status panel shows route-by-route progress', async ({ page }) => {
    await page.goto(`${ADMIN}/new`);
    await page.getByTestId('site-prompt-input').fill('Plumber in Newark NJ');
    await page.getByRole('button', { name: /generate/i }).click();
    const statusPanel = page.getByTestId('generation-status-panel');
    await expect(statusPanel).toBeVisible();
    await expect(statusPanel.getByText(/\/$|home/i)).toBeVisible();
    await expect(statusPanel.getByText(/\/services/)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('#8 template marketplace with revenue-share', () => {
  test('public marketplace lists templates with author, price, demo link', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByTestId('template-card').first()).toBeVisible();
    const firstCard = page.getByTestId('template-card').first();
    await expect(firstCard.getByTestId('template-author')).toBeVisible();
    await expect(firstCard.getByTestId('template-price')).toContainText(/\$\d+|\bfree\b/i);
    await expect(firstCard.getByRole('link', { name: /demo|preview/i })).toBeVisible();
  });

  test('user filters by industry (plumber/restaurant/salon/lawyer/nonprofit)', async ({ page }) => {
    await page.goto('/templates');
    await page.getByRole('button', { name: /industry|filter/i }).click();
    await page.getByRole('checkbox', { name: /restaurant/i }).check();
    await expect(page.getByTestId('template-card')).not.toHaveCount(0);
    for (const card of await page.getByTestId('template-card').all()) {
      await expect(card).toContainText(/restaurant|food|bakery|cafe/i);
    }
  });

  test('creator opts in to revenue share with payout details', async ({ page }) => {
    await page.goto(`${ADMIN}/templates/publish`);
    await page.getByRole('checkbox', { name: /opt in.*revenue share/i }).check();
    await expect(page.getByTestId('payout-onboarding-stripe-connect')).toBeVisible();
    await expect(page.getByText(/70.*creator|30.*platform/i)).toBeVisible();
  });
});
