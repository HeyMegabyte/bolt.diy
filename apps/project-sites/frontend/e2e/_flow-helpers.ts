/**
 * Shared harness for the full-flow E2E suite (`*.flow.e2e.ts`), run under
 * `playwright.prod.config.ts` against https://projectsites.dev.
 *
 * Every full-flow test is an ELABORATE, REALISTIC multi-step USER JOURNEY:
 *   seedSession → gotoAdmin → navigate by UI → act → assert UI → assert
 *   ground-truth via apiFetch → snap (visual inspection). Not element-presence.
 *
 * Auth = Pathway C (E2E_API_KEY → ps_session). The key authenticates as the
 * `e2e-test-org` owner (NOT super-admin) — owner surfaces work; System-Admin-only
 * surfaces 403 (cover by note, not assertion).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts <name>.flow
 */
import { expect, type Page, type ConsoleMessage } from '@playwright/test';

export const E2E_KEY = process.env.E2E_API_KEY ?? '';
export const hasKey = E2E_KEY.length > 0;

/** Pathway C: seed a psk_test_ key as ps_session so the admin shell authenticates. */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
      localStorage.setItem('ps_onboarding_dismissed', 'true');
    } catch {
      /* private mode — ignore */
    }
  }, E2E_KEY);
}

// Headless browsers emit noise that is NOT a product defect. Filtered from assertions.
const BENIGN = [
  'favicon',
  'googletagmanager',
  'google-analytics',
  'analytics.google',
  'region1.google-analytics',
  'cdn-cgi',
  'cloudflareinsights',
  'doubleclick',
  'posthog',
  'sentry',
  'third-party cookie',
  'content-security-policy',
  'net::err_blocked',
  'status of 429',
  'status of 401', // benign: super-admin-only / unauth probes for the e2e-test-org key
  'status of 404', // benign BY DESIGN: flag-gated reads 404 when dark (feature-flag doctrine), per admin-nav-links.e2e.ts
];
export function isRealError(text: string): boolean {
  const t = text.toLowerCase();
  return !BENIGN.some((b) => t.includes(b));
}

/** Wire console + pageerror capture; returns the mutable error list. */
export function attachConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if ((m.type() === 'error' || m.type() === 'warning') && isRealError(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (isRealError(String(e))) errors.push(String(e));
  });
  return errors;
}

/** Navigate to a route + wait for the SPA shell to be interactive (real content). */
export async function gotoAdmin(page: Page, path = '/admin'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const r = document.querySelector('app-admin, app-root, #root');
        return !!r && (r as HTMLElement).innerHTML.length > 200;
      },
      { timeout: 15000 },
    )
    .catch(() => {});
  // Settle Angular's first change-detection + the persistent bolt iframe boot.
  await page.waitForTimeout(1200);
}

/** Visual-inspection artifact: full-page screenshot → e2e/screenshots/flows/<name>.png */
export async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/flows/${name}.png`, fullPage: true }).catch(() => {});
}

/**
 * Ground-truth API call AS the seeded user (bearer). Per verify-against-source-of-truth:
 * a full-flow test asserts BOTH the rendered UI AND the authoritative store.
 */
export async function apiFetch<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T | null }> {
  return page.evaluate(
    async ([p, k, ini]) => {
      try {
        const res = await fetch(p as string, {
          method: (ini as { method?: string }).method ?? 'GET',
          body: (ini as { body?: string }).body,
          headers: {
            Authorization: `Bearer ${k}`,
            'Content-Type': 'application/json',
            ...((ini as { headers?: Record<string, string> }).headers ?? {}),
          },
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return { status: res.status, body };
      } catch {
        return { status: 0, body: null };
      }
    },
    [path, E2E_KEY, init] as const,
  ) as Promise<{ status: number; body: T | null }>;
}

/** Assert the captured console has no real errors, with a helpful head of the list. */
export function expectClean(errors: string[]): void {
  expect(errors, `console errors: ${errors.slice(0, 5).join(' | ')}`).toHaveLength(0);
}
