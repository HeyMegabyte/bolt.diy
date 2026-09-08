/**
 * AL-170 regression — the CF-zone analytics fallback log level.
 *
 * `GET /api/analytics/:siteId` runs a GA4 → CF-zone → D1 fallback chain. The CF API
 * token permanently lacks `zone.analytics.read` (and `*.projectsites.dev` subdomains
 * have no CF-zone dataset), so the CF-zone leg fails on EVERY load and the D1 fallback
 * serves the data. That expected failure used to log at `warn` every load — alert-fatigue
 * noise that buries real warnings (graceful-degradation-hides-outages). It now logs at
 * `info` when the error is an expected authz/config failure, `warn` only when it's a
 * genuinely-unexpected error (network/timeout/schema). This guards the classifier.
 */
import { isExpectedZoneAnalyticsFallback } from '../../libs/features/analytics/handlers.js';

describe('isExpectedZoneAnalyticsFallback (AL-170)', () => {
  it('treats authz / permission / config CF-zone failures as EXPECTED (→ info)', () => {
    const expected = [
      "Actor 'com.cloudflare.api.token.abc' does not have permission 'com.cloudflare.api.account.zone.analytics.read' for zone 9ceaa",
      'CF GraphQL errors: authentication error',
      'Unauthorized',
      'Forbidden',
      'HTTP 403 from Cloudflare GraphQL',
      'missing zone.analytics.read scope',
    ];
    for (const m of expected) {
      expect(isExpectedZoneAnalyticsFallback(m)).toBe(true);
    }
  });

  it('keeps genuinely-unexpected errors as warnings (→ warn)', () => {
    const unexpected = [
      'fetch failed: ECONNRESET',
      'Timeout after 10000ms',
      'Unexpected token < in JSON at position 0',
      'CF GraphQL errors: unknown field on httpRequestsAdaptiveGroups',
      'CF_API_TOKEN + CF_ZONE_ID required for Cloudflare zone analytics',
    ];
    for (const m of unexpected) {
      expect(isExpectedZoneAnalyticsFallback(m)).toBe(false);
    }
  });
});
