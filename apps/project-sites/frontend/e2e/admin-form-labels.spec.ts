/**
 * @file admin-form-labels.spec.ts
 * @description WCAG 1.3.1 (Info & Relationships) + 4.1.2 (Name, Role, Value)
 * regression gate for the form-control surfaces in four admin sections:
 * Webhooks, Automation Recipes, Email Deliverability, and Domains.
 *
 * Every `<input>` / `<select>` / `<textarea>` MUST expose a non-empty
 * programmatic accessible name — either via an associated `<label>`
 * (wrapping or `for`/`id`) or an `aria-label` for icon-only controls.
 * A control with no name is invisible to screen readers and assistive
 * tech: this spec fails the build if any tracked control loses its name.
 *
 * Runs in the dev/PR suite (`playwright.config.ts`, static server on :4300,
 * `authedPage` mock-auth fixture). The Create forms in these sections render
 * unconditionally once a site is selected — they sit ABOVE the flag-gate /
 * error notices — so the controls are always present even when the mock API
 * 404s the section's data endpoint.
 *
 * @see apps/project-sites/frontend/src/app/pages/admin/sections/webhooks.component.ts
 * @see apps/project-sites/frontend/src/app/pages/admin/sections/recipes.component.ts
 * @see apps/project-sites/frontend/src/app/pages/admin/sections/deliverability.component.ts
 * @see apps/project-sites/frontend/src/app/pages/admin/sections/domains.component.ts
 */
import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';

/**
 * Resolve the computed accessible name of a control. Playwright's
 * `getByRole(..., { name })` uses the same accname algorithm the browser
 * exposes to AT; here we read it generically by asking the page for the
 * control's accessible name via `aria-label` / associated `<label>` text.
 *
 * Returns the trimmed accessible name, or '' when the control is anonymous.
 */
async function accessibleName(control: Locator): Promise<string> {
  // Prefer the browser-computed name surfaced through the ARIA snapshot.
  // Fall back to label-text resolution for native controls.
  const name = await control.evaluate((el: Element): string => {
    const id = el.getAttribute('id');
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((ref) => el.ownerDocument.getElementById(ref)?.textContent ?? '')
        .join(' ')
        .trim();
      if (text) return text;
    }

    // Explicit <label for="id">
    if (id) {
      const explicit = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit && (explicit.textContent ?? '').trim()) {
        return (explicit.textContent ?? '').trim();
      }
    }

    // Implicit wrapping <label> with text content
    const wrapping = el.closest('label');
    if (wrapping && (wrapping.textContent ?? '').trim()) {
      return (wrapping.textContent ?? '').trim();
    }

    return '';
  });
  return name;
}

/**
 * Assert every tracked control on the current section has a non-empty
 * accessible name. `controls` maps a human description to its `data-testid`.
 */
async function assertNamed(page: Page, controls: Record<string, string>): Promise<void> {
  for (const [desc, testid] of Object.entries(controls)) {
    const control = page.locator(`[data-testid="${testid}"]`).first();
    await expect(control, `control "${desc}" (${testid}) should be present`).toBeVisible({
      timeout: 8000,
    });
    const name = await accessibleName(control);
    expect(name.length, `control "${desc}" (${testid}) must have an accessible name`).toBeGreaterThan(
      0,
    );
  }
}

test.describe('Admin form-control label association (WCAG 1.3.1 / 4.1.2)', () => {
  test('Webhooks — endpoint URL + event checkboxes are programmatically named', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/webhooks');
    await page.waitForLoadState('networkidle');

    await assertNamed(page, {
      'Endpoint URL input': 'webhooks-url',
    });

    // Every event checkbox carries its event name as its accessible label.
    const checkboxes = page.locator('[data-testid^="webhooks-event-"]');
    const count = await checkboxes.count();
    expect(count, 'at least one event checkbox should render').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const cb = checkboxes.nth(i);
      await expect(cb).toBeVisible();
      const name = await accessibleName(cb);
      expect(name.length, `event checkbox ${i} must have an accessible name`).toBeGreaterThan(0);
    }
  });

  test('Recipes — name, trigger, action, config + Enabled toggle are named', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/recipes');
    await page.waitForLoadState('networkidle');

    await assertNamed(page, {
      'Recipe name input': 'recipes-name',
      'Trigger select': 'recipes-trigger',
      'Action select': 'recipes-action',
      'Primary config input': 'recipes-cfg-primary',
    });

    // The "Enabled" checkbox is wrapped in a <label><span>Enabled</span>.
    const enabled = page.locator('input[type="checkbox"][hlmCheckbox]').last();
    if (await enabled.count()) {
      const name = await accessibleName(enabled);
      expect(name.length, 'Enabled toggle must have an accessible name').toBeGreaterThan(0);
    }
  });

  test('Deliverability — sending-domain input is programmatically named', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/deliverability');
    await page.waitForLoadState('networkidle');

    await assertNamed(page, {
      'Sending domain input': 'deliverability-domain',
    });
  });

  test('Domains — custom-domain + AI-search inputs are programmatically named', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/domains');
    await page.waitForLoadState('networkidle');

    await assertNamed(page, {
      'Custom domain input': 'custom-domain-input',
      'AI domain-search input': 'ai-search-input',
    });
  });
});
