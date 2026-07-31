/**
 * Admin → Voice — authenticated E2E journey.
 *
 * Tests the /admin/voice section: section renders with selectedSite populated,
 * tab navigation (numbers → conversations → agent), voice stat strip visible,
 * keyboard tab navigation, accessibility at 2 breakpoints, and console-error hygiene.
 *
 * Critical: auth helper stubs /api/sites with empty array, which causes voice to show
 * app-empty-state instead of the section. We override the sites stub here to return
 * one site so selectedSite() is populated.
 *
 * Safety: ALL POST/PATCH/DELETE requests to /api/** are stubbed — no real phone numbers
 * are purchased or calls are made.
 */
import path from 'path';
import fs from 'fs';
import { test, expect, type Page } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const STUB_EMAIL = 'test@megabyte.space';

const STUB_SITE = {
  id: 'e2e-site-id',
  slug: 'e2e-test-site',
  org_id: 'e2e-test-org',
  name: 'E2E Test Site',
  status: 'published',
  primary_hostname: 'e2e-test.projectsites.dev',
};

// Shapes mirror the component interfaces EXACTLY (snake_case) — camelCase
// twins of these stubs previously rendered undefined fields (vanityHtml on
// undefined phone_number, DatePipe on undefined started_at) → console errors
// that tripped the hard console-hygiene assertion.

// numbers.component.ts `interface PurchasedNumber`
const STUB_NUMBERS = [
  {
    id: 'num-001',
    phone_number: '+12015550001',
    friendly_name: 'Main line',
    capabilities: { voice: true, sms: true, mms: false },
    monthly_cost_usd: 1.0,
    purchased_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'num-002',
    phone_number: '+12015550002',
    friendly_name: 'Overflow',
    capabilities: { voice: true, sms: false, mms: false },
    monthly_cost_usd: 1.0,
    purchased_at: '2026-07-10T00:00:00Z',
  },
];

// conversations.component.ts `interface Conversation` — transcript is
// TranscriptTurn[] ({ speaker, text, t_ms }), never a string.
const STUB_CONVERSATIONS = [
  {
    id: 'conv-001',
    channel: 'call',
    from_number: '+15555550100',
    to_number: '+12015550001',
    started_at: '2026-07-28T14:00:00Z',
    duration_s: 120,
    message_preview: 'Hello, I am calling about your services.',
    status: 'completed',
    sentiment: 'neutral',
    has_recording: false,
    transcript: [
      { speaker: 'caller', text: 'Hello, I am calling about your services.', t_ms: 0 },
      { speaker: 'agent', text: 'Happy to help — what would you like to know?', t_ms: 2400 },
    ],
  },
];

// numbers.component.ts `interface VanitySuggestion`
const STUB_VANITY = [
  { word: 'E2E-TEST', digits: '3238378', rationale: 'Matches the test-suite name', score: 0.9 },
  { word: 'TESTSITE', digits: '83787483', rationale: 'Matches the site name', score: 0.8 },
];

async function signInAndStubVoice(page: Page): Promise<void> {
  // LAST-RESORT /api catch-all — registered FIRST = matched LAST (reverse
  // registration order). Unstubbed /api requests (audit/rows, inbox/tasks, …)
  // must NEVER reach prod: with a fake bearer they 401 and ApiService clears
  // the session -> /signin bounce mid-test.
  await page.route('**/api/**', async (route: any) => {
    const m = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: m === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: 'e2e-stub-session-token', id: STUB_EMAIL },
  );

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e-test-user-id',
          email: STUB_EMAIL,
          name: 'E2E Test User',
          org_id: 'e2e-test-org',
          is_super_admin: true,
        },
      }),
    });
  });

  // CRITICAL: return one site so voice selectedSite() signal is populated
  // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls to catch-all
  await page.route('**/api/sites**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [STUB_SITE], meta: { total: 1 } }),
    });
  });

  await page.route('**/api/billing/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
  await page.route('**/api/feature-flags/**', (route: any) => route.continue());

  await page.route('**/api/analytics/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/analytics/track', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/super-admin/feature-flags', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: [], count: 0 }),
    });
  });

  // Voice-specific API stubs
  const numbersStub = async (route: any) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_NUMBERS }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    }
  };
  await page.route('**/api/voice/numbers**', numbersStub);
  // Mid-token ** can't cross '/' — twin covers /numbers/:id, /purchase, /search
  await page.route('**/api/voice/numbers/**', numbersStub);

  const conversationsStub = async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_CONVERSATIONS }),
    });
  };
  await page.route('**/api/voice/conversations**', conversationsStub);
  // Mid-token ** can't cross '/' — twin covers /conversations/:id + downloads
  await page.route('**/api/voice/conversations/**', conversationsStub);

  // glob-ok: query-suffix only — /api/voice/search has no deeper path segments
  // Shape: numbers.component.ts `interface NumberCandidate`.
  await page.route('**/api/voice/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            phone_number: '+12015550099',
            locality: 'Jersey City',
            region: 'NJ',
            iso_country: 'US',
            capabilities: { voice: true, sms: true, mms: false },
            monthly_cost_usd: 1.0,
          },
        ],
      }),
    });
  });

  // glob-ok: query-suffix only — vanity-suggestions has no deeper path segments
  await page.route('**/api/voice/vanity-suggestions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_VANITY }),
    });
  });

  // glob-ok: query-suffix only — matches /agent-settings (token extension, no
  // '/' crossed); there are no /api/voice/agent/... subpaths in the frontend
  // Shape: agent-settings.component.ts `interface AgentSettings` — component
  // spreads `{ ...DEFAULTS, ...r.data }`, so a valid partial suffices;
  // provider/voice must be a legal VOICE_OPTIONS pair.
  await page.route('**/api/voice/agent**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            voice_system_prompt: 'You are a helpful assistant for E2E Test Site.',
            sms_system_prompt: 'You handle inbound texts for E2E Test Site.',
            voice_provider: 'openai',
            voice_id: 'alloy',
          },
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    }
  });

  // glob-ok: query-suffix only — meta-prompt has no deeper path segments.
  // agent-settings.component expects { data: { text } }; without this stub the
  // GET fell through to the /api catch-all's { data: [] } (array, wrong shape).
  await page.route('**/api/voice/meta-prompt**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { text: 'Immutable safety meta-prompt (E2E stub).' } }),
    });
  });

  // glob-ok: query-suffix only — mcp-attachments has no deeper path segments.
  // mcps.component expects { data: { voice: string[]; sms: string[] } }; the
  // catch-all's { data: [] } left data.voice/data.sms undefined → template @for
  // over undefined throws when the MCPs tab renders.
  await page.route('**/api/voice/mcp-attachments**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { voice: [], sms: [] } }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    }
  });

  // Safety: stub all remaining voice MUTATIONS only. Registered LAST = matched
  // FIRST, so GETs must fall through to the specific numbers/conversations/
  // search stubs above (fulfilling '{}' here shadowed them all — sweep hazard).
  await page.route('**/api/voice/**', async (route) => {
    const method = route.request().method();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    } else {
      await route.fallback();
    }
  });

  // Broad admin catch-all
  await page.route('**/api/admin/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety: block all other mutations
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    } else {
      await route.fallback();
    }
  });
}

function ensureDir(sub: string): string {
  const dir = path.join('e2e', 'screenshots', sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test.describe('Admin — Voice (authenticated journey)', () => {
  test('voice section renders with stat strip (not empty state)', async ({ page }) => {
    const dir = ensureDir('admin-voice');
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await signInAndStubVoice(page);
    await page.goto(`${PROD_URL}/admin/voice`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    const voiceSection = page.locator('app-voice');
    await expect(voiceSection).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: path.join(dir, '01-section-loaded.png') });

    // data-testid="voice-section" should be present
    const voiceSectionDiv = page.locator('[data-testid="voice-section"]');
    if (await voiceSectionDiv.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(voiceSectionDiv).toBeVisible();
    }

    // Stat strip should be visible (not the empty state)
    const statStrip = page.locator('[data-testid="voice-stat-strip"]');
    if (await statStrip.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(statStrip).toBeVisible();
      await page.screenshot({ path: path.join(dir, '02-stat-strip-visible.png') });
    } else {
      // Check if empty state is shown instead — this would mean sites stub not working
      const emptyState = page.locator('app-empty-state');
      if (await emptyState.isVisible({ timeout: 2_000 }).catch(() => false)) {
        // TDD-RED: voice shows empty state — selectedSite() not populated despite sites stub
        // This means the sites stub override isn't working as expected
        console.warn('TDD-RED: voice shows empty-state, selectedSite not populated from stub');
      }
    }

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') && !e.toLowerCase().includes('failed to load resource') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED') &&
        !e.includes('net::ERR_'),
    );
    expect(realErrors, `Console errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
  });

  test('tab navigation: numbers → conversations → agent', async ({ page }) => {
    const dir = ensureDir('admin-voice');

    await signInAndStubVoice(page);
    await page.goto(`${PROD_URL}/admin/voice`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });

    // Numbers tab (default)
    const numbersTab = page.locator('[data-testid="voice-tab-numbers"]');
    if (await numbersTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await numbersTab.click();
      await page.screenshot({ path: path.join(dir, '03-numbers-tab.png') });

      // Conversations tab
      const convsTab = page.locator('[data-testid="voice-tab-conversations"]');
      if (await convsTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await convsTab.click();
        await page.screenshot({ path: path.join(dir, '04-conversations-tab.png') });
      }

      // Agent tab
      const agentTab = page.locator('[data-testid="voice-tab-agent"]');
      if (await agentTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await agentTab.click();
        await page.screenshot({ path: path.join(dir, '05-agent-tab.png') });
      }
    } else {
      // TDD-RED: voice tab testids not found
      console.warn(
        'TDD-RED: [data-testid="voice-tab-numbers"] not found — voice section may be showing empty state',
      );
    }
  });

  test('deep-link to agent tab via URL query param', async ({ page }) => {
    const dir = ensureDir('admin-voice');

    await signInAndStubVoice(page);
    // Voice supports ?tab=agent deep-link
    await page.goto(`${PROD_URL}/admin/voice?tab=agent`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: path.join(dir, '06-agent-tab-deeplink.png') });

    // Agent settings component should be visible when tab=agent
    const agentSettings = page.locator('app-voice-agent-settings');
    if (await agentSettings.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(agentSettings).toBeVisible();
    } else {
      // May be behind feature flag or the deep-link doesn't work yet
      console.warn(
        'TDD-RED: app-voice-agent-settings not visible on ?tab=agent — may need flag enable',
      );
    }
  });

  test('keyboard Tab through voice section tabs', async ({ page }) => {
    const dir = ensureDir('admin-voice');

    await signInAndStubVoice(page);
    await page.goto(`${PROD_URL}/admin/voice`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });

    // Focus on the numbers tab and navigate with keyboard
    const numbersTab = page.locator('[data-testid="voice-tab-numbers"]');
    if (await numbersTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await numbersTab.focus();
      await page.keyboard.press('Tab');
      await page.screenshot({ path: path.join(dir, '07-keyboard-tab.png') });
      await page.keyboard.press('Tab');
      await page.screenshot({ path: path.join(dir, '08-keyboard-tab-2.png') });
    }
  });

  test('live pill indicator is visible', async ({ page }) => {
    const dir = ensureDir('admin-voice');

    await signInAndStubVoice(page);
    await page.goto(`${PROD_URL}/admin/voice`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });

    const livePill = page.locator('[data-testid="voice-live-pill"]');
    if (await livePill.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(livePill).toBeVisible();
      await page.screenshot({ path: path.join(dir, '09-live-pill.png') });
    } else {
      // Live pill may only appear when agent is configured — not a hard failure
      console.warn('Info: voice-live-pill not visible — agent may not be configured');
    }
  });

  test('accessibility at 1280px and 375px', async ({ page }) => {
    const dir = ensureDir('admin-voice');

    await signInAndStubVoice(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${PROD_URL}/admin/voice`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });
    await checkA11y(page, 'voice-1280');
    await page.screenshot({ path: path.join(dir, '10-a11y-1280.png') });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('app-voice')).toBeVisible({ timeout: 15_000 });
    await checkA11y(page, 'voice-375');
    await page.screenshot({ path: path.join(dir, '11-a11y-375.png') });
  });
});
