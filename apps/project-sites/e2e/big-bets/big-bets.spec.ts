/**
 * BIG-01..BIG-30 — 30 big-bet feature clusters, features-hub driven.
 *
 * Pattern per cluster:
 *   (a) navigate to /admin/features-hub?tab=bigbets
 *   (b) mock the feature-flags endpoint so the target flag is ON
 *   (c) mock the backing feature API to return a realistic JSON envelope
 *   (d) click "Try it" on the first endpoint of the card
 *   (e) assert the inline JSON result panel is visible with HTTP 200
 *
 * Tests are fully hermetic: all mocks are request-scoped, no shared state.
 * The page.route patterns intercept both the flag-check and the feature API,
 * ensuring deterministic behaviour regardless of server state.
 */

import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';

const BASE = process.env.PROD_URL ?? process.env.BASE_URL ?? 'http://localhost:4200';
const HUB_URL = `${BASE}/admin/features-hub?tab=bigbets`;

interface BigBetCase {
  id: string;
  flagKey: string;
  cardName: string;
  /** Path of the first endpoint on the card (used to build the mock route) */
  apiPath: string;
  /** Minimal JSON shape the mock returns */
  mockBody: unknown;
  /** HTTP method of the first endpoint */
  method?: 'GET' | 'POST';
}

const CASES: BigBetCase[] = [
  // BIG-01 — visual editor
  { id: 'BIG-01', flagKey: 'visual_editor_drag_drop', cardName: 'Visual editor', apiPath: '/api/visual-editor/save', mockBody: { id: 'vep-001', site_id: 'demo-site', breakpoint: 'desktop', layout_byte_size: 128, saved_at: '2026-01-01T00:00:00Z' }, method: 'POST' },
  // BIG-02 — ecommerce
  { id: 'BIG-02', flagKey: 'ecommerce_engine', cardName: 'E-commerce', apiPath: '/api/ecommerce/products/demo-site', mockBody: { products: [{ id: 'p1', name: 'Artisan Sourdough Loaf', price_cents: 850 }] } },
  // BIG-03 — booking
  { id: 'BIG-03', flagKey: 'native_booking_engine', cardName: 'Native booking', apiPath: '/api/booking/slots/demo-site', mockBody: { slots: [{ id: 's0', start_at: '2026-06-01T09:00:00Z', status: 'open' }] } },
  // BIG-04 — LMS
  { id: 'BIG-04', flagKey: 'lms_engine', cardName: 'LMS engine', apiPath: '/api/lms/courses', mockBody: { id: 'c-001', title: 'Sourdough Fundamentals', module_count: 2, status: 'draft' }, method: 'POST' },
  // BIG-05 — community
  { id: 'BIG-05', flagKey: 'community_engine', cardName: 'Community', apiPath: '/api/community/topics', mockBody: { id: 't-001', title: 'Welcome!', reply_count: 0, pinned: false }, method: 'POST' },
  // BIG-06 — newsletter
  { id: 'BIG-06', flagKey: 'newsletter_engine', cardName: 'Newsletter', apiPath: '/api/newsletter/campaigns', mockBody: { id: 'n-001', subject: 'Spring menu live', status: 'draft', estimated_recipients: 1247 }, method: 'POST' },
  // BIG-07 — membership
  { id: 'BIG-07', flagKey: 'membership_paywall', cardName: 'Membership paywall', apiPath: '/api/membership/tiers', mockBody: { id: 'mt-001', name: 'Silver', price_cents: 1500, stripe_price_id: 'price_demo', billing_cycle: 'monthly' }, method: 'POST' },
  // BIG-08 — donations
  { id: 'BIG-08', flagKey: 'donations_engine', cardName: 'Donations', apiPath: '/api/donations/campaigns', mockBody: { id: 'dc-001', name: 'Holiday Fund', goal_cents: 1000000, raised_cents: 0, donor_count: 0 }, method: 'POST' },
  // BIG-09 — mobile admin
  { id: 'BIG-09', flagKey: 'native_mobile_admin', cardName: 'Native iOS', apiPath: '/api/mobile/register', mockBody: { id: 'mob-001', platform: 'ios', push_enabled: true }, method: 'POST' },
  // BIG-10 — desktop admin
  { id: 'BIG-10', flagKey: 'native_desktop_admin', cardName: 'Native macOS', apiPath: '/api/desktop/info', mockBody: { macos: { version: '0.1.0', download_url: 'https://projectsites.dev/desktop/mac.dmg' }, framework: 'Tauri 2' } },
  // BIG-11 — browser extension
  { id: 'BIG-11', flagKey: 'browser_extension', cardName: 'Browser extension', apiPath: '/api/extension/info', mockBody: { chrome: { version: '0.1.0', install_count: 12 }, permissions: ['activeTab'] } },
  // BIG-12 — chatops bot
  { id: 'BIG-12', flagKey: 'chat_ops_bot', cardName: 'Slack', apiPath: '/api/chatops/connect', mockBody: { id: 'co-001', platform: 'slack', status: 'connected', slash_commands: ['/deploy'] }, method: 'POST' },
  // BIG-13 — SOC 2
  { id: 'BIG-13', flagKey: 'soc2_program', cardName: 'SOC 2', apiPath: '/api/soc2/controls', mockBody: { controls: [{ control_id: 'CC1.1', status: 'operating' }] } },
  // BIG-14 — HIPAA
  { id: 'BIG-14', flagKey: 'hipaa_variant', cardName: 'HIPAA', apiPath: '/api/hipaa/baa', mockBody: { id: 'baa-001', business_name: 'Demo Health', signed_at: '2026-01-01T00:00:00Z', status: 'signed' }, method: 'POST' },
  // BIG-15 — PCI tokenize
  { id: 'BIG-15', flagKey: 'pci_dss_l1', cardName: 'PCI DSS', apiPath: '/api/pci/tokenize', mockBody: { token: 'tok_demo', last4: '4242', pci_dss_level: 1, scope_reduced: true }, method: 'POST' },
  // BIG-16 — enterprise SSO
  { id: 'BIG-16', flagKey: 'enterprise_sso', cardName: 'Enterprise SSO', apiPath: '/api/sso/connect', mockBody: { id: 'sso-001', protocol: 'saml', acs_url: 'https://projectsites.dev/saml/acs/001', status: 'pending' }, method: 'POST' },
  // BIG-17 — D1 multi-region
  { id: 'BIG-17', flagKey: 'd1_multi_region', cardName: 'Multi-region D1', apiPath: '/api/d1/replication-status', mockBody: { primary_region: 'wnam', replicas: [{ region: 'enam', lag_ms: 12, healthy: true }], sessions_api_enabled: true } },
  // BIG-18 — BYO Cloudflare
  { id: 'BIG-18', flagKey: 'byo_cloudflare', cardName: 'BYO Cloudflare', apiPath: '/api/byo-cloudflare/connect', mockBody: { id: 'byo-001', cf_account_id: 'abc123', status: 'pending', oauth_url: 'https://dash.cloudflare.com/oauth' }, method: 'POST' },
  // BIG-19 — worker marketplace
  { id: 'BIG-19', flagKey: 'worker_marketplace', cardName: 'Worker marketplace', apiPath: '/api/worker-marketplace', mockBody: { listings: [{ id: 'wm1', name: 'Stripe Connect Express adapter', install_count: 47 }] } },
  // BIG-20 — domain reseller
  { id: 'BIG-20', flagKey: 'domain_reseller', cardName: 'Domain reseller', apiPath: '/api/domain-reseller/search', mockBody: { query: 'bayonnebakery', suggestions: [{ domain: 'bayonnebakery.com', available: true, price_cents: 1499 }] } },
  // BIG-21 — brand voice clone
  { id: 'BIG-21', flagKey: 'brand_voice_clone', cardName: 'Per-brand AI voice clone', apiPath: '/api/voice-clones', mockBody: { id: 'vc-001', name: 'Brand Voice', elevenlabs_voice_id: 'evl_demo', status: 'training' }, method: 'POST' },
  // BIG-22 — AI agent marketplace
  { id: 'BIG-22', flagKey: 'ai_agent_marketplace', cardName: 'AI agent marketplace', apiPath: '/api/ai-agent-marketplace', mockBody: { listings: [{ id: 'aa1', name: 'Booking assistant', install_count: 124 }] } },
  // BIG-23 — customer site copilot
  { id: 'BIG-23', flagKey: 'customer_site_copilot', cardName: 'Customer-site AI copilot', apiPath: '/api/site-copilot/index/demo-site', mockBody: { id: 'kb-001', site_id: 'demo-site', doc_count: 47, status: 'indexed' }, method: 'POST' },
  // BIG-24 — AI video courses
  { id: 'BIG-24', flagKey: 'ai_video_courses', cardName: 'AI-generated video courses', apiPath: '/api/ai-video-courses', mockBody: { id: 'vc-001', title: 'Sourdough 101', lesson_count: 4, status: 'generating' }, method: 'POST' },
  // BIG-25 — AI A/B experiments
  { id: 'BIG-25', flagKey: 'ai_ab_test_generator', cardName: 'AI A/B test generator', apiPath: '/api/ai-ab-experiments', mockBody: { id: 'ab-001', goal: 'increase bookings', variants: [], status: 'running' }, method: 'POST' },
  // BIG-26 — SMS marketing
  { id: 'BIG-26', flagKey: 'sms_marketing', cardName: 'SMS marketing platform', apiPath: '/api/sms-campaigns', mockBody: { id: 'sms-001', name: 'Flash sale', estimated_recipients: 423, status: 'draft' }, method: 'POST' },
  // BIG-27 — affiliate program
  { id: 'BIG-27', flagKey: 'affiliate_program', cardName: 'Affiliate program', apiPath: '/api/affiliates', mockBody: { id: 'aff-001', code: 'PARTNER-ABC123', commission_pct: 20, referral_link: 'https://projectsites.dev/?ref=PARTNER-ABC123' }, method: 'POST' },
  // BIG-28 — loyalty engine
  { id: 'BIG-28', flagKey: 'loyalty_engine', cardName: 'Loyalty', apiPath: '/api/loyalty/programs', mockBody: { id: 'lp-001', name: 'Rewards', points_per_dollar: 10, tiers: [{ name: 'bronze' }] }, method: 'POST' },
  // BIG-29 — CRM
  { id: 'BIG-29', flagKey: 'crm_engine', cardName: 'CRM', apiPath: '/api/crm/deals/demo-site', mockBody: { deals: [{ id: 'd1', customer_name: 'Acme Co', value_cents: 12000, stage: 'qualified' }] } },
  // BIG-30 — CDP
  { id: 'BIG-30', flagKey: 'cdp_engine', cardName: 'Customer Data Platform', apiPath: '/api/cdp/profiles', mockBody: { id: 'cdp-001', identity_resolved: true, source_count: 1 }, method: 'POST' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stub the /api/feature-flags list so every flag in flagKeys resolves to ON.
 * Also stub the /api/feature-flags/:key detail endpoint.
 */
async function stubFlagsOn(page: import('@playwright/test').Page, flagKeys: string[]): Promise<void> {
  await page.route('**/api/feature-flags', async (route) => {
    const flags = flagKeys.map((key) => ({
      key,
      description: `E2E stub: ${key}`,
      default_enabled: true,
      default_rollout_percent: 100,
      stage: 'beta',
      owner_email: 'test@megabyte.space',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags, count: flags.length }) });
  });

  // Stub per-key endpoint too (used by toggle UI)
  await page.route(/\/api\/feature-flags\/[^/]+$/, async (route) => {
    const url = route.request().url();
    const key = url.split('/api/feature-flags/')[1]?.split('?')[0] ?? '';
    const def = { key, description: `E2E stub: ${key}`, default_enabled: true, default_rollout_percent: 100, stage: 'beta', owner_email: 'test@megabyte.space' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ definition: def, resolved: { enabled: true, rollout_percent: 100 } }) });
  });
}

/**
 * Stub the feature API endpoint to return mockBody with HTTP 200.
 * Handles both GET and POST by matching the URL path (partial).
 */
async function stubFeatureApi(page: import('@playwright/test').Page, apiPath: string, mockBody: unknown): Promise<void> {
  const escapedPath = apiPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escapedPath.replace(/\/demo-[a-z-]+/g, '/[^/]+'));
  await page.route(pattern, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockBody) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const c of CASES) {
  test(`${c.id} — ${c.flagKey} — features-hub card Try it renders JSON result`, async ({ page }) => {
    // Auth
    await page.goto(BASE);
    await signInAsTestUser(page);

    // Stubs must be set up before navigation
    await stubFlagsOn(page, [c.flagKey]);
    await stubFeatureApi(page, c.apiPath, c.mockBody);

    // Navigate to the features hub, big bets tab
    await page.goto(HUB_URL);

    // Locate the card by flag key attribute (the card renders data-flag-on)
    // Fall back to text matching by card name
    const card = page.locator(`.hub-card[data-testid="hub-card-${c.flagKey}"]`)
      .or(page.locator(`.hub-card`).filter({ has: page.locator(`code:text-is("${c.flagKey}")`) }));

    // Wait until the card is visible in the viewport (grid may be long)
    await expect(card.first()).toBeVisible({ timeout: 10_000 });

    // Click the first "Try" button in the card
    const tryBtn = card.first().locator('[data-testid="hub-try-btn"]').first()
      .or(card.first().getByRole('button', { name: /^Try$|^…$/ }).first());
    await expect(tryBtn).toBeVisible();
    await tryBtn.click();

    // Assert the result panel appears with HTTP 200
    const resultPanel = card.first().locator('[data-testid="hub-result"]').first()
      .or(card.first().locator('.hub-result').first());
    await expect(resultPanel).toBeVisible({ timeout: 8_000 });
    await expect(resultPanel).toContainText('200');

    // Verify the JSON body (at least one key from mockBody is present)
    const bodyKeys = Object.keys(c.mockBody as Record<string, unknown>);
    if (bodyKeys.length > 0) {
      await expect(resultPanel).toContainText(bodyKeys[0]);
    }
  });
}
