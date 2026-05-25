/**
 * @module e2e/helpers/axe
 * @description Thin wrapper around `@axe-core/playwright` providing
 * convenience helpers for WCAG 2.2 AA accessibility assertions in E2E tests.
 *
 * Aligns with the project's WCAG 2.2 AA requirement:
 * - Violations at severity `serious` or `critical` are hard failures.
 * - `moderate` and `minor` violations are collected and surfaced as
 *   informational warnings so they appear in the test report without
 *   blocking CI (axe cannot auto-detect all 2.2 new criteria — manual
 *   review is still required for focus-not-obscured, target-size, etc.).
 *
 * @example
 * ```ts
 * import { expectAxeClean } from './helpers/axe.js';
 *
 * test('homepage is accessible', async ({ page }) => {
 *   await page.goto(process.env.PROD_URL!);
 *   await expectAxeClean(page);
 * });
 * ```
 *
 * @see {@link https://www.deque.com/axe/} axe-core documentation
 * @see {@link https://playwright.dev/docs/accessibility-testing} Playwright accessibility guide
 */

import { AxeBuilder } from '@axe-core/playwright';
import { type Page } from '@playwright/test';

// Re-export the axe Result type so callers don't need to import axe-core directly.
export type { Result } from 'axe-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link axeViolations} and {@link expectAxeClean}.
 */
export interface AxeOptions {
  /**
   * Axe rule overrides — keyed by rule ID, value must include `enabled`.
   *
   * @example Disable a rule that has a known false-positive on this page:
   * ```ts
   * { 'color-contrast': { enabled: false } }
   * ```
   */
  rules?: Record<string, { enabled: boolean }>;

  /**
   * Limit the axe run to a specific CSS selector subtree.
   * Useful when testing a component in isolation.
   *
   * @example `'[data-testid="checkout-form"]'`
   */
  include?: string;

  /**
   * Exclude elements matching this CSS selector from the axe scan.
   * Use sparingly — prefer fixing the violation.
   */
  exclude?: string;

  /**
   * Tags restricting which rule set axe runs.
   * Defaults to `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']`.
   */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * WCAG tags to run by default.
 * Covers WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA, and axe best-practices.
 */
const DEFAULT_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

/**
 * Severity levels that constitute a hard failure.
 * `critical` and `serious` block the test; `moderate`/`minor` are warnings.
 */
const HARD_FAILURE_SEVERITIES: ReadonlySet<string> = new Set([
  'critical',
  'serious',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs an axe accessibility scan on the current page state and returns
 * all violations found.
 *
 * This is the low-level helper — prefer {@link expectAxeClean} for most tests.
 * Use this when you need to inspect the violation list, filter it, or
 * assert specific counts rather than a blanket "zero violations" check.
 *
 * @param page - Playwright Page instance (must already be navigated to the
 *   page under test).
 * @param opts - Optional scan overrides.
 * @returns Resolved array of axe `Result` violation objects. Empty when the
 *   page is clean.
 *
 * @example
 * ```ts
 * const violations = await axeViolations(page);
 * const criticalOnes = violations.filter(v => v.impact === 'critical');
 * expect(criticalOnes).toHaveLength(0);
 * ```
 */
export async function axeViolations(
  page: Page,
  opts?: AxeOptions,
): Promise<import('axe-core').Result[]> {
  let builder = new AxeBuilder({ page }).withTags(
    (opts?.tags ?? [...DEFAULT_TAGS]) as string[],
  );

  if (opts?.rules) {
    builder = builder.options({ rules: opts.rules });
  }

  if (opts?.include) {
    builder = builder.include(opts.include);
  }

  if (opts?.exclude) {
    builder = builder.exclude(opts.exclude);
  }

  const results = await builder.analyze();
  return results.violations;
}

/**
 * Asserts that the current page has zero axe violations at severity
 * `serious` or `critical` (matching the project's WCAG 2.2 AA bar).
 *
 * Violations at `moderate` or `minor` severity are printed to the test
 * output as advisory notes but do **not** cause the assertion to fail,
 * because axe cannot auto-detect several of the 9 new WCAG 2.2 criteria
 * (focus-not-obscured, target-size-minimum, accessible-auth, etc.) and
 * flags some as `moderate` even on technically-compliant pages.
 *
 * @param page - Playwright Page instance.
 * @param opts - Optional scan overrides (same as {@link axeViolations}).
 *
 * @throws When one or more violations with severity `serious` or `critical`
 *   are found. The error message includes the violation ID, description,
 *   impact level, and the first affected HTML node for each violation.
 *
 * @example
 * ```ts
 * test('homepage is accessible', async ({ page }) => {
 *   await page.goto(process.env.PROD_URL!);
 *   await expectAxeClean(page);
 * });
 * ```
 *
 * @example Exclude a known-false-positive rule:
 * ```ts
 * await expectAxeClean(page, { rules: { 'color-contrast': { enabled: false } } });
 * ```
 */
export async function expectAxeClean(
  page: Page,
  opts?: AxeOptions,
): Promise<void> {
  const violations = await axeViolations(page, opts);

  const hardFailures = violations.filter(
    (v) => v.impact != null && HARD_FAILURE_SEVERITIES.has(v.impact),
  );

  const softWarnings = violations.filter(
    (v) => v.impact != null && !HARD_FAILURE_SEVERITIES.has(v.impact),
  );

  // Surface advisory-only violations to stdout without failing the test
  if (softWarnings.length > 0) {
    console.warn(
      `[axe] ${softWarnings.length} advisory violation(s) (moderate/minor) — review manually:\n` +
        softWarnings
          .map(
            (v) =>
              `  • [${v.impact ?? 'unknown'}] ${v.id}: ${v.description} ` +
              `(${v.nodes.length} node(s))`,
          )
          .join('\n'),
    );
  }

  // Hard-fail on serious/critical violations
  if (hardFailures.length > 0) {
    const summary = hardFailures
      .map((v) => {
        const firstNode = v.nodes[0]?.html ?? '(no node HTML available)';
        return (
          `  ✗ [${v.impact}] ${v.id}: ${v.description}\n` +
          `    Help: ${v.helpUrl}\n` +
          `    First affected node: ${firstNode}`
        );
      })
      .join('\n\n');

    throw new Error(
      `[axe] ${hardFailures.length} serious/critical accessibility violation(s):\n\n${summary}\n\n` +
        'Fix these violations to meet the WCAG 2.2 AA requirement.\n' +
        'See https://www.deque.com/axe/core-documentation/api-documentation/ for guidance.',
    );
  }
}

/**
 * Asserts that a specific element subtree has zero serious/critical axe
 * violations. A focused alternative to {@link expectAxeClean} for
 * testing individual components.
 *
 * @param page - Playwright Page instance.
 * @param selector - CSS selector for the root element to scan.
 * @param opts - Optional scan overrides.
 *
 * @example
 * ```ts
 * await expectElementAxeClean(page, '[data-testid="checkout-form"]');
 * ```
 */
export async function expectElementAxeClean(
  page: Page,
  selector: string,
  opts?: Omit<AxeOptions, 'include'>,
): Promise<void> {
  await expectAxeClean(page, { ...opts, include: selector });
}
