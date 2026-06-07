import { adminSectionLabel, adminSectionLabelFromPath, ADMIN_SECTION_LABELS } from './admin-section-labels';

/**
 * Guards the per-route document-title map (WCAG 2.4.2 Page Titled). A missing
 * entry silently falls back to 'Editor' — leaving a stale/wrong title on that
 * route (the live bug this fixes for bulk-ops/deliverability/webhooks/etc.).
 */
describe('adminSectionLabel (per-route title map)', () => {
  it('labels the previously-missing routes (no more "Editor" fallback)', () => {
    expect(adminSectionLabel('bulk-ops')).toBe('Bulk Ops');
    expect(adminSectionLabel('deliverability')).toBe('Deliverability');
    expect(adminSectionLabel('webhooks')).toBe('Webhooks');
    expect(adminSectionLabel('review-links')).toBe('Review Links');
    expect(adminSectionLabel('api-tokens')).toBe('API Tokens');
    expect(adminSectionLabel('enterprise')).toBe('Enterprise');
    expect(adminSectionLabel('trust')).toBe('Trust Center');
    expect(adminSectionLabel('stripe-app-status')).toBe('Stripe Status');
    expect(adminSectionLabel('accept-invite')).toBe('Accept Invite');
    expect(adminSectionLabel('recipes')).toBe('Automations');
  });

  it('keeps the established labels intact', () => {
    expect(adminSectionLabel('snapshots')).toBe('Snapshots');
    expect(adminSectionLabel('sites')).toBe('Sites');
    // LAYER 1 platform-ops flags titled "System Admin" (operator-only) since the
    // two-layer plane landed (2026-06-07) — see admin nav + sysAdminGuard.
    expect(adminSectionLabel('feature-flags')).toBe('System Admin');
  });

  it('disambiguates the two-layer feature surfaces (no "Dashboard" fallback / WCAG 2.4.2)', () => {
    // /admin/features = the Features Hub; /admin/site-features = the owner-facing
    // Features layer. Both must have distinct, correct titles — site-features was
    // missing → fell back to "Dashboard".
    expect(adminSectionLabel('features')).toBe('Features Hub');
    expect(adminSectionLabel('site-features')).toBe('Features');
    expect(adminSectionLabelFromPath('/admin/site-features')).toBe('Features');
  });

  it('labels the /admin index route "Dashboard" (it renders the AI dashboard, not the editor)', () => {
    expect(adminSectionLabel('')).toBe('Dashboard');
    expect(adminSectionLabel('admin')).toBe('Dashboard');
    // the editor moved to /admin/editor — those segments stay "Editor"
    expect(adminSectionLabel('editor')).toBe('Editor');
    expect(adminSectionLabel('editor-native')).toBe('Editor');
  });

  it('falls back to Dashboard (the home) for genuinely-unknown segments', () => {
    expect(adminSectionLabel('totally-unknown-xyz')).toBe('Dashboard');
  });

  it('every label is non-empty (so the title is never "  · ProjectSites")', () => {
    for (const [seg, label] of Object.entries(ADMIN_SECTION_LABELS)) {
      expect(label.length).withContext(`segment "${seg}"`).toBeGreaterThan(0);
    }
  });
});

/**
 * The path resolver fixes the real bug: param routes (`/admin/sites/:id`) +
 * sub-paths (`/admin/snapshots/diff`) used to mislabel to "Dashboard" because a
 * bare last-segment lookup hit the param value / unmapped tail. Walk-back picks
 * the section root for a param, but keeps a sub-VIEW's own label.
 */
describe('adminSectionLabelFromPath (param + sub-path routes)', () => {
  it('labels PARAM routes by their section root, not the param value (was "Dashboard")', () => {
    expect(adminSectionLabelFromPath('/admin/sites/e2e-site-1')).toBe('Sites');
    expect(adminSectionLabelFromPath('/admin/swarm/e2e-site-1')).toBe('Swarm');
    expect(adminSectionLabelFromPath('/admin/apps/some-app-id')).toBe('Apps');
    expect(adminSectionLabelFromPath('/admin/apps/instances/inst-9')).toBe('App Instances');
  });

  it('keeps a sub-VIEW label when the tail segment is itself a known section', () => {
    expect(adminSectionLabelFromPath('/admin/sites/e2e-site-1/branches')).toBe('Branches');
    expect(adminSectionLabelFromPath('/admin/sites/e2e-site-1/copilot')).toBe('Copilot');
    expect(adminSectionLabelFromPath('/admin/sites/e2e-site-1/dna')).toBe('Site DNA');
    expect(adminSectionLabelFromPath('/admin/sites/e2e-site-1/mcp-server')).toBe('MCP Server');
    expect(adminSectionLabelFromPath('/admin/snapshots/diff')).toBe('Snapshot Diff');
    expect(adminSectionLabelFromPath('/admin/domains/dom-1/stack')).toBe('Domain Stack');
  });

  it('handles the index, query/hash, and unknown (404) paths', () => {
    expect(adminSectionLabelFromPath('/admin')).toBe('Dashboard');
    expect(adminSectionLabelFromPath('/admin/snapshots/diff?from=a&to=b')).toBe('Snapshot Diff');
    expect(adminSectionLabelFromPath('/admin/feature-flags#stage')).toBe('System Admin');
    expect(adminSectionLabelFromPath('/admin/totally-unknown-xyz')).toBe('Dashboard');
  });

  it('top-level sections resolve the same as the bare-segment lookup (no regression)', () => {
    expect(adminSectionLabelFromPath('/admin/billing')).toBe('Billing');
    expect(adminSectionLabelFromPath('/admin/feature-flags')).toBe('System Admin');
    expect(adminSectionLabelFromPath('/admin/traces')).toBe('AI Traces');
  });
});
