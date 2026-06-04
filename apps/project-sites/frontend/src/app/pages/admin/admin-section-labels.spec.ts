import { adminSectionLabel, ADMIN_SECTION_LABELS } from './admin-section-labels';

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
    expect(adminSectionLabel('feature-flags')).toBe('Feature Flags');
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
