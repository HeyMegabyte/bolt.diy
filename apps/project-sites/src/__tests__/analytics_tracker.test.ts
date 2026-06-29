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

  it('attaches a stable per-tab sessionId from sessionStorage to every event (AN19)', () => {
    const t = buildAnalyticsTracker('s1');
    expect(t).toContain('sessionStorage.getItem(k)');
    expect(t).toContain("'__ps_sid'");
    expect(t).toContain('var SID=sid()');
    expect(t).toContain('sessionId:SID');
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

  it('binds a capture-phase click listener that fires conversions for tel/mailto/directions (AN18 #60)', () => {
    const t = buildAnalyticsTracker('s1');
    // Capture-phase delegated listener.
    expect(t).toContain("addEventListener('click'");
    expect(t).toContain(',true)'); // capture phase
    // Classifies the three conversion kinds.
    expect(t).toContain("k='call'");
    expect(t).toContain("k='email'");
    expect(t).toContain("k='directions'");
    // Fires a conversion event tagged with the nearest section (AN26 → AN27).
    expect(t).toContain("window.psTrack('conversion'");
    expect(t).toContain('data-ps-section');
    expect(t).toContain('section:near(el)');
  });

  it('keeps the conversion binding fully wrapped in try/catch (never throws into the host page)', () => {
    const t = buildAnalyticsTracker('s1');
    // The whole binding block is guarded: `try{function near...}catch(_){}`.
    expect(t).toContain('function near(el)');
    expect(t).toContain('}catch(_){}})();');
  });

  it('binds form_start (focusin, once per form) + form_submit listeners (AN17 #61)', () => {
    const t = buildAnalyticsTracker('s1');
    expect(t).toContain("addEventListener('focusin'");
    expect(t).toContain("addEventListener('submit'");
    expect(t).toContain("window.psTrack('form_start'");
    expect(t).toContain("window.psTrack('form_submit'");
    expect(t).toContain('psFs'); // per-form dedup map (fire form_start once)
    expect(t).toContain('function psFk(f)'); // form key = id || name || section
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
