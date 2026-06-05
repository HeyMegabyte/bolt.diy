import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminFeaturesHubComponent } from './features-hub.component';

/**
 * First coverage for the Features Hub (catalog + try-it surface — was untested):
 *  - visible() tab + search filtering
 *  - countFor / flagState lookups
 *  - nextTabId: the WAI-ARIA Tabs keyboard pattern (Arrow/Home/End + wraparound)
 *    behind the roving-tabindex headers added this round
 *  - tryIt success + error result capture (per-endpoint loading/result keys)
 * overrideComponent strips the template so ngOnInit's flag fetch doesn't auto-fire.
 */
function make(httpGet = jasmine.createSpy('get').and.returnValue(of({ flags: [] }))): {
  c: AdminFeaturesHubComponent;
  navigate: jasmine.Spy;
  post: jasmine.Spy;
} {
  const navigate = jasmine.createSpy('navigate');
  const post = jasmine.createSpy('post').and.returnValue(of({ status: 200, body: { ok: true } }));
  TestBed.configureTestingModule({
    imports: [AdminFeaturesHubComponent],
    providers: [
      { provide: HttpClient, useValue: { get: httpGet, post } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  TestBed.overrideComponent(AdminFeaturesHubComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminFeaturesHubComponent).componentInstance, navigate, post };
}

describe('AdminFeaturesHubComponent (filter + tabs + try-it)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('visible() returns only the active tab’s features', () => {
    const { c } = make();
    c.tab.set('ide');
    expect(c.visible().length).toBeGreaterThan(0);
    expect(c.visible().every((f) => f.tab === 'ide')).toBe(true);
  });

  it('search narrows within the active tab and matches name/flag/why', () => {
    const { c } = make();
    const first = c.visible()[0];
    c.search.set(first.flag);
    expect(c.visible().some((f) => f.flag === first.flag)).toBe(true);
    c.search.set('zzz-no-such-feature-zzz');
    expect(c.visible().length).toBe(0);
  });

  it('countFor counts every feature in a tab regardless of search', () => {
    const { c } = make();
    c.search.set('zzz');
    expect(c.countFor('ide')).toBeGreaterThan(0);
  });

  it('nextTabId follows the ARIA Tabs pattern with wraparound', () => {
    const { c } = make();
    const ids = c.tabs.map((t) => t.id);
    expect(c.nextTabId('ide', 'ArrowRight')).toBe(ids[1]);
    expect(c.nextTabId('ide', 'ArrowLeft')).toBe(ids[ids.length - 1]); // wrap to last
    expect(c.nextTabId(ids[ids.length - 1], 'ArrowRight')).toBe(ids[0]); // wrap to first
    expect(c.nextTabId('ide', 'Home')).toBe(ids[0]);
    expect(c.nextTabId('ide', 'End')).toBe(ids[ids.length - 1]);
    expect(c.nextTabId('ide', 'Enter')).toBe('ide'); // non-nav key = no move
  });

  it('no tab label embeds its own icon (the template renders <icon> + <label> — embedding doubles it)', () => {
    const { c } = make();
    for (const t of c.tabs) {
      expect(t.label.trim().startsWith(t.icon))
        .withContext(`tab "${t.label}" prefixes its own icon "${t.icon}" → renders it twice`).toBeFalse();
    }
  });

  it('flagState reflects the loaded flag map', () => {
    const { c } = make();
    c.flags.set({ multi_model_router: { key: 'multi_model_router', default_enabled: true, stage: 'stable' } as never });
    expect(c.flagState('multi_model_router')?.default_enabled).toBe(true);
    expect(c.flagState('unknown_flag')).toBeUndefined();
  });

  it('tryIt captures a successful response under the per-endpoint key', async () => {
    const { c } = make();
    const feature = c.visible()[0];
    await c.tryIt(feature, 0);
    const key = `${feature.flag}:0`;
    expect(c.result()[key]?.status).toBe(200);
    expect(c.loading()[key]).toBe(false);
  });

  it('tryIt captures an error response without throwing', async () => {
    const { c } = make();
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 404, error: { error: 'flag_disabled' } })));
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404, error: { error: 'flag_disabled' } })));
    (c as unknown as { http: { post: jasmine.Spy; get: jasmine.Spy } }).http.post = post;
    (c as unknown as { http: { post: jasmine.Spy; get: jasmine.Spy } }).http.get = get;
    const feature = c.visible()[0];
    await c.tryIt(feature, 0);
    const key = `${feature.flag}:0`;
    expect(c.loading()[key]).toBe(false);
    expect(c.result()[key]?.status).toBe(404);
  });
});

/**
 * WCAG 1.4.1 (use of color): the "a feature flag" link in the hub subtitle is an
 * in-text-block link, so it MUST carry a non-color distinguisher (underline) by
 * default — color alone fails axe link-in-text-block (serious). Real-template render.
 */
import { provideRouter } from '@angular/router';
describe('AdminFeaturesHubComponent (in-text feature-flags link is underlined)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('the subtitle feature-flags link has the underline affordance (not color-only)', () => {
    TestBed.configureTestingModule({
      imports: [AdminFeaturesHubComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ flags: [] }), post: () => of({}) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminFeaturesHubComponent);
    fx.detectChanges();
    const link = (fx.nativeElement as HTMLElement).querySelector('a[routerLink="/admin/feature-flags"]');
    expect(link).not.toBeNull();
    expect(link!.className).withContext('in-text link needs a default underline, not color-only').toContain('underline');
  });

  it('a try-it result reads its outcome by HTTP range: 5xx → --err, 4xx → --warn, 2xx → --ok', () => {
    TestBed.configureTestingModule({
      imports: [AdminFeaturesHubComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ flags: [] }), post: () => of({}) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminFeaturesHubComponent);
    fx.componentInstance.tab.set('obs'); // tab holding otlp_unified_events (endpoint 0)
    fx.detectChanges();
    const key = 'otlp_unified_events:0';
    const res = () => (fx.nativeElement as HTMLElement).querySelector('[data-testid="hub-result"]');
    // 500 — was a transparent/neutral border (indistinguishable from 200); now red.
    fx.componentInstance.result.set({ [key]: { status: 500, body: {} } });
    fx.detectChanges();
    expect(res()).withContext('try-it result renders').toBeTruthy();
    expect(res()!.classList.contains('hub-result--err')).withContext('5xx → error border').toBeTrue();
    fx.componentInstance.result.set({ [key]: { status: 403, body: {} } });
    fx.detectChanges();
    expect(res()!.classList.contains('hub-result--warn')).withContext('4xx → warn border').toBeTrue();
    fx.componentInstance.result.set({ [key]: { status: 200, body: {} } });
    fx.detectChanges();
    expect(res()!.classList.contains('hub-result--ok')).withContext('2xx → ok border').toBeTrue();
  });

  it('the feature-flags link is a WORKING RouterLink (renders href → SPA nav, not a dead attribute)', () => {
    TestBed.configureTestingModule({
      imports: [AdminFeaturesHubComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ flags: [] }), post: () => of({}) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminFeaturesHubComponent);
    fx.detectChanges();
    const link = (fx.nativeElement as HTMLElement).querySelector(
      'a[routerLink="/admin/feature-flags"]',
    ) as HTMLAnchorElement;
    // RouterLink on an <a> renders an href. Without the directive in the
    // component imports the attribute is INERT (no href) → a dead link.
    expect(link.getAttribute('href')).toBe('/admin/feature-flags');
  });
});
