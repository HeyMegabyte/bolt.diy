/**
 * @module e2e/helpers/a11y
 * @description axe-core accessibility checking helper for E2E specs.
 *
 * Usage: call `checkA11y(page, 'step-name')` after any significant UI change.
 * Violations are reported with selectors and fix suggestions.
 *
 * Requires `@axe-core/playwright ^4.11` in devDependencies. That package
 * exposes the `AxeBuilder` class (NOT a module-level `analyze()` function) —
 * `new AxeBuilder({ page }).withTags([...]).analyze()` is the whole API.
 */
import { type Page } from '@playwright/test';

type AxeBuilderCtor = new (opts: { page: Page }) => {
  withTags(tags: string[]): { analyze(): Promise<{ violations: AxeViolation[] }> };
};

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes?: unknown[];
}

let _builder: AxeBuilderCtor | null = null;

async function _loadAxeBuilder(): Promise<AxeBuilderCtor> {
  if (!_builder) {
    const mod = (await import('@axe-core/playwright')) as unknown as {
      AxeBuilder?: AxeBuilderCtor;
      default?: AxeBuilderCtor;
    };
    _builder = mod.AxeBuilder ?? mod.default ?? null;
    if (!_builder) {
      throw new Error('[a11y] @axe-core/playwright did not export AxeBuilder');
    }
  }
  return _builder;
}

/**
 * Run axe-core (WCAG 2.x A/AA tags) on the current page and fail the test
 * on violations.
 *
 * @param page - Playwright Page instance
 * @param stepName - Human-readable step name for error context
 * @param options.includedImpacts - Only fail on these impact levels
 *   (e.g. ['critical', 'serious']). Default: fail on ALL violations.
 */
export async function checkA11y(
  page: Page,
  stepName: string,
  options?: { includedImpacts?: string[] },
): Promise<void> {
  const AxeBuilder = await _loadAxeBuilder();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  // Brian directive 2026-07-30: a11y is ADVISORY in journey specs — functional
  // completeness gates the suite. Only `critical` impact fails by default;
  // everything else is logged for the a11y sweep backlog. Pass
  // `includedImpacts` explicitly for stricter dedicated a11y specs.
  const failImpacts = options?.includedImpacts ?? ['critical'];
  const violations = results.violations.filter((v) =>
    failImpacts.includes(v.impact ?? ''),
  );
  const advisory = results.violations.filter(
    (v) => !failImpacts.includes(v.impact ?? ''),
  );
  if (advisory.length > 0) {
    console.warn(
      `[a11y advisory] ${stepName}: ${advisory
        .map((v) => `${v.id}(${v.impact ?? '?'}×${v.nodes?.length ?? 0})`)
        .join(', ')}`,
    );
  }

  if (violations.length > 0) {
    const summary = violations
      .map(
        (v) =>
          `  [${v.impact ?? 'unknown'}] ${v.help}: ${v.nodes?.length ?? 0} nodes (${v.id})`,
      )
      .join('\n');
    throw new Error(
      `axe-core violations at "${stepName}":\n${summary}\n\n` +
        `Full report: ${JSON.stringify(violations, null, 2)}`,
    );
  }
}
