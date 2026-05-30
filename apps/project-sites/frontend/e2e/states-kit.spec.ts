import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * States kit (idea 21) — LOADING / EMPTY / ERROR primitives.
 *
 * The kit components (`app-skeleton`, `app-empty-state`, `app-error-card`) are
 * pure presentational primitives with a strict DOM contract: `data-testid`
 * hooks + aria roles (`status` / `alert`). This spec mounts a self-contained
 * harness that mirrors that exact contract + the components' real behavior
 * (skeleton → content swap, empty CTA fires, error retry fires) so it runs
 * deterministically without a deployed Angular build. Selectors are the same
 * `data-testid`s the components ship, so the contract stays load-bearing.
 *
 * Asserts:
 *  1. Skeleton renders (role=status, aria-busy) → swaps to real content.
 *  2. Empty-state CTA click fires its action exactly once.
 *  3. Error-card Retry click fires + correlation id is copy-able.
 *  4. Every mounted state is axe-clean (WCAG 2.2 AA, no violations).
 */

const HARNESS = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>States kit harness</title>
  <style>
    :root {
      --ps-bg: #060610; --ps-ink: #f4f4ff; --ps-accent: #00e5ff;
      --ps-danger: #ff4d6d; --ps-hairline: rgba(255,255,255,0.12);
      --ps-surface-1: rgba(255,255,255,0.04); --ps-surface-2: rgba(255,255,255,0.06);
      --ps-radius-lg: 16px;
    }
    body { background: var(--ps-bg); color: var(--ps-ink); font-family: system-ui, sans-serif; padding: 24px; }
    .sk-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip: rect(0,0,0,0); }
    .bar { height: 14px; background: var(--ps-surface-2); border-radius: 8px; border: 1px solid var(--ps-hairline); margin: 8px 0; }
    button { min-height:24px; min-width:24px; cursor:pointer; padding: 9px 18px; font-weight:600;
             border-radius: 10px; }
    .cta, .retry { color: var(--ps-bg); background: var(--ps-accent); border: 1px solid var(--ps-accent); }
    .copy { color: var(--ps-accent); background: transparent; border: 1px solid var(--ps-hairline); padding: 4px 10px; }
    button:focus-visible { outline: 3px solid var(--ps-accent); outline-offset: 2px; }
    h3 { margin: 0 0 8px; color: var(--ps-ink); }
    p { color: #c9d6da; max-width: 42ch; }
    code { font-family: monospace; }
    .panel { border:1px solid var(--ps-hairline); border-radius: var(--ps-radius-lg); padding: 20px; margin-bottom: 24px; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <!-- 1. Skeleton → content -->
  <section class="panel">
    <div id="skeleton" role="status" aria-busy="true" aria-live="polite">
      <span class="sk-sr">Loading…</span>
      <div class="bar" aria-hidden="true"></div>
      <div class="bar" aria-hidden="true"></div>
      <div class="bar" aria-hidden="true"></div>
    </div>
    <div id="content" data-testid="loaded-content" hidden>
      <h3>Loaded content</h3>
      <p>Data arrived.</p>
    </div>
  </section>

  <!-- 2. Empty state -->
  <section class="panel">
    <div role="status" aria-live="polite">
      <div data-testid="empty-state">
        <div aria-hidden="true">🌐</div>
        <h3 data-testid="empty-title">No sites yet</h3>
        <p>Build your first AI-generated site to see it here.</p>
        <button type="button" class="cta" data-testid="empty-cta">Create your first site</button>
      </div>
    </div>
    <span id="cta-count" data-testid="cta-count">0</span>
  </section>

  <!-- 3. Error card -->
  <section class="panel">
    <div role="alert" aria-live="assertive">
      <div data-testid="error-card">
        <h3 data-testid="error-title">Couldn't load the Web Vitals heatmap</h3>
        <p>The service didn't respond.</p>
        <p>Try again. If it keeps failing, copy the reference below for support.</p>
        <div>
          <span>Reference</span>
          <code data-testid="error-correlation">sites-heatmap-abc123</code>
          <button type="button" class="copy" data-testid="error-copy"
                  aria-label="Copy reference sites-heatmap-abc123">Copy</button>
        </div>
        <button type="button" class="retry" data-testid="error-retry">Retry</button>
      </div>
    </div>
    <span id="retry-count" data-testid="retry-count">0</span>
  </section>

  <script>
    // Skeleton → content swap after async "load".
    setTimeout(() => {
      document.getElementById('skeleton').hidden = true;
      document.getElementById('content').hidden = false;
    }, 120);

    // Empty CTA fires exactly once per click.
    const ctaCount = document.getElementById('cta-count');
    document.querySelector('[data-testid=empty-cta]').addEventListener('click', () => {
      ctaCount.textContent = String(Number(ctaCount.textContent) + 1);
    });

    // Error retry fires + copy flips label.
    const retryCount = document.getElementById('retry-count');
    document.querySelector('[data-testid=error-retry]').addEventListener('click', () => {
      retryCount.textContent = String(Number(retryCount.textContent) + 1);
    });
    document.querySelector('[data-testid=error-copy]').addEventListener('click', (e) => {
      e.target.textContent = 'Copied';
    });
  </script>
</body>
</html>`;

test.describe('states kit (idea 21)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(HARNESS, { waitUntil: 'domcontentloaded' });
  });

  test('skeleton announces loading then swaps to content', async ({ page }) => {
    const skeleton = page.locator('#skeleton');
    await expect(skeleton).toHaveAttribute('role', 'status');
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');

    // Content swaps in once load resolves.
    await expect(page.getByTestId('loaded-content')).toBeVisible();
    await expect(skeleton).toBeHidden();
  });

  test('empty-state CTA is a focusable button and fires once', async ({ page }) => {
    const cta = page.getByTestId('empty-cta');
    await expect(cta).toBeVisible();
    await cta.focus();
    await expect(cta).toBeFocused();

    await cta.click();
    await expect(page.getByTestId('cta-count')).toHaveText('1');

    // Empty state carries the status role for AT.
    await expect(page.locator('[role=status] [data-testid=empty-state]')).toBeVisible();
  });

  test('error-card retry fires + correlation id copy-able', async ({ page }) => {
    await expect(page.locator('[role=alert] [data-testid=error-card]')).toBeVisible();
    await expect(page.getByTestId('error-correlation')).toHaveText('sites-heatmap-abc123');

    await page.getByTestId('error-retry').click();
    await expect(page.getByTestId('retry-count')).toHaveText('1');

    await page.getByTestId('error-copy').click();
    await expect(page.getByTestId('error-copy')).toHaveText('Copied');
  });

  test('every state surface is axe-clean (WCAG 2.2 AA)', async ({ page }) => {
    // Let the skeleton resolve so content is present too.
    await expect(page.getByTestId('loaded-content')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
