/**
 * Console-error gate helper.
 *
 * @remarks
 * Attach to a page before navigation.  After the test interaction completes,
 * call `assertNoConsoleErrors()` to fail if any `console.error` was emitted.
 * CSP violations and JS errors both surface here.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface ConsoleErrorCollector {
  errors: string[];
  assertNone: () => void;
}

export function watchConsoleErrors(page: Page): ConsoleErrorCollector {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', (err: Error) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  return {
    errors,
    assertNone: () => {
      expect(
        errors,
        `Expected zero console errors. Got:\n${errors.join('\n')}`,
      ).toHaveLength(0);
    },
  };
}
