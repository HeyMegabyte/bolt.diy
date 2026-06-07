import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError, NEVER } from 'rxjs';
import { AdminAnalyticsComponent } from './analytics.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { PromptService } from '../../../services/prompt.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the P0 site-reactive-load class-bug fix for the Analytics section:
 * on a deep-link the selected site resolves AFTER mount, so the constructor
 * effect (not ngOnInit-once) must fire the analytics + URL fetch the instant
 * selectedSite() resolves — never leaving the panel empty until the 60s poll.
 */
describe('AdminAnalyticsComponent (site-reactive load)', () => {
  let fixture: ComponentFixture<AdminAnalyticsComponent>;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let getAnalytics: jasmine.Spy;
  let listUrls: jasmine.Spy;
  let credStatus: jasmine.Spy;

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    getAnalytics = jasmine.createSpy('getMultiUrlAnalytics').and.returnValue(of({ data: null }));
    listUrls = jasmine.createSpy('listSiteUrls').and.returnValue(of({ data: [] }));
    credStatus = jasmine.createSpy('getCloudflareCredentialStatus').and.returnValue(of({ data: null }));
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getMultiUrlAnalytics: getAnalytics,
            listSiteUrls: listUrls,
            getCloudflareCredentialStatus: credStatus,
            addSiteUrl: jasmine.createSpy('addSiteUrl').and.returnValue(of({})),
          },
        },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: PromptService, useValue: { prompt: jasmine.createSpy('prompt').and.resolveTo(null) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl'), navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminAnalyticsComponent);
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does NOT fetch analytics on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(credStatus).toHaveBeenCalled(); // org-level cred status still loads
  });

  // Cockpit cohesion: the no-site guard should use the shared cyan
  // <app-empty-state> (matching domains/voice), not a bespoke amber notice box.
  it('renders the no-site guard via the shared cyan app-empty-state (cyan SVG, no amber notice)', () => {
    build(null);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).withContext('uses the cockpit cyan empty-state primitive').toBeTruthy();
    expect(host.querySelector('.notice-amber')).withContext('no off-brand amber no-site notice').toBeNull();
    expect(host.querySelector('app-empty-state svg')).withContext('icon maps to a monochrome cyan SVG').toBeTruthy();
  });

  it('fetches analytics the instant the site resolves after mount (no poll tick)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();

    selectedSite.set({ id: 'site-deep-link' });
    fixture.detectChanges(); // flush the constructor effect — NOT the 60s timer

    expect(getAnalytics).toHaveBeenCalled();
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-deep-link');
    expect(listUrls).toHaveBeenCalledWith('site-deep-link');
  });

  it('re-fetches when the operator switches sites', () => {
    build({ id: 'site-a' });
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-a');

    selectedSite.set({ id: 'site-b' });
    fixture.detectChanges();

    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-b');
  });

  it('reload() clears a stale error at the start — no "Loading" pill over a stale error card; Retry feels responsive', () => {
    build({ id: 'site-x' });
    const c = fixture.componentInstance;
    c.error.set("Couldn't reach the analytics service");
    getAnalytics.and.returnValue(NEVER); // reload stays in-flight so we observe the start state
    c.reload();
    expect(c.error()).withContext('stale error cleared the instant the reload starts (error card hidden during retry)').toBeNull();
    expect(c.loading()).withContext('reload is in-flight').toBe(true);
  });

  it('the status badge reads "Unavailable" (not a false "Loading") when the load errors with no data', () => {
    build({ id: 'site-x' });
    const c = fixture.componentInstance;
    c.envelope.set(null as never);
    c.error.set('Server error');
    expect(c.dataLabel()).withContext('honest badge, not "Loading"').toBe('Unavailable');
    expect(c.dataHealth()).withContext('degraded health on error').toBe('degraded');
    expect(c.dataTooltip()).withContext('tooltip surfaces the error').toBe('Server error');
  });

  describe('pvTrend (period-over-period delta chip)', () => {
    function series(views: number[]): { series: { date: string; page_views: number; unique_visitors: number }[] } {
      return { series: views.map((v, i) => ({ date: `2026-06-0${i + 1}`, page_views: v, unique_visitors: v })) };
    }

    it('returns null until ≥4 days of data exist', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([10, 20, 30]) as never);
      expect(c.pvTrend()).toBeNull();
    });

    it('reports an up trend when the recent half outweighs the older half', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([10, 10, 30, 30]) as never); // older 20 → recent 60 = +200%
      const t = c.pvTrend();
      expect(t?.dir).toBe('up');
      expect(t?.label).toBe('200%');
    });

    it('reports a down trend (muted, never red) when traffic falls', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([40, 40, 10, 10]) as never); // older 80 → recent 20 = -75%
      const t = c.pvTrend();
      expect(t?.dir).toBe('down');
      expect(t?.label).toBe('75%');
    });

    it('reports flat when the halves are within ±1%', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([50, 50, 50, 50]) as never);
      expect(c.pvTrend()?.dir).toBe('flat');
    });

    it('reads as "new" when the earlier half had zero views', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([0, 0, 12, 18]) as never);
      const t = c.pvTrend();
      expect(t?.dir).toBe('up');
      expect(t?.label).toBe('new');
    });
  });

  it('surfaces an actionable, non-redundant error message on failure (not an echo of the banner header)', () => {
    build(null);
    getAnalytics.and.returnValue(throwError(() => ({ status: 500 })));
    selectedSite.set({ id: 'site-x' });
    fixture.detectChanges();
    const msg = (fixture.componentInstance.error() ?? '').toLowerCase();
    expect(msg).withContext('an error was surfaced').not.toBe('');
    // Must NOT merely echo the banner header "Analytics returned an error."
    expect(msg).not.toContain('returned an error');
    // Must guide the operator on what to do next.
    expect(msg).toMatch(/retry|temporar|unavailable|try again|moment|shortly/);
  });

  // A FAILED load must not also paint "0 views / no traffic yet" — that reads as
  // a definitive empty-data claim over an error (lying-UI). On error the body
  // (KPI tiles + chart + lists) is gated; only the error banner + Retry show.
  it('on error, the KPI tiles + chart body are NOT rendered (no lying "0"/"no traffic" over a failed load)', () => {
    build({ id: 'site-x' });
    fixture.componentInstance.error.set('Analytics service is unavailable.');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="kpi-pageviews"]')).withContext('KPI tiles hidden on error').toBeNull();
    expect(el.textContent).withContext('error banner still shows').toContain('Analytics returned an error');
    // Standardized onto the shared gold-standard <app-error-card> (Retry + support ref).
    expect(el.querySelector('app-error-card')).withContext('shared error-card primitive').not.toBeNull();
    expect(el.querySelector('[data-testid="error-retry"]')).withContext('Retry on the card').not.toBeNull();
  });

  it('surfaces the worker request_id as a copyable support reference on a failed load', () => {
    build(null);
    getAnalytics.and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_an7' } } })));
    selectedSite.set({ id: 'site-x' });
    fixture.detectChanges();
    expect(fixture.componentInstance.loadErrorRef()).toBe('req_an7');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="error-correlation"]')?.textContent).withContext('reference shown for support').toContain('req_an7');
  });

  it('with a site + no error, the KPI tiles render', () => {
    build({ id: 'site-x' });
    fixture.componentInstance.error.set(null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="kpi-pageviews"]'))
      .withContext('body renders on the happy path').not.toBeNull();
  });

  // a11y: each primary KPI figure is an animated <app-rolling-counter> number —
  // a screen reader otherwise reads the bare value with no label tying it to its
  // meaning ("Page views" / "Unique visitors" / "Total requests"). Each tile must
  // be a role=group with an aria-label combining the value AND the metric name
  // (the same per-stat pattern as the seo summary). aria-label is the SR truth so
  // it's read correctly even mid-count-up.
  it('each KPI tile is a role=group with an aria-label combining value + metric name', () => {
    build({ id: 'site-x' });
    const c = fixture.componentInstance;
    c.error.set(null);
    c.envelope.set({ series: [], pageviews: 1240, uniques: 312, total_requests: 5000 } as never);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const pv = el.querySelector('[data-testid="kpi-pageviews"]');
    expect(pv?.getAttribute('role')).withContext('KPI tile is a group').toBe('group');
    expect(pv?.getAttribute('aria-label')).withContext('aria-label carries value + meaning').toBe('1,240 page views');

    const vis = el.querySelector('[data-testid="kpi-visitors"]');
    expect(vis?.getAttribute('role')).toBe('group');
    expect(vis?.getAttribute('aria-label')).toBe('312 unique visitors');

    const req = el.querySelector('[data-testid="kpi-requests"]');
    expect(req?.getAttribute('role')).toBe('group');
    expect(req?.getAttribute('aria-label')).toBe('5,000 total requests');
  });

  it('the KPI aria-labels do not lie during the loading skeleton (no premature "0 …" claim)', () => {
    build({ id: 'site-x' });
    const c = fixture.componentInstance;
    c.error.set(null);
    c.envelope.set(null);
    c.loading.set(true);
    fixture.detectChanges();
    const pv = fixture.nativeElement.querySelector('[data-testid="kpi-pageviews"]') as HTMLElement;
    // While the skeleton shows (loading + no envelope), the tile must not assert
    // a definitive "0 page views" to AT — announce the loading status instead.
    expect(pv?.getAttribute('aria-label')).withContext('loading state announced, not a fake 0').toBe('Page views, loading');
  });

  // A 404 (route not registered for this site/env) is PERMANENT — not "temporary".
  // It must surface a calm "not available" notice (not the red transient error
  // card promising "try again") and pause auto-refresh (never re-poll a 404).
  it('treats a 404 as "not available" — calm cyan notice, no red error card, auto-refresh paused', () => {
    build(null);
    getAnalytics.and.returnValue(throwError(() => ({ status: 404, error: { error: { request_id: 'req_404' } } })));
    selectedSite.set({ id: 'site-x' });
    fixture.detectChanges();
    const c = fixture.componentInstance;
    expect(c.notAvailable()).withContext('404 → notAvailable').toBeTrue();
    expect(c.error()).withContext('no red transient error for a permanent 404').toBeNull();
    expect(c.autoRefreshPaused()).withContext('a permanent 404 stops the 60s re-poll').toBeTrue();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="analytics-unavailable"]')).withContext('calm not-available notice shown').not.toBeNull();
    expect(el.querySelector('app-error-card')).withContext('no red error card for a 404').toBeNull();
    expect(el.querySelector('[data-testid="kpi-pageviews"]')).withContext('KPI body hidden under the notice').toBeNull();
  });
});

/**
 * CSV export — formula-injection guard (CWE-1236). top_referrers / top_pages /
 * hostnames are attacker-controllable (a crafted Referer header lands in
 * analytics); a cell starting with = + - @ executes as a formula when the owner
 * opens the export in Excel/Sheets. csvCell() must prefix such values with a
 * literal apostrophe (text), AND still RFC-4180-quote comma/quote/newline.
 */
describe('AdminAnalyticsComponent (CSV export is formula-injection-safe)', () => {
  let c: AdminAnalyticsComponent;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        { provide: ApiService, useValue: { getMultiUrlAnalytics: () => of({ data: null }), listSiteUrls: () => of({ data: [] }), getCloudflareCredentialStatus: () => of({ data: null }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: PromptService, useValue: { prompt: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: () => 0, navigate: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
      ],
    });
    c = TestBed.createComponent(AdminAnalyticsComponent).componentInstance;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('prefixes formula-trigger cells (= + - @) with an apostrophe', () => {
    // starts with = AND contains " → apostrophe-prefixed THEN RFC-4180 quoted
    expect(c.csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    // no embedded quote/comma → just the apostrophe prefix
    expect(c.csvCell('+1+1')).toBe(`'+1+1`);
    expect(c.csvCell('-2-2')).toBe(`'-2-2`);
    expect(c.csvCell('@cmd')).toBe(`'@cmd`);
    expect(c.csvCell('\t=danger')).toBe(`'\t=danger`);
  });

  it('leaves a normal value untouched', () => {
    expect(c.csvCell('/pricing')).toBe('/pricing');
    expect(c.csvCell('google.com')).toBe('google.com');
  });

  it('RFC-4180-quotes embedded comma / quote / newline', () => {
    expect(c.csvCell('a,b')).toBe('"a,b"');
    expect(c.csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('combines both: a formula cell that also has a comma is prefixed THEN quoted', () => {
    expect(c.csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });
});

/**
 * Cyan/black cohesion: the Top-pages + Top-countries sub-panels used a bare gray
 * <p>No … yet</p> next to the polished bar rows. They now render a compact cyan
 * mini-empty (role=status + accent glyph) consistent with the cockpit empty-state
 * language. Sub-panel body renders under `selectedSite() && !error()` with a
 * truthy-but-empty envelope.
 */
describe('AdminAnalyticsComponent (top-pages/countries cyan mini-empty cohesion)', () => {
  let fixture: ComponentFixture<AdminAnalyticsComponent>;

  function build(): void {
    const selectedSite = signal<{ id: string } | null>({ id: 's' });
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getMultiUrlAnalytics: () => of({ data: null }),
            listSiteUrls: () => of({ data: [] }),
            getCloudflareCredentialStatus: () => of({ data: null }),
            addSiteUrl: () => of({}),
          },
        },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: PromptService, useValue: { prompt: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: () => 0, navigate: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminAnalyticsComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders a cyan mini-empty (role=status + glyph) for both Top-pages and Top-countries when empty', () => {
    build();
    const c = fixture.componentInstance;
    c.envelope.set({ series: [], top_pages: [], top_countries: [], pageviews: 0, uniques: 0 } as never);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.mini-empty[role="status"]').length)
      .withContext('both sub-panels use the cyan mini-empty (not bare gray text)').toBe(2);
    expect(host.querySelectorAll('.mini-empty .mini-empty-glyph').length)
      .withContext('each mini-empty has a cyan accent glyph').toBe(2);
  });
});

describe('AdminAnalyticsComponent — bounded auto-refresh retry (error-recovery max 3)', () => {
  let selectedSite: WritableSignal<{ id: string } | null>;
  let getAnalytics: jasmine.Spy;
  let fx: ComponentFixture<AdminAnalyticsComponent>;

  function build(): AdminAnalyticsComponent {
    selectedSite = signal<{ id: string } | null>({ id: 'site-x' });
    getAnalytics = jasmine.createSpy('getMultiUrlAnalytics').and.returnValue(of({ data: null }));
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        { provide: ApiService, useValue: {
          getMultiUrlAnalytics: getAnalytics,
          listSiteUrls: () => of({ data: [] }),
          getCloudflareCredentialStatus: () => of({ data: null }),
          addSiteUrl: () => of({}),
        } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: PromptService, useValue: { prompt: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: () => 0, navigate: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fx = TestBed.createComponent(AdminAnalyticsComponent);
    fx.detectChanges();
    return fx.componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('pauses auto-refresh after 3 consecutive load errors; a success resumes it', () => {
    const c = build();
    getAnalytics.and.returnValue(throwError(() => ({ status: 500 })));
    c.reload(); c.reload(); c.reload();
    expect(c.consecutiveErrors()).toBe(3);
    expect(c.autoRefreshPaused()).withContext('paused after max retries').toBeTrue();

    getAnalytics.and.returnValue(of({ data: { series: [] } }));
    c.reload();
    expect(c.consecutiveErrors()).toBe(0);
    expect(c.autoRefreshPaused()).withContext('a success resumes auto-refresh').toBeFalse();
  });

  it('a successful EMPTY response (data null, no error) does NOT pause auto-refresh', () => {
    const c = build();
    getAnalytics.and.returnValue(of({ data: null })); // "no traffic yet" — not an error
    c.reload(); c.reload(); c.reload(); c.reload();
    expect(c.consecutiveErrors()).toBe(0);
    expect(c.autoRefreshPaused()).toBeFalse();
  });
});

/**
 * Guards the deep-linkable time-range: `?range=30d` opens that window on load
 * (bookmarkable/shareable, winning over the localStorage-remembered range and
 * validated against the allow-list), and `setRange()` reflects the choice in
 * the URL via a merge/replaceUrl SPA navigation (no full reload, no back spam).
 */
describe('AdminAnalyticsComponent (deep-linkable range)', () => {
  let navigate: jasmine.Spy;
  let selectedSite: WritableSignal<{ id: string } | null>;

  function build(rangeParam: string | null): AdminAnalyticsComponent {
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    selectedSite = signal<{ id: string } | null>({ id: 'site-1' });
    // Permissive API stub: any method → a safe observable (constructor effect
    // + setRange both fan out to several api calls).
    const api = new Proxy(
      {},
      { get: (_t, prop) => () => of(prop === 'listSiteUrls' ? { data: [] } : { data: null }) },
    );
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: PromptService, useValue: { prompt: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: () => 0, navigate } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => rangeParam } } } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    const fx = TestBed.createComponent(AdminAnalyticsComponent);
    fx.detectChanges();
    return fx.componentInstance;
  }

  beforeEach(() => {
    try { localStorage.removeItem('ps_analytics_range'); } catch { /* */ }
  });
  afterEach(() => TestBed.resetTestingModule());

  it('opens the window named by `?range=30d` on load (over the stored default)', () => {
    const c = build('30d');
    expect(c.range()).withContext('deep-link wins over localStorage default').toBe('30d');
  });

  it('ignores an unknown `?range=` value and keeps the default 7d window', () => {
    const c = build('bogus');
    expect(c.range()).toBe('7d');
  });

  it('setRange() reflects the choice in the URL (merge + replaceUrl, no reload)', () => {
    const c = build(null);
    navigate.calls.reset();
    c.setRange('90d');
    expect(c.range()).toBe('90d');
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: { range: '90d' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });
});
