import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminContentFreshnessComponent } from './content-freshness.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Convergence r14 — locks the cyan/black aggregate stat strip added to the
 * Content Freshness section: the strip surfaces server total + page-mean idle
 * + page-mean dwell as rolling counters, and renders ONLY when drafts exist.
 * Also guards the token-driven approve affordance (no hard-coded hex leaked
 * back in) and the new psReveal/status-region a11y hooks.
 */
describe('AdminContentFreshnessComponent (aggregate stat strip + cohesion)', () => {
  let fixture: ComponentFixture<AdminContentFreshnessComponent>;
  let component: AdminContentFreshnessComponent;
  let getSpy: jasmine.Spy;

  const DRAFTS = [
    { id: 'a', site_id: 's', section_key: 'hero', dwell_seconds_avg: 10, idle_days: 100, status: 'pending', ai_model: 'm', created_at: '2026-01-01' },
    { id: 'b', site_id: 's', section_key: 'about', dwell_seconds_avg: 20, idle_days: 200, status: 'pending', ai_model: 'm', created_at: '2026-01-02' },
  ];

  function build(drafts: typeof DRAFTS, total = drafts.length): void {
    getSpy = jasmine.createSpy('get').and.returnValue(of({ drafts, total, page: 1, limit: 25 }));
    TestBed.configureTestingModule({
      imports: [AdminContentFreshnessComponent],
      providers: [
        { provide: ApiService, useValue: { get: getSpy, post: jasmine.createSpy('post').and.returnValue(of({})) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), info: jasmine.createSpy('info') } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 's' }) } },
      ],
    });
    fixture = TestBed.createComponent(AdminContentFreshnessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('computes the rounded page-mean idle days', fakeAsync(() => {
    build(DRAFTS);
    tick();
    expect(component.statAvgIdle()).toBe(150); // (100 + 200) / 2
  }));

  it('computes the rounded page-mean dwell seconds', fakeAsync(() => {
    build(DRAFTS);
    tick();
    expect(component.statAvgDwell()).toBe(15); // (10 + 20) / 2
  }));

  it('mirrors the server total in statTotal', fakeAsync(() => {
    build(DRAFTS, 47);
    tick();
    expect(component.statTotal()).toBe(47);
  }));

  it('returns 0 means with an empty page (no divide-by-zero)', fakeAsync(() => {
    build([], 0);
    tick();
    expect(component.statAvgIdle()).toBe(0);
    expect(component.statAvgDwell()).toBe(0);
  }));

  it('renders the aria-live stat strip when drafts exist, hides it when empty', fakeAsync(() => {
    build(DRAFTS);
    tick();
    fixture.detectChanges();
    const strip = (fixture.nativeElement as HTMLElement).querySelector('.cf-stats');
    expect(strip).withContext('stat strip renders with drafts').not.toBeNull();
    expect(strip?.getAttribute('role')).toBe('status');
    expect(strip?.getAttribute('aria-live')).toBe('polite');

    component.drafts.set([]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.cf-stats'))
      .withContext('stat strip hidden when no drafts').toBeNull();
  }));

  it('hides the aria-live stat strip during a reload so no stale count is announced', fakeAsync(() => {
    build(DRAFTS); // page 1 lands: 2 drafts, total 2
    tick();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.cf-stats'))
      .withContext('strip visible once a page has loaded').not.toBeNull();

    // Simulate a filter-change reload in flight: loading flips true while the
    // PREVIOUS page's drafts/total are still in the signal. The aria-live strip
    // must NOT keep announcing the stale count.
    component.loading.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.cf-stats'))
      .withContext('stat strip suppressed mid-reload (no stale announce)').toBeNull();
  }));

  it('hides the pending awaiting-approval badge during a reload', fakeAsync(() => {
    build(DRAFTS, 2); // pending filter is the default → pending() === total === 2
    tick();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.cf-badge'))
      .withContext('awaiting-approval badge visible once loaded').not.toBeNull();

    component.loading.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.cf-badge'))
      .withContext('awaiting-approval badge suppressed mid-reload').toBeNull();
  }));

  it('uses the --ps-success token (not a hard-coded hex) for the approve action', fakeAsync(() => {
    build(DRAFTS);
    tick();
    fixture.detectChanges();
    const approve = (fixture.nativeElement as HTMLElement).querySelector('.cf-approve');
    expect(approve).withContext('approve button uses the token class').not.toBeNull();
    // Component template must not reference the raw hex anymore.
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html.includes('#4dffb5')).withContext('no inline hex in rendered DOM').toBe(false);
  }));

  // TanStack sort coverage (previously untested) — same createAngularTable
  // pattern as api-tokens + the one the ag-grid→TanStack perf wave replicates.
  it('ariaSort + sortGlyph map the TanStack direction exactly', fakeAsync(() => {
    build(DRAFTS);
    tick();
    expect(component.ariaSort('asc')).toBe('ascending');
    expect(component.ariaSort('desc')).toBe('descending');
    expect(component.ariaSort(false)).toBe('none');
    expect(component.sortGlyph('asc')).toBe('↑');
    expect(component.sortGlyph('desc')).toBe('↓');
    expect(component.sortGlyph(false)).toBe('↕');
  }));

  it('the table re-sorts numerically by idle_days when the sorting state flips', fakeAsync(() => {
    build(DRAFTS); // a: idle_days 100, b: idle_days 200
    tick();
    const sorting = (component as unknown as { sorting: { set(v: { id: string; desc: boolean }[]): void } }).sorting;
    sorting.set([{ id: 'idle_days', desc: false }]);
    expect(component.table.getRowModel().rows.map((r) => (r.original as { idle_days: number }).idle_days)).toEqual([100, 200]);
    sorting.set([{ id: 'idle_days', desc: true }]);
    expect(component.table.getRowModel().rows.map((r) => (r.original as { idle_days: number }).idle_days)).toEqual([200, 100]);
  }));
});

/**
 * Double-toast guard: approve/reject/triggerScan use firstValueFrom(api.post) +
 * a catch that shows their OWN toast.error, so each post must pass {silent:true}
 * (else the generic ApiService toast double-fires on failure).
 */
describe('AdminContentFreshnessComponent (mutations are {silent})', () => {
  let post: jasmine.Spy;
  function make(): AdminContentFreshnessComponent {
    post = jasmine.createSpy('post').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AdminContentFreshnessComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ drafts: [], total: 0 }), post } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 's' }) } },
      ],
    });
    return TestBed.createComponent(AdminContentFreshnessComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('approve() POSTs {silent:true}', async () => {
    const c = make();
    await c.approve('d1');
    expect(post.calls.mostRecent().args[0]).toBe('/content/freshness/approve/d1');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('reject() + triggerScan() POST {silent:true}', async () => {
    const c = make();
    await c.reject('d1');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
    await c.triggerScan();
    expect(post.calls.mostRecent().args[0]).toBe('/content/freshness/trigger');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });
});
