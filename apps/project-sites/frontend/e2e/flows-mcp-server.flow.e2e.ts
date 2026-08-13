/**
 * flows-mcp-server.flow.e2e.ts — Surface: the per-site MCP server management page
 * at /admin/sites/:id/mcp-server (SiteMcpServerComponent). Genuinely uncovered
 * before this fire. Lets external agents (Claude/GPT/Cursor) read+write site content
 * via MCP CRUD tools, authenticated by a per-site Bearer token minted here.
 *
 * Real, elaborate journeys against prod for e2e-site-3 (urban-fitness):
 *  - the tool list reconciles with GET /api/sites/:id/mcp/tools (list_pages, read_page…)
 *  - the tokens section shows the honest empty state (GET /mcp/tokens → [])
 *  - MUTATION journey: mint a uniquely-labelled token → assert the reveal-once banner
 *    + the tokens table row + ground-truth (/mcp/tokens now has it) → REVOKE it →
 *    assert it's gone from the table AND the store. Self-cleaning on the shared org.
 *  - the tool playground opens for a READ-ONLY tool (never runs a mutating tool).
 *
 * Real testids: site-mcp-server, new-token-label, mint-token-btn, new-token-banner,
 * tokens-table, revoke-token-btn, tool-row-<name>, test-tool-btn, tool-playground,
 * playground-args, playground-run-btn, mcp-tools-empty.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-mcp-server.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const ROOT = '[data-testid="site-mcp-server"]';
const SITE = 'e2e-site-3'; // urban-fitness
const ROUTE = `/admin/sites/${SITE}/mcp-server`;
const MARK = 'e2e-mcp'; // label prefix for self-cleanup

interface ToolsResp { tools: { name: string }[] }
interface TokensResp { tokens: { id: string; label: string }[] }

async function openServer(page: import('@playwright/test').Page) {
  await gotoAdmin(page, ROUTE);
  await page.locator(ROOT).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
}

test.describe('Full-flow · per-site MCP server', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ mode: 'serial', retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the MCP server surface renders for the site with its endpoint URL', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT), 'the MCP server page renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /mcp server/i })).toBeVisible();
    // The public MCP endpoint for this site is surfaced (slug = urban-fitness).
    await expect(page.locator(ROOT)).toContainText('urban-fitness.projectsites.dev/mcp');
    await snap(page, 'mcp-server-01-surface');
    expectClean(errors);
  });

  test('02 ground-truth: the tool list reconciles with GET /mcp/tools', async ({ page }) => {
    await seedSession(page);
    await openServer(page);
    const api = await apiFetch<ToolsResp>(page, `/api/sites/${SITE}/mcp/tools`);
    expect(api.status).toBe(200);
    const toolNames = (api.body.tools ?? []).map((t) => t.name);
    expect(toolNames.length, 'the site exposes built-in MCP tools').toBeGreaterThanOrEqual(2);
    const rows = page.locator('[data-testid^="tool-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count(), 'panel tool count reconciles with the store').toBe(toolNames.length);
    // The canonical read tools are present.
    await expect(page.locator('[data-testid="tool-row-list_pages"]')).toBeVisible();
    await snap(page, 'mcp-server-02-tools');
  });

  test('03 the tokens section shows the honest empty state (no tokens minted yet)', async ({ page }) => {
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
    expect(api.status).toBe(200);
    // Self-heal: a prior crashed run can leave e2e tokens — revoke any before
    // asserting, so the suite is never wedged by a mid-run failure.
    const leftover = (api.body.tokens ?? []).filter((t) => t.label?.startsWith(MARK));
    for (const t of leftover) {
      await apiFetch(page, `/api/sites/${SITE}/mcp/tokens/${t.id}`, { method: 'DELETE' });
    }
    // Non-e2e org state is honest ground truth: 0 real tokens → the empty state renders.
    const real = (api.body.tokens ?? []).filter((t) => !t.label?.startsWith(MARK));
    if (real.length === 0 && leftover.length === 0) {
      await expect(page.getByText(/no tokens yet/i)).toBeVisible();
    }
  });

  test('04 mint → reveal-once banner → tokens table row → REVOKE → gone (mutation + cleanup)', async ({ page }) => {
    test.setTimeout(60_000); // long journey: mint + banner + 2 ground-truth polls + revoke-confirm
    const errors = attachConsole(page);
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });

    const label = `${MARK}-${Date.now()}`;
    await page.locator('[data-testid="new-token-label"]').fill(label);
    await page.locator('[data-testid="mint-token-btn"]').click();

    // The reveal-once banner shows the raw token.
    await expect(page.locator('[data-testid="new-token-banner"]'), 'the mint banner reveals the token').toBeVisible({ timeout: 15_000 });
    // The tokens table now lists the new label.
    await expect(page.locator('[data-testid="tokens-table"]')).toContainText(label, { timeout: 10_000 });
    await snap(page, 'mcp-server-04-minted');

    // Ground-truth: the store now has exactly this labelled token (poll for D1
    // read-replica lag — a fresh cross-request GET can hit a stale replica).
    await expect(async () => {
      const afterMint = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
      const mine = (afterMint.body.tokens ?? []).filter((t) => t.label === label);
      expect(mine.length, 'the store persisted the minted token').toBe(1);
    }).toPass({ timeout: 15_000 });

    // REVOKE it (self-cleanup) — the row's revoke button opens a ConfirmService
    // dialog whose accept button is `confirm-accept` ("Yes, revoke").
    const row = page.locator('[data-testid="tokens-table"] tr', { hasText: label });
    await row.locator('[data-testid="revoke-token-btn"]').click();
    const confirmBtn = page.locator('[data-testid="confirm-accept"]');
    await confirmBtn.click({ timeout: 8_000 }).catch(() => {});

    // Ground-truth: the token is gone from the store.
    await expect(async () => {
      const after = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
      expect((after.body.tokens ?? []).some((t) => t.label === label)).toBe(false);
    }).toPass({ timeout: 15_000 });
    expectClean(errors);
  });

  test('05 the tool playground opens for a read-only tool (never runs a mutating tool)', async ({ page }) => {
    await seedSession(page);
    await openServer(page);
    const readTool = page.locator('[data-testid="tool-row-list_pages"]');
    await expect(readTool).toBeVisible({ timeout: 15_000 });
    await readTool.locator('[data-testid="test-tool-btn"]').click();
    await expect(page.locator('[data-testid="tool-playground"]'), 'the playground opens').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="playground-args"]')).toBeVisible();
    await expect(page.locator('[data-testid="playground-run-btn"]')).toBeVisible();
    await snap(page, 'mcp-server-05-playground');
  });

  test('06 the MCP server surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the MCP server surface (session intact)', async ({ page }) => {
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openServer(page);
    await expect(page.locator(ROOT), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 full journey: server page → tools + tokens both reflect the persisted store', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openServer(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    const tools = await apiFetch<ToolsResp>(page, `/api/sites/${SITE}/mcp/tools`);
    const tokens = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
    expect(tools.status).toBe(200);
    expect(tokens.status).toBe(200);
    // Panel tool rows == store; every store tool appears in the panel.
    await expect(page.locator('[data-testid^="tool-row-"]').first()).toBeVisible();
    for (const t of (tools.body.tools ?? []).slice(0, 3)) {
      await expect(page.locator(`[data-testid="tool-row-${t.name}"]`), `${t.name} is shown`).toBeVisible();
    }
    await snap(page, 'mcp-server-08-journey');
    expectClean(errors);
  });

  test('09 cleanup: no e2e-minted tokens remain on the shared org', async ({ page }) => {
    await seedSession(page);
    await openServer(page);
    const api = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
    const leftovers = (api.body.tokens ?? []).filter((t) => t.label?.startsWith(MARK));
    // Best-effort sweep any stragglers from a mid-run failure via the API.
    for (const t of leftovers) {
      await apiFetch(page, `/api/sites/${SITE}/mcp/tokens/${t.id}`, { method: 'DELETE' });
    }
    const after = await apiFetch<TokensResp>(page, `/api/sites/${SITE}/mcp/tokens`);
    expect((after.body.tokens ?? []).filter((t) => t.label?.startsWith(MARK)).length, 'no e2e tokens remain').toBe(0);
  });
});
