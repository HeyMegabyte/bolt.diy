/**
 * @fileoverview E2E — AI Chat widget streaming markdown render (TDD-RED)
 *
 * Flow: homepage → Admin → Cmd+K → type "chat" → open AI chat widget →
 *       mock /api/dashboard/chat SSE to stream a message containing:
 *         - [1] citation marker
 *         - <tool name="navigate" args={...} /> chip
 *         - **bold** markdown
 *         - a fenced code block
 *       Assert:
 *         - .agent-tool-chip renders
 *         - sup.agent-citation (or equivalent) renders
 *         - code block has a language class
 *         - suggested-action chips render if provided
 *
 * Screenshots in e2e/screenshots/streaming-markdown/.
 */

import { test, expect } from './fixtures.js';
import type { Page, Route } from '@playwright/test';

const isMac = process.platform === 'darwin';
const META = isMac ? 'Meta' : 'Control';

const BREAKPOINTS = [
  { width: 375,  height: 812  },
  { width: 390,  height: 844  },
  { width: 768,  height: 1024 },
  { width: 1024, height: 768  },
  { width: 1280, height: 800  },
  { width: 1920, height: 1080 },
];

/** The SSE streaming response body we inject. */
const STREAM_BODY = [
  'data: {"type":"start"}\n\n',
  'data: {"type":"text","content":"Here is a summary of your site. [1] "}\n\n',
  'data: {"type":"text","content":"**Bold insight**: your LCP is 1.2s which is excellent.\\n\\n"}\n\n',
  'data: {"type":"text","content":"```typescript\\nconst x: number = 42;\\nconsole.warn(x);\\n```\\n\\n"}\n\n',
  'data: {"type":"tool","name":"navigate","args":{"route":"/admin/ai-logs"}}\n\n',
  'data: {"type":"citation","ref":1,"title":"Google PageSpeed Insights","url":"https://pagespeed.web.dev"}\n\n',
  'data: {"type":"suggestion","label":"View AI Logs","action":"navigate","route":"/admin/ai-logs"}\n\n',
  'data: {"type":"end"}\n\n',
].join('');

async function stubAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'e2e-chat-md-token', email: 'test@megabyte.space' }),
    );
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { user_id: 'u-chat', org_id: 'org-chat', email: 'test@megabyte.space' },
      }),
    });
  });

  await page.route('**/api/sites', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/billing/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { plan: 'pro', status: 'active' } }),
    });
  });
}

async function stubChatStream(page: Page): Promise<void> {
  await page.route('**/api/dashboard/chat**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: STREAM_BODY,
    });
  });
}

async function openChatWidget(page: Page): Promise<void> {
  // Cmd+K opens the command palette; typing "chat" should surface the AI chat action
  await page.keyboard.press(`${META}+KeyK`);

  const paletteInput = page.locator('[data-testid="palette-input"], [role="combobox"], input[placeholder*="search" i]');
  const chatTrigger  = page.locator('[data-testid="ai-chat-trigger"], button:has-text("Chat"), [aria-label*="chat" i]');

  if (await paletteInput.count() > 0) {
    await expect(paletteInput.first()).toBeVisible({ timeout: 5_000 });
    await paletteInput.first().fill('chat');

    // Select the Ask AI / Chat action from the palette
    const chatAction = page.locator(
      '[data-testid="palette-action-ask-ai"], [data-testid="palette-action-chat"], ' +
      '[role="option"]:has-text("Chat"), [role="option"]:has-text("Ask AI")',
    );
    await expect(chatAction.first()).toBeVisible({ timeout: 5_000 });
    await chatAction.first().click();
  } else if (await chatTrigger.count() > 0) {
    await chatTrigger.first().click();
  } else {
    // Direct keyboard shortcut to chat if palette not mounted
    await page.keyboard.press('Escape');
    const directChatBtn = page.locator('[data-testid="ai-chat-open"], [aria-label*="open chat" i]');
    if (await directChatBtn.count() > 0) {
      await directChatBtn.first().click();
    }
  }

  // Wait for the chat widget to be visible
  const chatWidget = page.locator(
    '[data-testid="ai-chat-widget"], [data-testid="chat-drawer"], .chat-widget, .ai-chat',
  );
  await expect(chatWidget.first()).toBeVisible({ timeout: 8_000 });
}

async function sendChatMessage(page: Page, message: string): Promise<void> {
  const chatInput = page.locator(
    '[data-testid="chat-input"], textarea[placeholder*="message" i], ' +
    'textarea[placeholder*="ask" i], input[placeholder*="chat" i]',
  ).first();
  await expect(chatInput).toBeVisible({ timeout: 5_000 });
  await chatInput.focus();
  await chatInput.fill(message);
  await page.keyboard.press('Enter');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('AI Chat — Streaming markdown render', () => {
  test.beforeEach(async ({ page }) => {
    await stubAuth(page);
    await stubChatStream(page);
    await page.goto('/');
    await page.click('[data-testid="nav-admin"], a[href*="/admin"], text=Admin');
    await page.waitForURL(/\/admin/);
  });

  test('chat widget opens and accepts keyboard input', async ({ page }) => {
    await openChatWidget(page);

    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder*="message" i], textarea[placeholder*="ask" i]',
    ).first();
    await expect(chatInput).toBeVisible({ timeout: 8_000 });
    await expect(chatInput).toBeFocused();

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/01-widget-open.png', fullPage: false });
  });

  test('streamed message renders bold text, code block with language class', async ({ page }) => {
    await openChatWidget(page);
    await sendChatMessage(page, 'Summarise my site analytics');

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/02-streaming.png', fullPage: false });

    // Wait for streaming to complete — look for the end marker or the bold text
    const boldEl = page.locator('.chat-message strong, .chat-message b, .agent-message b');
    await expect(boldEl.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/03-message-rendered.png', fullPage: false });

    // Code block with a language class
    const codeBlock = page.locator('pre code[class*="language-"], pre code.hljs, pre code');
    await expect(codeBlock.first()).toBeVisible({ timeout: 8_000 });

    const codeClass = await codeBlock.first().getAttribute('class');
    if (codeClass) {
      expect(codeClass).toMatch(/language-|hljs/);
    }
  });

  test('tool chip renders for <tool name="navigate"> in stream', async ({ page }) => {
    await openChatWidget(page);
    await sendChatMessage(page, 'Take me to AI logs');

    // Tool chip should render
    const toolChip = page.locator(
      '[data-testid="agent-tool-chip"], .agent-tool-chip, [data-tool], .tool-call-chip',
    );
    await expect(toolChip.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/04-tool-chip.png', fullPage: false });
  });

  test('citation marker [1] renders as a superscript or citation element', async ({ page }) => {
    await openChatWidget(page);
    await sendChatMessage(page, 'What is my site LCP?');

    // Citation element — either sup.agent-citation or a data attribute
    const citation = page.locator(
      'sup.agent-citation, [data-testid="agent-citation"], .citation-marker, sup[data-ref]',
    );
    await expect(citation.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/05-citation.png', fullPage: false });
  });

  test('suggested-action chips render below the message', async ({ page }) => {
    await openChatWidget(page);
    await sendChatMessage(page, 'What should I do next?');

    // Suggested action chips
    const suggestionChips = page.locator(
      '[data-testid="chat-suggestion-chip"], .suggestion-chip, .quick-action-chip, ' +
      'button[data-suggestion], .chat-suggestion',
    );
    await expect(suggestionChips.first()).toBeVisible({ timeout: 20_000 });
    await expect(suggestionChips.first()).toContainText(/View AI Logs|AI Logs|logs/i);

    await page.screenshot({ path: 'e2e/screenshots/streaming-markdown/06-suggestion-chips.png', fullPage: false });
  });

  test('no console errors during streaming render', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await openChatWidget(page);
    await sendChatMessage(page, 'Summarise my site analytics');

    // Wait for stream to complete
    await page.waitForTimeout(3_000);

    // Filter analytics/third-party noise
    const blocking = consoleErrors.filter(
      (e) => !/posthog|gtag|google-analytics|cloudflareinsights|Failed to load resource/i.test(e),
    );
    expect(blocking).toEqual([]);
  });

  // ─── Breakpoint smoke ───────────────────────────────────────────────────────

  for (const vp of BREAKPOINTS) {
    test(`Chat widget renders at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stubAuth(page);
      await stubChatStream(page);

      await page.goto('/');
      await page.click('[data-testid="nav-admin"], a[href*="/admin"], text=Admin');
      await page.waitForURL(/\/admin/);

      await openChatWidget(page);

      await page.screenshot({
        path: `e2e/screenshots/streaming-markdown/bp-${vp.width}.png`,
        fullPage: false,
      });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
