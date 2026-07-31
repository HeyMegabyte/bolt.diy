/**
 * @module e2e/helpers/a11y
 * @description axe-core accessibility checking helper for E2E specs.
 *
 * Usage: call `checkA11y(page, 'step-name')` after any significant UI change.
 * Violations are reported with selectors and fix suggestions.
 *
 * Requires `@axe-core/playwright ^4.11` in devDependencies.
 */
import { type Page } from '@playwright/test';

let _axe: typeof import('@axe-core/playwright') | null = null;

async function _loadAxe() {
  if (!_axe) {
    _axe = await import('@axe-core/playwright');
  }
  return _axe;
}

/**
 * Run axe-core on the current page and fail the test on violations.
 *
 * @param page - Playwright Page instance
 * @param stepName - Human-readable step name for error context
 * @param options - axe run options (defaults to WCAG 2.2 AA)
 */
export async function checkA11y(
  page: Page,
  stepName: string,
  options?: { includedImpacts?: string[] },
): Promise<void> {
  const axe = await _loadAxe();
  const results = await axe.analyze(page, {
    ...options,
    resultTypes: ['violations'],
  });
  // axe.analyze returns { violations: [...] }
  const violations = 'violations' in results ? results.violations : [];

  if (violations.length > 0) {
    const summary = violations
      .map((v: any) => `  [${v.impact}] ${v.help}: ${v.nodes?.length ?? 0} nodes (${v.id})`)
      .join('\n');
    throw new Error(
      `axe-core violations at "${stepName}":\n${summary}\n\n` +
        `Full report: ${JSON.stringify(violations, null, 2)}`,
    );
  }
}
