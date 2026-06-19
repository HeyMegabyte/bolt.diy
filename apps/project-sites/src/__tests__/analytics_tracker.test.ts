import { buildAnalyticsTracker, injectAnalyticsTracker } from '../services/analytics_tracker';

describe('buildAnalyticsTracker', () => {
  it('returns a complete script with the site id, endpoint, beacon + pageview', () => {
    const t = buildAnalyticsTracker('site-123');
    expect(t.startsWith('<script>')).toBe(true);
    expect(t.endsWith('</script>')).toBe(true);
    expect(t).toContain('"site-123"');
    expect(t).toContain('https://projectsites.dev/api/events');
    expect(t).toContain('navigator.sendBeacon');
    expect(t).toContain('window.psTrack');
    expect(t).toContain("'pageview'");
    expect(t).toContain('window.PS_SITE_ID');
  });

  it('honors a custom endpoint', () => {
    const t = buildAnalyticsTracker('s1', { endpoint: 'https://x.test/e' });
    expect(t).toContain('"https://x.test/e"');
    expect(t).not.toContain('projectsites.dev/api/events');
  });

  it('escapes a hostile siteId so it cannot break out of the <script> (XSS guard)', () => {
    const t = buildAnalyticsTracker('</script><img src=x onerror=alert(1)>');
    // The raw breakout sequence must NOT appear; every `<` is <-escaped.
    expect(t).not.toContain('</script><img');
    expect(t).toContain('\\u003c/script');
    // Exactly one real closing tag (the script's own).
    expect(t.match(/<\/script>/g)?.length).toBe(1);
  });
});

describe('injectAnalyticsTracker', () => {
  it('injects before the last </body>', () => {
    const out = injectAnalyticsTracker('<html><body><h1>Hi</h1></body></html>', 's1');
    expect(out).toContain('<script>');
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('</body>'));
  });

  it('appends when there is no </body>', () => {
    const out = injectAnalyticsTracker('<div>fragment</div>', 's1');
    expect(out.startsWith('<div>fragment</div>')).toBe(true);
    expect(out).toContain('window.PS_SITE_ID');
  });

  it('is idempotent — a doc already carrying the tracker is unchanged', () => {
    const once = injectAnalyticsTracker('<body></body>', 's1');
    const twice = injectAnalyticsTracker(once, 's1');
    expect(twice).toBe(once);
  });
});
