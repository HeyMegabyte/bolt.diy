import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router, provideRouter } from '@angular/router';
import { AdminSitesComponent } from './sites.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * First coverage for the core /admin/sites Web-Vitals listing (was untested):
 *  - sortBy toggle/switch semantics + triage reset
 *  - ariaSort WAI-ARIA state (the keyboard-sortable headers added this round)
 *  - sortedRows ordering (composite desc default, name asc alphabetical)
 *  - the CWV tier thresholds (heatmap colors)
 * overrideComponent strips the heavy table template so ngOnInit's fetch doesn't
 * auto-fire; logic is driven directly with rows set.
 */
type Row = {
  site_id: string;
  slug: string;
  business_name: string;
  composite_score: number | null;
  latest: { lcp_ms: number | null; cls: number | null; inp_ms: number | null; lh_perf: number | null };
};

function make(): AdminSitesComponent {
  TestBed.configureTestingModule({
    imports: [AdminSitesComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => of({ data: [], sites: [] }) } },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
    ],
  });
  TestBed.overrideComponent(AdminSitesComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminSitesComponent).componentInstance;
}

function row(over: Partial<Row> = {}): Row {
  return {
    site_id: over.site_id ?? 'x',
    slug: over.slug ?? 'x',
    business_name: over.business_name ?? '',
    composite_score: over.composite_score ?? null,
    latest: { lcp_ms: null, cls: null, inp_ms: null, lh_perf: null, ...(over.latest ?? {}) },
  };
}

describe('AdminSitesComponent (sorting + a11y + tiers)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ariaSort reports none for inactive columns and the live direction for the active one', () => {
    const c = make();
    c.sortKey.set('composite');
    c.sortDir.set('desc');
    expect(c.ariaSort('composite')).toBe('descending');
    expect(c.ariaSort('lcp')).toBe('none');
    c.sortDir.set('asc');
    expect(c.ariaSort('composite')).toBe('ascending');
  });

  // Unsorted sortable columns must advertise that they're sortable (a faint ↕),
  // matching content-freshness / api-tokens — NOT render nothing until clicked.
  it('sortIndicator shows a ↕ affordance on unsorted columns and the live arrow on the active one', () => {
    const c = make();
    c.sortKey.set('composite');
    c.sortDir.set('desc');
    expect(c.sortIndicator('composite')).withContext('active column → direction arrow').toBe('↓');
    expect(c.sortIndicator('lcp')).withContext('unsorted → sortable affordance, not empty').toBe('↕');
    expect(c.sortIndicator('name')).toBe('↕');
    c.sortDir.set('asc');
    expect(c.sortIndicator('composite')).toBe('↑');
  });

  it('sortBy toggles direction on the same key and resets triage', () => {
    const c = make();
    c.triage.set(true);
    c.sortKey.set('composite');
    c.sortDir.set('desc');
    c.sortBy('composite');
    expect(c.sortDir()).toBe('asc');
    expect(c.triage()).toBe(false);
  });

  it('sortBy on a new key picks a sensible default direction (name asc, metrics desc)', () => {
    const c = make();
    c.sortBy('name');
    expect(c.sortKey()).toBe('name');
    expect(c.sortDir()).toBe('asc');
    c.sortBy('lcp');
    expect(c.sortKey()).toBe('lcp');
    expect(c.sortDir()).toBe('desc');
  });

  it('sortedRows orders by composite score descending by default', () => {
    const c = make();
    c.rows.set([
      row({ site_id: 'a', composite_score: 40 }),
      row({ site_id: 'b', composite_score: 95 }),
      row({ site_id: 'c', composite_score: 70 }),
    ] as never);
    c.sortKey.set('composite');
    c.sortDir.set('desc');
    expect(c.sortedRows().map((r) => r.site_id)).toEqual(['b', 'c', 'a']);
  });

  // A wall of "—" cells (sites exist but none have reported Web Vitals yet)
  // reads as broken/loading without a hint. allVitalsEmpty drives a contextual
  // banner explaining the data fills in after sites get traffic.
  it('allVitalsEmpty is true only when sites exist AND every metric is null', () => {
    const c = make();
    expect(c.allVitalsEmpty()).withContext('no rows → not the empty-data state').toBe(false);
    c.rows.set([row({ site_id: 'a' }), row({ site_id: 'b' })] as never);
    expect(c.allVitalsEmpty()).withContext('sites present, all metrics null → true').toBe(true);
    c.rows.set([row({ site_id: 'a' }), row({ site_id: 'b', composite_score: 88 })] as never);
    expect(c.allVitalsEmpty()).withContext('one site has a score → not empty').toBe(false);
    c.rows.set([row({ site_id: 'a', latest: { lcp_ms: 1200 } as never })] as never);
    expect(c.allVitalsEmpty()).withContext('one site has a metric → not empty').toBe(false);
  });

  it('sortedRows orders by name ascending (case-insensitive)', () => {
    const c = make();
    c.rows.set([
      row({ site_id: 'a', business_name: 'Zeta' }),
      row({ site_id: 'b', business_name: 'alpha' }),
    ] as never);
    c.sortKey.set('name');
    c.sortDir.set('asc');
    expect(c.sortedRows().map((r) => r.site_id)).toEqual(['b', 'a']);
  });

  it('maps Core Web Vitals to the right heatmap tiers', () => {
    const c = make();
    expect(c.tierForLcp(2000)).toBe('green');
    expect(c.tierForLcp(3000)).toBe('yellow');
    expect(c.tierForLcp(5000)).toBe('red');
    expect(c.tierForCls(0.05)).toBe('green');
    expect(c.tierForInp(150)).toBe('green');
    expect(c.tierForScore(95)).toBe('green');
    expect(c.tierForScore(null)).toBe('neutral');
  });

  it('sortIndicator shows the live arrow on the active column and a ↕ affordance on the rest', () => {
    const c = make();
    c.sortKey.set('lcp');
    c.sortDir.set('asc');
    expect(c.sortIndicator('lcp')).toBe('↑');
    expect(c.sortIndicator('cls')).withContext('inactive columns advertise sortability with ↕').toBe('↕');
  });

  // The Refresh button must give feedback (disable + "Refreshing") while a reload
  // is in flight, not look inert on click — parity with the analytics refresh-btn.
  // Full render here (make() strips the template) so the button actually mounts.
  it('Refresh button disables + shows "Refreshing" while loading (feedback, not inert)', () => {
    TestBed.configureTestingModule({
      imports: [AdminSitesComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [], sites: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    const fx = TestBed.createComponent(AdminSitesComponent);
    fx.detectChanges(); // ngOnInit → reload → of([]) resolves → loading false
    fx.componentInstance.loading.set(true);
    fx.detectChanges();
    const btn = (fx.nativeElement as HTMLElement).querySelector('button[aria-label="Refresh sites"]') as HTMLButtonElement | null;
    expect(btn).withContext('Refresh button rendered').not.toBeNull();
    expect(btn!.disabled).withContext('disabled while loading').toBeTrue();
    expect(btn!.getAttribute('aria-busy')).toBe('true');
    expect(btn!.textContent).toContain('Refreshing');
    fx.componentInstance.loading.set(false);
    fx.detectChanges();
    expect(btn!.disabled).withContext('re-enabled when idle').toBeFalse();
    expect(btn!.textContent).toContain('Refresh');
  });

  // The name + slug cells truncate at max-w-[260px]; without a title a long
  // business name / slug is unreadable when ellipsized. Each carries its full
  // value as a hover title.
  it('truncated site name + slug links carry a full-value title (readable on hover)', () => {
    TestBed.configureTestingModule({
      imports: [AdminSitesComponent],
      providers: [
        provideRouter([]), // rendered rows use routerLink → needs ActivatedRoute
        { provide: ApiService, useValue: { get: () => of({ data: [], sites: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
      ],
    });
    const fx = TestBed.createComponent(AdminSitesComponent);
    fx.detectChanges();
    // Inline row (the row() helper omits `daily`, which cellHtml maps over during render).
    fx.componentInstance.rows.set([
      {
        site_id: 's1',
        slug: 'acme-bakery-of-greater-newark',
        business_name: 'Acme Bakery of Greater Newark and Surrounding Areas LLC',
        composite_score: 88,
        daily: [],
        latest: { lcp_ms: null, cls: null, inp_ms: null, lh_perf: null, captured_at: null },
      },
    ] as never);
    fx.componentInstance.loading.set(false); // the async reload leaves loading true → force the loaded table to render
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;
    expect(host.querySelector('a[title="Acme Bakery of Greater Newark and Surrounding Areas LLC"]'))
      .withContext('name link carries the full name as a title').toBeTruthy();
    expect(host.querySelector('a[title="acme-bakery-of-greater-newark.projectsites.dev"]'))
      .withContext('slug link carries the full host as a title').toBeTruthy();
  });
});

/**
 * Free-text filter: a multi-site account needs to narrow the Web-Vitals table
 * by name/slug, not just sort it. The filter composes with the active sort and
 * is case-insensitive over business_name OR slug; a whitespace-only query is a
 * no-op (shows everything), and an excluding query drives a "no matches" notice
 * instead of rendering a blank table body.
 */
describe('AdminSitesComponent (text filter)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function seed(c: AdminSitesComponent): void {
    c.rows.set([
      row({ site_id: 'a', business_name: 'Acme Bakery', slug: 'acme-bakery', composite_score: 90 }),
      row({ site_id: 'b', business_name: "Vito's Salon", slug: 'vitos-salon', composite_score: 70 }),
      row({ site_id: 'c', business_name: 'Newark Soup Kitchen', slug: 'njsk', composite_score: 80 }),
    ] as never);
    c.sortKey.set('composite');
    c.sortDir.set('desc');
  }

  it('an empty filter shows every row (default)', () => {
    const c = make();
    seed(c);
    expect(c.filterText()).toBe('');
    expect(c.sortedRows().map((r) => r.site_id)).toEqual(['a', 'c', 'b']);
  });

  it('filters by business_name substring (case-insensitive) and keeps the sort', () => {
    const c = make();
    seed(c);
    c.filterText.set('ACME');
    expect(c.sortedRows().map((r) => r.site_id)).toEqual(['a']);
  });

  it('filters by slug substring when the name does not match', () => {
    const c = make();
    seed(c);
    c.filterText.set('njsk');
    expect(c.sortedRows().map((r) => r.site_id)).toEqual(['c']);
  });

  it('treats a whitespace-only query as no filter (shows everything)', () => {
    const c = make();
    seed(c);
    c.filterText.set('   ');
    expect(c.sortedRows().length).toBe(3);
    expect(c.filterNoMatch()).toBeFalse();
  });

  it('filterNoMatch is true only when a real query excludes every row', () => {
    const c = make();
    seed(c);
    expect(c.filterNoMatch()).withContext('no query → not a no-match state').toBeFalse();
    c.filterText.set('acme');
    expect(c.filterNoMatch()).withContext('a matching query → not a no-match state').toBeFalse();
    c.filterText.set('zzz-no-such-site');
    expect(c.filterNoMatch()).withContext('an excluding query → no-match notice').toBeTrue();
  });

  it('clearFilter() resets the query', () => {
    const c = make();
    seed(c);
    c.filterText.set('acme');
    c.clearFilter();
    expect(c.filterText()).toBe('');
    expect(c.sortedRows().length).toBe(3);
  });
});

/**
 * Live freshness pill: the heatmap polls live, so a "Synced HH:MM:SS" indicator
 * gives the user a trust/freshness signal. It must reflect a REAL successful
 * load (never show a synced time when the load failed → no false freshness).
 */
describe('AdminSitesComponent (live freshness pill)', () => {
  function makeWith(get: jasmine.Spy): AdminSitesComponent {
    TestBed.configureTestingModule({
      imports: [AdminSitesComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    TestBed.overrideComponent(AdminSitesComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminSitesComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('starts with no synced time before the first load', () => {
    const c = make();
    expect(c.syncedAt()).toBeNull();
  });

  it('stamps syncedAt after a successful heatmap load (feeds <app-synced-pill>)', async () => {
    const c = makeWith(jasmine.createSpy('get').and.returnValue(of({ data: [], sites: [] })));
    await c.reload();
    expect(c.syncedAt()).withContext('a successful load records the sync time').not.toBeNull();
  });

  it('does NOT stamp a synced time when the sparklines load fails (no false freshness)', async () => {
    const c = makeWith(jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))));
    await c.reload();
    expect(c.syncedAt()).withContext('a failed load must not look freshly synced').toBeNull();
  });

  it('reads both heatmap gets with {silent:true} — the inline error card (not a toast) is the failure UX', async () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ data: [], sites: [] }));
    const c = makeWith(get);
    await c.reload();
    // both silenced so ApiService's generic toast never fires over (or instead of)
    // the inline error card — no double/triple feedback on a heatmap failure.
    expect(get).toHaveBeenCalledWith('/sites', undefined, { silent: true });
    expect(get).toHaveBeenCalledWith('/sites/sparklines', { days: '30' }, { silent: true });
  });

  it('a hard load failure (no fallback list) sets the inline error() card', async () => {
    const c = makeWith(jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))));
    await c.reload();
    expect(c.error()).toContain('Could not load sites');
  });
});

/**
 * Stale-route / shapeless-200 hardening on the CORE Sites list (the worst section
 * to silently fake-empty). If /sites or /sites/sparklines ever goes stale — or an
 * SPA-fallthrough returns a parseable-but-shapeless 200 — a bare `?? []` would
 * either fake-empty "No sites yet" over an org that owns sites OR feed a non-array
 * into the @for / sortedRows() spread and crash. The success paths shape-guard both
 * responses with Array.isArray so a stale route degrades honestly, never fake-empty,
 * never throws.
 */
describe('AdminSitesComponent (stale-route / shapeless-200 hardening)', () => {
  function makeWith(get: jasmine.Spy): AdminSitesComponent {
    TestBed.configureTestingModule({
      imports: [AdminSitesComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    TestBed.overrideComponent(AdminSitesComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminSitesComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  // A shapeless sparklines 200 ({} — no data[]) must NOT crash sortedRows() and
  // must NOT fake-empty a row set. With no fallback list either, it surfaces the
  // honest inline error card (routes through the same catch as a thrown 5xx).
  it('a shapeless sparklines 200 (no data array) degrades to the inline error, never a fake-empty crash', async () => {
    const c = makeWith(jasmine.createSpy('get').and.returnValue(of({})));
    await expectAsync(c.reload()).toBeResolved(); // never throws
    expect(c.rows().length).withContext('no rows fabricated from a shapeless body').toBe(0);
    expect(() => c.sortedRows()).withContext('sortedRows must not crash on the guarded empty set').not.toThrow();
    expect(c.error()).withContext('honest error, not a silent fake-empty').toContain('Could not load sites');
    expect(c.syncedAt()).withContext('a shapeless body is not a successful sync').toBeNull();
  });

  // A non-array `data` (e.g. data:"oops") is the crash vector `?? []` can't catch —
  // it would reach the spread/filter in sortedRows(). The guard treats it as an error.
  it('a non-array sparklines `data` is treated as an error (never reaches the @for spread)', async () => {
    const c = makeWith(jasmine.createSpy('get').and.returnValue(of({ data: 'oops' as never })));
    await c.reload();
    expect(Array.isArray(c.rows())).withContext('rows stays an array').toBeTrue();
    expect(c.rows().length).toBe(0);
    expect(() => c.sortedRows()).not.toThrow();
    expect(c.error()).toContain('Could not load sites');
  });

  // The fallback /sites list is THE core sites list. A shapeless 200 there must
  // stay an empty array (the heatmap empty/error UX covers it) — never a non-array
  // (which would crash the fallback @for / .length), never a fabricated set.
  it('a shapeless /sites fallback body keeps fallbackSites an empty array (no non-array, no fake-set)', async () => {
    // /sites returns shapeless {}; /sites/sparklines returns a clean empty set.
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      path === '/sites' ? of({}) : of({ data: [] }),
    );
    const c = makeWith(get);
    await c.reload();
    expect(Array.isArray(c.fallbackSites())).withContext('fallbackSites is always an array').toBeTrue();
    expect(c.fallbackSites().length).withContext('a shapeless body yields no fallback sites').toBe(0);
  });

  it('a non-array /sites `sites` field never reaches the fallback list (stays empty array)', async () => {
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      path === '/sites' ? of({ sites: 'not-an-array' as never }) : of({ data: [] }),
    );
    const c = makeWith(get);
    await c.reload();
    expect(Array.isArray(c.fallbackSites())).toBeTrue();
    expect(c.fallbackSites().length).toBe(0);
  });

  // The happy path must stay intact: a well-shaped /sites list still populates the
  // fallback set (the guard only rejects shapeless/non-array bodies, not real data).
  it('a well-shaped /sites body still populates the fallback list (happy path intact)', async () => {
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      path === '/sites'
        ? of({ sites: [{ id: 's1', slug: 'acme', name: 'Acme' }] })
        : of({ data: [] }),
    );
    const c = makeWith(get);
    await c.reload();
    expect(c.fallbackSites().map((s) => s.id)).toEqual(['s1']);
  });
});

/**
 * Keyboard focus visibility (WCAG 2.4.7 / 2.4.11): every interactive element in
 * the table — the site-name routerLink and the live-site host link — must show a
 * cyan focus-visible ring when tabbed to, parity with the sortable headers, the
 * filter input, and the Refresh button.
 */
describe('AdminSitesComponent (row-link focus ring)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the site-name + host row links carry a focus-visible cyan ring', () => {
    TestBed.configureTestingModule({
      imports: [AdminSitesComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [], sites: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, show: () => 0 } },
      ],
    });
    const fx = TestBed.createComponent(AdminSitesComponent);
    fx.detectChanges();
    fx.componentInstance.rows.set([
      {
        site_id: 's1',
        slug: 'acme',
        business_name: 'Acme',
        composite_score: 88,
        daily: [],
        latest: { lcp_ms: null, cls: null, inp_ms: null, lh_perf: null, captured_at: null },
      },
    ] as never);
    fx.componentInstance.loading.set(false);
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;
    const links = Array.from(host.querySelectorAll('tbody a')) as HTMLAnchorElement[];
    expect(links.length).withContext('both row links rendered').toBeGreaterThanOrEqual(2);
    for (const a of links) {
      expect(a.className)
        .withContext('every row link has the cyan focus-visible ring')
        .toContain('focus-visible:outline-[var(--ps-accent)]');
    }
  });
});
