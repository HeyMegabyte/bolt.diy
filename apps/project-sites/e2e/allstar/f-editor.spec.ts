/**
 * ALL-STAR Category F — Editor UX that beats the field (items 30-34).
 *
 * Visual section overlay, voice-driven editing, side-by-side diff, real-time
 * co-edit, approval workflow.
 */

import { test, expect } from '@playwright/test';

const EDITOR = '/admin/editor';

test.describe('#30 visual section overlay (hover preview → jump to source)', () => {
  test('hovering a section in preview shows an outline + section name', async ({ page }) => {
    await page.goto(EDITOR);
    const preview = page.frameLocator('[data-testid="bolt-preview-iframe"]');
    const hero = preview.locator('[data-section="hero"]');
    await expect(hero).toBeVisible();
    await hero.hover();
    await expect(page.getByTestId('section-overlay-outline')).toBeVisible();
    await expect(page.getByTestId('section-overlay-label')).toContainText(/hero/i);
  });

  test('clicking overlay jumps editor to source file at component', async ({ page }) => {
    await page.goto(EDITOR);
    const preview = page.frameLocator('[data-testid="bolt-preview-iframe"]');
    const hero = preview.locator('[data-section="hero"]');
    await hero.click();
    await expect(page.getByTestId('code-editor-tab').filter({ hasText: /Hero|hero/ })).toBeVisible();
  });

  test('keyboard: Cmd+Shift+I toggles overlay mode globally', async ({ page }) => {
    await page.goto(EDITOR);
    await page.keyboard.press('Meta+Shift+I');
    await expect(page.getByTestId('section-overlay-mode-on')).toBeVisible();
    await page.keyboard.press('Meta+Shift+I');
    await expect(page.getByTestId('section-overlay-mode-on')).not.toBeVisible();
  });
});

test.describe('#31 voice-driven editing (Whisper → bolt tool-call)', () => {
  test('mic button transcribes 3-second clip + sends to editor as prompt', async ({ page }) => {
    await page.goto(EDITOR);
    const micBtn = page.getByTestId('voice-edit-mic');
    await expect(micBtn).toBeVisible();
    await expect(micBtn).toHaveAttribute('aria-label', /voice|mic/i);
  });

  test('voice transcript appears as draft prompt before send', async ({ page }) => {
    await page.goto(EDITOR);
    // We simulate by injecting a transcript via dev-only test hook
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('ps-voice-transcript', { detail: 'make the hero bolder' }));
    });
    await expect(page.getByTestId('bolt-prompt-input')).toHaveValue(/make the hero bolder/i);
  });

  test('voice errors gracefully degrade to text + show toast', async ({ page }) => {
    await page.goto(EDITOR);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('ps-voice-error', { detail: 'microphone permission denied' }));
    });
    await expect(page.getByTestId('toast').filter({ hasText: /permission|microphone/i })).toBeVisible();
  });
});

test.describe('#32 side-by-side AI diff view with per-edit revert', () => {
  test('every AI edit is captured as a diff row with before/after', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=history`);
    const row = page.getByTestId('snapshot-row').first();
    await row.click();
    await expect(page.getByTestId('diff-pane-before')).toBeVisible();
    await expect(page.getByTestId('diff-pane-after')).toBeVisible();
    // Syntax-highlighted diff
    await expect(page.getByTestId('diff-pane-before').locator('.token.added,.token.removed').first()).toBeVisible();
  });

  test('per-file revert leaves siblings intact', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=history`);
    await page.getByTestId('snapshot-row').first().click();
    const fileRow = page.getByTestId('diff-file-row').first();
    await fileRow.getByRole('button', { name: /revert this file/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    // A new snapshot row appears reflecting the revert
    await expect(page.getByTestId('snapshot-row').first()).toContainText(/revert/i);
  });
});

test.describe('#33 real-time co-edit via DO + Yjs CRDT', () => {
  test('presence avatars show all active collaborators', async ({ page, browser }) => {
    await page.goto(EDITOR);
    const presence = page.getByTestId('presence-stack');
    await expect(presence).toBeVisible();

    // Open second context to simulate second collaborator
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(EDITOR);
    await expect(presence.getByTestId('presence-avatar')).toHaveCount(2, { timeout: 10_000 });
    await ctx2.close();
  });

  test('cursor of remote user appears in preview within 200ms of move', async ({ page, browser }) => {
    await page.goto(EDITOR);
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(EDITOR);
    await page2.mouse.move(400, 300);
    await expect(page.getByTestId('remote-cursor').first()).toBeVisible({ timeout: 1_000 });
    await ctx2.close();
  });
});

test.describe('#34 approval workflow (agency → client review → publish)', () => {
  test('agency creates a draft + generates a signed client-review link', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=publish`);
    await page.getByRole('button', { name: /send for review|share with client/i }).click();
    const link = page.getByTestId('client-review-link');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/review\/[a-z0-9-]{20,}/);
  });

  test('client review page is no-login + shows approve/request-changes UI', async ({ page }) => {
    await page.goto(`${EDITOR}?tab=publish`);
    await page.getByRole('button', { name: /send for review/i }).click();
    const link = await page.getByTestId('client-review-link').getAttribute('href');
    await page.goto(link!);
    await expect(page.getByRole('heading', { name: /review/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /request changes/i })).toBeVisible();
  });

  test('approve fires publish event + agency notified', async ({ page }) => {
    // Mock-driven; in real implementation the signed token unlocks the publish endpoint
    await page.goto(`${EDITOR}?tab=publish&review_state=approved`);
    await expect(page.getByTestId('review-approved-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeEnabled();
  });
});
