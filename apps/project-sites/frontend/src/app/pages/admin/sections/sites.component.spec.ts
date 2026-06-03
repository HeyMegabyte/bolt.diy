import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
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

  it('sortIndicator shows a glyph only for the active column', () => {
    const c = make();
    c.sortKey.set('lcp');
    c.sortDir.set('asc');
    expect(c.sortIndicator('lcp')).toBe('↑');
    expect(c.sortIndicator('cls')).toBe('');
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
});
