/**
 * Admin — Site Branches Journey (STRICT — zero soft-guards)
 *
 * Covers /admin/sites/:id/branches — branch-style preview management for a
 * single site (#27). The component reads siteId from the ROUTE (:id param on
 * the flat `sites/:id/branches` route), so we navigate directly to
 * /admin/sites/e2e-site-001/branches — e2e-site-001 is the ONE site the auth
 * helper stubs into the sites list (selectedSite() === sites[0]).
 *
 * Known-good selectors reused from the pass-9-revived e2e/branches/branches.spec.ts:
 * `site-branches`, `branch-new-toggle`, `branch-name-input` (+ `branch-create-submit`).
 *
 * Contract:
 * - signInAsTestUser(page) FIRST; section stubs register AFTER it so they win
 *   reverse-match order over the auth helper's benign `**` catch-all (whose
 *   `{"data":[]}` shape would otherwise trip the component's Array.isArray
 *   guard into the "temporarily unavailable" error card).
 * - ALL mutations intercepted; the create POST is captured and its body
 *   asserted (branch_name + clamped approvals_required).
 * - Glob law: mid-token `**` cannot cross '/', so the list endpoint gets a
 *   query-suffix glob AND the per-branch action subpaths get a `/**` twin.
 * - Name value-domain mini-set (valid / empty / overlong-200 / injection) is
 *   asserted against the disabled-or-inline-error contract — a disabled
 *   submit is NEVER clicked.
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

interface CapturedPost {
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Deterministic branch list. Shape mirrors the worker's
 * GET /api/sites/:id/branches response the component parses in loadBranches():
 * `{ branches: Branch[] }`. One branch per lifecycle branch so every template
 * path renders:
 * - homepage-redesign  review 1/2  → Approve + Close buttons, progressbar 50%
 * - pricing-v2         draft  0/1  → Request review + Close buttons
 * - holiday-hero       merged 1/1  → terminal "—" actions cell
 */
const BRANCHES_PAYLOAD = {
  branches: [
    {
      id: 'br-001',
      branch_name: 'homepage-redesign',
      status: 'review',
      preview_url: 'https://homepage-redesign--e2e-test-site.projectsites.dev',
      approvals_required: 2,
      approvals_received: 1,
      created_by: 'e2e-test-user-id',
      created_at: '2026-07-20T12:00:00Z',
    },
    {
      id: 'br-002',
      branch_name: 'pricing-v2',
      status: 'draft',
      preview_url: null,
      approvals_required: 1,
      approvals_received: 0,
      created_by: 'e2e-test-user-id',
      created_at: '2026-07-22T09:30:00Z',
    },
    {
      id: 'br-003',
      branch_name: 'holiday-hero',
      status: 'merged',
      preview_url: 'https://holiday-hero--e2e-test-site.projectsites.dev',
      approvals_required: 1,
      approvals_received: 1,
      created_by: 'e2e-test-user-id',
      created_at: '2026-07-01T08:00:00Z',
    },
  ],
};

/**
 * Registers the section's deterministic stubs. MUST run AFTER
 * signInAsTestUser(page) — Playwright matches routes in reverse registration
 * order, so these override the auth helper's benign catch-all.
 * Returns the array that accumulates captured branch mutations.
 */
async function installBranchesStubs(page: Page): Promise<CapturedPost[]> {
  const posts: CapturedPost[] = [];

  // ALL mutations intercepted with a benign 200; GETs fall through to the
  // more-specific handlers below or to the auth helper's routes.
  // glob-ok: deliberate catch-all, mutation-only fulfill.
  await page.route('**/api/**', (route) => {
    const m = route.request().method();
    if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });

  // Per-branch action subpath twin — POST /api/sites/:id/branches/:bid/{review,
  // approve,merge,close}. Captured + fulfilled benignly so no action ever
  // reaches prod. glob-ok: '/**' twin — mid-token ** cannot cross '/'.
  await page.route('**/api/sites/e2e-site-001/branches/**', (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    posts.push({ url: req.url(), body: req.postDataJSON() as Record<string, unknown> | null });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Branch list + create — GET/POST /api/sites/e2e-site-001/branches (and
  // ?query variants). Registered LAST so it wins reverse-match order.
  // glob-ok: query-suffix only — action subpaths handled by the /** twin above.
  await page.route('**/api/sites/e2e-site-001/branches**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(BRANCHES_PAYLOAD),
      });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown> | null;
      posts.push({ url: req.url(), body });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          branch: {
            id: 'br-new-001',
            branch_name: (body?.branch_name as string) ?? 'feature-hero-v2',
            status: 'draft',
            preview_url: null,
            approvals_required: (body?.approvals_required as number) ?? 1,
            approvals_received: 0,
            created_by: 'e2e-test-user-id',
            created_at: '2026-07-31T00:00:00Z',
          },
        }),
      });
    }
    return route.fallback();
  });

  return posts;
}

/** Attach a console-error collector BEFORE navigation. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Filter out third-party/network noise that isn't an app defect. */
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('third-party') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource'),
  );
}

/** Navigate to the branches child route and wait for its root to render. */
async function openBranches(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/branches`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  // Scroll-nudge triggers appReveal (opacity: 0 on mount).
  await page.mouse.wheel(0, 200);
  await expect(page.locator('[data-testid="site-branches"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — Site Branches (authenticated journey)', () => {
  test('branch list renders the stubbed branches deterministically', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await installBranchesStubs(page);
    await openBranches(page);

    const root = page.locator('[data-testid="site-branches"]');
    await expect(root.getByRole('heading', { name: 'Branches' })).toBeVisible({ timeout: 15_000 });

    // Exactly the 3 stubbed rows — no soft "greater than 0". The error card
    // and empty state are both absent (proves the stub, not the catch-all,
    // fed the component).
    const rows = root.locator('tbody tr');
    await expect(rows).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('[data-testid="branches-error"]')).toHaveCount(0);
    await expect(root).toContainText('homepage-redesign');
    await expect(root).toContainText('pricing-v2');
    await expect(root).toContainText('holiday-hero');

    // Status pills — one per lifecycle branch.
    await expect(root.locator('.status-pill', { hasText: 'review' })).toBeVisible();
    await expect(root.locator('.status-pill', { hasText: 'draft' })).toBeVisible();
    await expect(root.locator('.status-pill', { hasText: 'merged' })).toBeVisible();

    // Approvals progressbar carries real ARIA state (1 of 2 on the review row).
    const progress = root.getByRole('progressbar').first();
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    await expect(progress).toHaveAttribute('aria-valuemax', '2');

    // Preview link renders only for branches with a preview_url.
    const preview = root.getByRole('link', { name: /Preview/ }).first();
    await expect(preview).toHaveAttribute(
      'href',
      'https://homepage-redesign--e2e-test-site.projectsites.dev',
    );

    // Lifecycle actions per status: review → Approve; draft → Request review;
    // 1/2 approvals means Merge is NOT offered yet.
    await expect(root.getByRole('button', { name: 'Approve homepage-redesign' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Request review for pricing-v2' })).toBeVisible();
    await expect(
      root.getByRole('button', { name: 'Merge homepage-redesign to production' }),
    ).toHaveCount(0);

    await page.screenshot({ path: 'e2e/screenshots/site-branches/list.png', fullPage: true });
    await checkA11y(page, 'site-branches-list');

    expect(realErrors(errors)).toEqual([]);
  });

  test('new-branch toggle opens the form; name value domains gate the submit; create POST is captured', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const posts = await installBranchesStubs(page);
    await openBranches(page);

    // Toggle opens the create form (siteId resolved from the route → enabled).
    const toggle = page.locator('[data-testid="branch-new-toggle"]');
    await expect(toggle).toBeEnabled({ timeout: 15_000 });
    await expect(toggle).toHaveText(/New branch/);
    await toggle.click();

    const nameInput = page.locator('[data-testid="branch-name-input"]');
    const submit = page.locator('[data-testid="branch-create-submit"]');
    const inlineError = page.locator('#branch-name-hint');
    await expect(nameInput).toBeVisible();
    await expect(toggle).toHaveText(/Cancel/);

    // ── Value domain: EMPTY → submit disabled, no inline error (calm gate). ──
    await expect(nameInput).toHaveValue('');
    await expect(submit).toBeDisabled();
    await expect(inlineError).toHaveCount(0);

    // ── Value domain: VALID DNS-label slug → enabled, no error. ──
    await nameInput.fill('feature-hero-v2');
    await expect(submit).toBeEnabled();
    await expect(inlineError).toHaveCount(0);

    // ── Value domain: OVERLONG (200 chars > 63-char DNS label cap) →
    //    inline error (role=alert) + aria-invalid + disabled submit. ──
    await nameInput.fill('a'.repeat(200));
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toHaveAttribute('role', 'alert');
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(submit).toBeDisabled();

    // ── Value domain: INJECTION → same inline-error contract; the disabled
    //    submit is never clicked so nothing can reach the wire. ──
    await nameInput.fill('<script>alert(1)</script>');
    await expect(inlineError).toBeVisible();
    await expect(submit).toBeDisabled();
    expect(posts).toHaveLength(0);

    await page.screenshot({ path: 'e2e/screenshots/site-branches/value-domains.png' });

    // ── Recover to valid and CREATE — the POST is intercepted + asserted. ──
    await nameInput.fill('feature-hero-v2');
    await expect(submit).toBeEnabled();
    await submit.click();

    // New row prepends into the table (4 rows) and the form closes.
    const root = page.locator('[data-testid="site-branches"]');
    await expect(root.locator('tbody tr')).toHaveCount(4, { timeout: 15_000 });
    await expect(root).toContainText('feature-hero-v2');
    await expect(nameInput).toBeHidden();
    await expect(toggle).toHaveText(/New branch/);

    // Exactly one captured mutation, with the clamped approvals default.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/sites/e2e-site-001/branches');
    expect(posts[0].body).toMatchObject({
      branch_name: 'feature-hero-v2',
      approvals_required: 1,
    });

    await page.screenshot({ path: 'e2e/screenshots/site-branches/created.png', fullPage: true });

    expect(realErrors(errors)).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/branches`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
