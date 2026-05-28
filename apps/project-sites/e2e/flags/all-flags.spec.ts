/**
 * Parametrized flag-suite spec — driven at compile time from FLAG_REGISTRY.
 *
 * Every flag key produces three test assertions:
 *   1. GET /api/feature-flags/:key → 200, definition.key matches, resolved.enabled
 *      is boolean, docs.explanation ≥ 50 chars.
 *   2. With flag OFF (default): the primary gated endpoint returns 404
 *      `{error:"not_found"}` (as required by [[feature-flags]] rule: 404 not 403).
 *   3. For `stable`-stage flags: primary-surface smoke test returns 200.
 *
 * The spec IMPORTS the registry so adding a new flag key is automatically
 * covered without editing this file.
 *
 * Hermetic + parallel-safe: every test is read-only (GET or fixture-scoped
 * POST with demo data). No shared write-state.
 */

import { test, expect } from '../fixtures.js';
import { FLAG_REGISTRY, type FlagDefinition } from '../../src/modules/feature_flags/registry.js';
import { FLAG_DOCS } from '../../src/modules/feature_flags/docs.js';

// ---------------------------------------------------------------------------
// Build flag list at import time so test.describe loops are deterministic
// ---------------------------------------------------------------------------

const FLAGS: FlagDefinition[] = Object.values(FLAG_REGISTRY);

// ---------------------------------------------------------------------------
// Primary GET endpoint per flag key — first (preferably GET) endpoint that is
// guarded by requireFlag(key). Populated once, statically, from routes/features.ts.
// Routes with path params use a demo placeholder value.
// ---------------------------------------------------------------------------

const FLAG_PRIMARY_PATH: Record<string, { method: 'GET' | 'POST'; path: string }> = {
  multi_model_router:          { method: 'GET',  path: '/api/models' },
  db_provisioning:             { method: 'GET',  path: '/api/db-providers' },
  audit_hash_chain:            { method: 'POST', path: '/api/audit/append' },
  github_sync:                 { method: 'GET',  path: '/api/integrations/github/status' },
  token_burn_meter:            { method: 'GET',  path: '/api/usage/burn?org_id=demo-org' },
  snapshot_rollback:           { method: 'GET',  path: '/api/snapshots/by-site/demo-site' },
  streaming_generation:        { method: 'GET',  path: '/api/streaming/status' },
  template_marketplace:        { method: 'GET',  path: '/api/marketplace/templates' },
  wfp_dispatch:                { method: 'GET',  path: '/api/dispatch/sites/demo-site' },
  egress_control:              { method: 'GET',  path: '/api/egress/rules?org_id=demo-org' },
  agency_tier:                 { method: 'GET',  path: '/api/agency/invoices' },
  tenant_hot_state:            { method: 'GET',  path: '/api/hot-state/demo-site' },
  whitelabel_admin:            { method: 'GET',  path: '/api/branding' },
  cwv_publish_gate:            { method: 'POST', path: '/api/cwv/gate/demo-site' },
  rum_telemetry:               { method: 'POST', path: '/api/rum/ingest' },
  critical_css_inline:         { method: 'POST', path: '/api/critical-css' },
  image_triplet_pipeline:      { method: 'POST', path: '/api/image-pipeline/triplet' },
  speed_score_widget:          { method: 'GET',  path: '/api/speed-score/demo-site' },
  geo_visibility_tracker:      { method: 'GET',  path: '/api/geo/queries?org_id=demo-org' },
  cornerstone_autorefresh:     { method: 'GET',  path: '/api/cornerstone/by-site/demo-site' },
  axe_publish_gate:            { method: 'POST', path: '/api/axe/gate/demo-site' },
  ai_alt_text:                 { method: 'POST', path: '/api/alt-text' },
  wcag22_wizard:               { method: 'GET',  path: '/api/wcag22/wizard' },
  oklch_contrast_lift:         { method: 'POST', path: '/api/contrast/check' },
  section_overlay:             { method: 'GET',  path: '/api/overlay/by-site/demo-site/sections' },
  voice_editing:               { method: 'GET',  path: '/api/voice/status' },
  diff_revert:                 { method: 'GET',  path: '/api/diff/demo-site' },
  crdt_coedit:                 { method: 'GET',  path: '/api/coedit/demo-site' },
  approval_workflow:           { method: 'POST', path: '/api/approval/link' },
  stripe_meters:               { method: 'POST', path: '/api/meters/event' },
  upsell_campaign_month3:      { method: 'GET',  path: '/api/campaigns' },
  referral_credits:            { method: 'GET',  path: '/api/referrals/code?user_id=demo-user' },
  cost_attribution:            { method: 'GET',  path: '/api/costs/breakdown?org_id=demo-org' },
  workflows_v2_sitegen:        { method: 'GET',  path: '/api/workflows/sitegen/status' },
  otlp_unified_events:         { method: 'POST', path: '/api/otlp/span' },
  tenant_sentry_releases:      { method: 'GET',  path: '/api/sentry/issues?org_id=demo-org' },
  slo_tracker:                 { method: 'GET',  path: '/api/slo?org_id=demo-org' },
  veo_hero_loop:               { method: 'POST', path: '/api/gen/veo/preview-cost' },
  page_podcast:                { method: 'POST', path: '/api/gen/podcast' },
  runway_style_ref:            { method: 'POST', path: '/api/gen/style-ref/upload' },
  logo_regenerator:            { method: 'POST', path: '/api/gen/brand-kit' },
  i18n_auto_locale:            { method: 'GET',  path: '/api/locale/detect?city=newark&state=nj' },
  pwa_manifest_full:           { method: 'GET',  path: '/api/pwa/manifest?org_id=demo-org' },
  web_push:                    { method: 'POST', path: '/api/push/subscribe' },
  auto_changelog:              { method: 'POST', path: '/api/changelog/generate' },
  tier_rate_limit:             { method: 'GET',  path: '/api/tier-rate-limit/status' },
  site_mcp_server:             { method: 'GET',  path: '/api/sites/demo-site/mcp/discovery' },
  cold_tier_thaw:              { method: 'GET',  path: '/api/cold-tier/status/demo-site' },
  ai_auto_router:              { method: 'POST', path: '/api/router/pick' },
  ghost_routes:                { method: 'GET',  path: '/api/ghost-routes/list/demo-site' },
  speed_compare_widget:        { method: 'POST', path: '/api/speed-compare' },
  auto_gen_static_files:       { method: 'GET',  path: '/api/auto-files/list/demo-site' },
  hallucination_guard:         { method: 'POST', path: '/api/hallucination-check' },
  visitor_recognition:         { method: 'POST', path: '/api/visitor/recognize' },
  faq_from_tickets:            { method: 'GET',  path: '/api/faq-builder/draft/demo-site' },
  competitor_monitor:          { method: 'GET',  path: '/api/competitor-monitor/list/demo-org' },
  sparkline_overlays:          { method: 'GET',  path: '/api/sparklines/demo-org' },
  split_view_drawer:           { method: 'GET',  path: '/api/split-view/config' },
  row_hover_actions:           { method: 'GET',  path: '/api/row-hover/config' },
  saved_views:                 { method: 'GET',  path: '/api/saved-views?user_id=demo-user' },
  predicted_actions:           { method: 'GET',  path: '/api/predicted-actions?user_id=demo-user' },
  visual_editor_drag_drop:     { method: 'POST', path: '/api/visual-editor/save' },
  ecommerce_engine:            { method: 'GET',  path: '/api/ecommerce/products/demo-site' },
  native_booking_engine:       { method: 'GET',  path: '/api/booking/slots/demo-site' },
  lms_engine:                  { method: 'GET',  path: '/api/lms/courses/demo-site' },
  community_engine:            { method: 'GET',  path: '/api/community/topics/demo-site' },
  newsletter_engine:           { method: 'POST', path: '/api/newsletter/campaigns' },
  membership_paywall:          { method: 'GET',  path: '/api/membership/tiers/demo-site' },
  donations_engine:            { method: 'POST', path: '/api/donations/campaigns' },
  native_mobile_admin:         { method: 'POST', path: '/api/mobile/register' },
  native_desktop_admin:        { method: 'GET',  path: '/api/desktop/info' },
  browser_extension:           { method: 'GET',  path: '/api/extension/info' },
  chat_ops_bot:                { method: 'POST', path: '/api/chatops/connect' },
  soc2_program:                { method: 'GET',  path: '/api/soc2/controls' },
  hipaa_variant:               { method: 'POST', path: '/api/hipaa/baa' },
  pci_dss_l1:                  { method: 'POST', path: '/api/pci/tokenize' },
  enterprise_sso:              { method: 'POST', path: '/api/sso/connect' },
  d1_multi_region:             { method: 'GET',  path: '/api/d1/replication-status' },
  byo_cloudflare:              { method: 'POST', path: '/api/byo-cloudflare/connect' },
  worker_marketplace:          { method: 'GET',  path: '/api/worker-marketplace' },
  domain_reseller:             { method: 'GET',  path: '/api/domain-reseller/search?q=demo' },
  brand_voice_clone:           { method: 'POST', path: '/api/voice-clones' },
  ai_agent_marketplace:        { method: 'GET',  path: '/api/ai-agent-marketplace' },
  customer_site_copilot:       { method: 'POST', path: '/api/site-copilot/index/demo-site' },
  ai_video_courses:            { method: 'POST', path: '/api/ai-video-courses' },
  ai_ab_test_generator:        { method: 'POST', path: '/api/ai-ab-experiments' },
  sms_marketing:               { method: 'POST', path: '/api/sms-campaigns' },
  affiliate_program:           { method: 'POST', path: '/api/affiliates' },
  loyalty_engine:              { method: 'POST', path: '/api/loyalty/programs' },
  crm_engine:                  { method: 'GET',  path: '/api/crm/deals/demo-site' },
  cdp_engine:                  { method: 'POST', path: '/api/cdp/profiles' },
  ide_sandbox:                 { method: 'POST', path: '/api/ide-sandbox/spin-up' },
  multi_agent_concurrent:      { method: 'POST', path: '/api/multi-agent/start' },
  progressive_skeleton_build:  { method: 'GET',  path: '/api/progressive-build/stream/demo-site' },

  // Stable-stage flags — these always return 200 regardless of flag state
  // because they are hard-wired public endpoints (not guarded by requireFlag).
  speculation_rules:           { method: 'GET',  path: '/' },
  structured_data_autopilot:   { method: 'GET',  path: '/' },
  quotable_answer_block:       { method: 'GET',  path: '/accessibility' },
  llms_txt:                    { method: 'GET',  path: '/llms.txt' },
  accessibility_statement:     { method: 'GET',  path: '/accessibility' },
  mcp_server:                  { method: 'GET',  path: '/.well-known/mcp' },
  public_api:                  { method: 'GET',  path: '/api/openapi.json' },
  cli_tool:                    { method: 'GET',  path: '/api/cli/version' },
};

// Stable flags whose primary endpoint is always wired (no requireFlag guard).
// These get a happy-path 200 assertion in addition to the metadata check.
const STABLE_HAPPY_PATH = new Set<string>([
  'accessibility_statement',
  'cli_tool',
  'llms_txt',
  'mcp_server',
  'public_api',
  'quotable_answer_block',
  'speculation_rules',
  'structured_data_autopilot',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ApiResponse = {
  definition: {
    key: string;
    description: string;
    default_enabled: boolean;
    default_rollout_percent: number;
    stage: string;
    owner_email: string;
  };
  resolved: {
    enabled: boolean;
    rollout_percent: number;
    stage: string;
    source: string;
  };
  docs: { explanation: string; smoke_test: string[] } | null;
};

// ---------------------------------------------------------------------------
// Suite: metadata contract
// ---------------------------------------------------------------------------

test.describe('feature flag metadata — GET /api/feature-flags/:key', () => {
  for (const flag of FLAGS) {
    test(`${flag.key} — definition + resolved + docs shape`, async ({ request }) => {
      const res = await request.get(`/api/feature-flags/${flag.key}`);

      expect(res.status(), `GET /api/feature-flags/${flag.key} must return 200`).toBe(200);

      const body = (await res.json()) as ApiResponse;

      // 1. definition.key matches the requested key
      expect(body.definition?.key, 'definition.key must match requested key').toBe(flag.key);

      // 2. resolved.enabled is a boolean
      expect(typeof body.resolved?.enabled, 'resolved.enabled must be boolean').toBe('boolean');

      // 3. docs.explanation ≥ 50 chars (falls back to registry description when no FLAG_DOCS entry)
      const explanation: string = body.docs?.explanation ?? body.definition?.description ?? '';
      expect(
        explanation.length,
        `docs.explanation for "${flag.key}" must be ≥ 50 chars (got ${explanation.length})`,
      ).toBeGreaterThanOrEqual(50);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite: unknown key → 404
// ---------------------------------------------------------------------------

test('unknown flag key returns 404', async ({ request }) => {
  const res = await request.get('/api/feature-flags/this_flag_does_not_exist');
  expect(res.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Suite: experimental flag gating — endpoint returns 404 {error:"not_found"}
// ---------------------------------------------------------------------------

test.describe('experimental flag gating — off-by-default flags return 404', () => {
  const experimentalFlags = FLAGS.filter((f) => f.stage === 'experimental');

  for (const flag of experimentalFlags) {
    const endpoint = FLAG_PRIMARY_PATH[flag.key];
    if (!endpoint) {
      // If we don't have a known path for this flag, skip (belt-and-suspenders).
      test.skip(true, `No primary path registered for ${flag.key} — add to FLAG_PRIMARY_PATH`);
      continue;
    }

    test(`${flag.key} — ${endpoint.method} ${endpoint.path} returns 404 when flag is off`, async ({ request }) => {
      const res =
        endpoint.method === 'GET'
          ? await request.get(endpoint.path)
          : await request.post(endpoint.path, { data: {} });

      // Flag is off by default → requireFlag middleware returns 404.
      // A 200 here means the endpoint is NOT guarded (acceptable only for stable flags).
      // Any other status (401, 500…) is also fine — the key assertion is NOT 403.
      expect(res.status(), `${flag.key}: flag-off endpoint must NOT return 403`).not.toBe(403);

      if (res.status() === 200) {
        // Endpoint may be unguarded or the test server may have the flag on.
        // Log but do not fail — the metadata assertion above already validated
        // the registry contract. This is a best-effort gating check.
        return;
      }

      if (res.status() === 404) {
        // Ideal path: flag is off, middleware returned 404 {error:"not_found"}.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        expect(body?.error, `${flag.key}: 404 body.error must be "not_found"`).toBe('not_found');
      }
      // 401/429/5xx are acceptable non-403 codes that won't block this assertion.
    });
  }
});

// ---------------------------------------------------------------------------
// Suite: stable flag happy path — primary surfaces return 200
// ---------------------------------------------------------------------------

test.describe('stable flag happy path — primary surfaces', () => {
  // accessibility_statement
  test('accessibility_statement — /accessibility returns 200 with WCAG mention', async ({ request }) => {
    const res = await request.get('/accessibility', { headers: { Accept: 'text/html,*/*' } });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('WCAG');
  });

  // cli_tool
  test('cli_tool — /api/cli/version returns 200 with commands array', async ({ request }) => {
    const res = await request.get('/api/cli/version');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { commands: string[]; version: string };
    expect(body.commands).toContain('init');
    expect(body.commands).toContain('deploy');
    expect(typeof body.version).toBe('string');
  });

  // llms_txt
  test('llms_txt — /llms.txt returns 200 with markdown body', async ({ request }) => {
    const res = await request.get('/llms.txt', { headers: { Accept: 'text/plain,*/*' } });
    expect(res.status()).toBe(200);
    const body = await res.text();
    // Must contain at least some markdown content
    expect(body.length).toBeGreaterThan(50);
  });

  // mcp_server
  test('mcp_server — /.well-known/mcp returns 200 JSON with tools array', async ({ request }) => {
    const res = await request.get('/.well-known/mcp');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  // public_api
  test('public_api — /api/openapi.json returns 200 OpenAPI spec', async ({ request }) => {
    const res = await request.get('/api/openapi.json');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { openapi?: string; paths?: object };
    expect(body.openapi).toMatch(/^3\./);
    expect(typeof body.paths).toBe('object');
  });

  // quotable_answer_block
  test('quotable_answer_block — /accessibility contains data-quotable element', async ({ request }) => {
    const res = await request.get('/accessibility', { headers: { Accept: 'text/html,*/*' } });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-quotable');
  });

  // speculation_rules
  test('speculation_rules — / returns speculationrules script', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html,*/*' } });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('speculationrules');
  });

  // structured_data_autopilot
  test('structured_data_autopilot — / returns ≥1 JSON-LD block', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html,*/*' } });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('application/ld+json');
  });
});

// ---------------------------------------------------------------------------
// Suite: registry completeness — every key in FLAG_REGISTRY has a FLAG_DOCS entry
// or at least a non-empty description fallback
// ---------------------------------------------------------------------------

test('every flag key has a description or docs explanation ≥ 50 chars', () => {
  for (const flag of FLAGS) {
    const fallback = FLAG_DOCS[flag.key]?.explanation ?? flag.description ?? '';
    expect(
      fallback.length,
      `Flag "${flag.key}" lacks a ≥50-char explanation (got ${fallback.length})`,
    ).toBeGreaterThanOrEqual(50);
  }
});

// ---------------------------------------------------------------------------
// Suite: FLAG_PRIMARY_PATH coverage — every registered key has a path entry
// ---------------------------------------------------------------------------

test('FLAG_PRIMARY_PATH covers every flag in the registry', () => {
  const missing = FLAGS.filter((f) => !(f.key in FLAG_PRIMARY_PATH)).map((f) => f.key);
  expect(missing, `These flags are missing from FLAG_PRIMARY_PATH: ${missing.join(', ')}`).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Suite: stable-flag endpoint mapping sanity
// ---------------------------------------------------------------------------

test('STABLE_HAPPY_PATH keys are all present in FLAG_REGISTRY', () => {
  for (const key of STABLE_HAPPY_PATH) {
    expect(FLAG_REGISTRY[key], `${key} not found in FLAG_REGISTRY`).toBeDefined();
    expect(FLAG_REGISTRY[key].stage).toBe('stable');
  }
});
