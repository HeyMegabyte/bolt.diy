/**
 * E2E tests for interactive modal flows: Deploy modal, Files modal,
 * Reset modal, Status modal, Delete modal, and Escape key handling.
 */
import { test, expect } from './fixtures.js';

test.describe('Deploy Modal', () => {
  test('openDeployModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openDeployModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeDeployModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeDeployModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('deploy modal element exists in DOM', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#deploy-modal');
    await expect(modal).toBeAttached();
  });

  test('deploy modal is hidden by default', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#deploy-modal');
    const display = await modal.evaluate((el) => getComputedStyle(el).display);
    expect(display === 'none' || !await modal.isVisible()).toBeTruthy();
  });

  test('deploy modal has ZIP upload zone', async ({ page }) => {
    await page.goto('/');
    const zipZone = page.locator('#deploy-zip-input, [class*="deploy-zip"], input[accept=".zip"]');
    await expect(zipZone.first()).toBeAttached();
  });

  test('submitDeploy function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).submitDeploy === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('parseZipFolders function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).parseZipFolders === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Files Modal', () => {
  test('openFilesModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openFilesModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeFilesModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeFilesModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('files modal element exists in DOM', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#files-modal');
    await expect(modal).toBeAttached();
  });

  test('files modal has file tree container', async ({ page }) => {
    await page.goto('/');
    const tree = page.locator('#files-list, #file-tree, [class*="file-tree"]');
    await expect(tree.first()).toBeAttached();
  });

  test('files modal has editor area', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('#files-editor, [class*="file-editor"]');
    await expect(editor.first()).toBeAttached();
  });

  test('file operation functions exist', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        openFileForEdit: typeof w.openFileForEdit === 'function',
        closeFileEditor: typeof w.closeFileEditor === 'function',
        submitNewFile: typeof w.submitNewFile === 'function',
        toggleFolder: typeof w.toggleFolder === 'function',
        renderFileTree: typeof w.renderFileTree === 'function',
      };
    });
    expect(fns.openFileForEdit).toBe(true);
    expect(fns.closeFileEditor).toBe(true);
    expect(fns.submitNewFile).toBe(true);
    expect(fns.toggleFolder).toBe(true);
    expect(fns.renderFileTree).toBe(true);
  });
});

test.describe('Reset Modal', () => {
  test('openResetModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openResetModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('submitReset function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).submitReset === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Status Modal', () => {
  test('openStatusModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openStatusModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeStatusModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeStatusModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('status modal functions exist', async ({ page }) => {
    await page.goto('/');
    // The status modal may be dynamically created; verify the functions exist
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        open: typeof w.openStatusModal === 'function',
        close: typeof w.closeStatusModal === 'function',
      };
    });
    expect(fns.open).toBe(true);
    expect(fns.close).toBe(true);
  });

  test('status terminal functions exist', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        start: typeof w.startStatusTerminal === 'function',
        stop: typeof w.stopStatusTerminal === 'function',
      };
    });
    expect(fns.start).toBe(true);
    expect(fns.stop).toBe(true);
  });
});

test.describe('Delete Modal', () => {
  test('openDeleteModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openDeleteModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeDeleteModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeDeleteModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('confirmDeleteSite function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).confirmDeleteSite === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('delete modal element exists in DOM', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#delete-modal');
    await expect(modal).toBeAttached();
  });
});

test.describe('Escape Key Closes Modals', () => {
  test('pressing Escape closes details modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });

    // Open details modal via search
    const input = page.locator('#search-input');
    await input.fill('Pizza');

    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const result = dropdown.locator('.search-result').first();
    await result.click();

    await expect(page.locator('#details-modal.visible').first()).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const modal = page.locator('#details-modal.visible');
    // After Escape, the modal should no longer be visible
    const isVisible = await modal.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });
});

test.describe('New Website Modal', () => {
  test('openNewWebsiteModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openNewWebsiteModal === 'function';
    });
    expect(hasFn).toBe(true);
  });
});
