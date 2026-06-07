import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminLogsExplorerComponent } from './logs-explorer.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { provideRouter } from '@angular/router';

/**
 * Guards the Log Explorer search-state logic: a fetch error sets a PERSISTENT
 * in-panel error (so it never masquerades as the "No logs found" empty state),
 * a 404 surfaces the flag-disabled banner (no error), and success clears the
 * error. overrideComponent strips the heavy template (render-free, robust).
 */
function make(post: jasmine.Spy): { c: AdminLogsExplorerComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [AdminLogsExplorerComponent],
    providers: [
      { provide: ApiService, useValue: { post, get: () => of({ data: { routes: [], grand_total: 0 } }) } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
      { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
    ],
  });
  TestBed.overrideComponent(AdminLogsExplorerComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminLogsExplorerComponent).componentInstance, toastErr };
}

describe('AdminLogsExplorerComponent (search state)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates rows and clears searching/error', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { items: [{ id: 'l1' }], next_cursor: null, total_returned: 1 } }));
    const { c } = make(post);
    c.search();
    expect(c.searching()).toBe(false);
    expect(c.searched()).toBe(true);
    expect(c.searchError()).toBeNull();
    expect(c.rows().length).toBe(1);
  });

  it('a non-404 error sets a persistent searchError (not a silent empty) + toasts', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = make(post);
    c.search();
    expect(c.searching()).toBe(false);
    expect(c.searchError()).toContain("Couldn't load logs");
    expect(c.featureDisabled()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  it('a 404 surfaces the flag-disabled banner without an error message or toast', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 404 })));
    const { c, toastErr } = make(post);
    c.search();
    expect(c.featureDisabled()).toBe(true);
    expect(c.searchError()).toBeNull();
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('re-searching after an error clears the prior error', () => {
    const post = jasmine.createSpy('post').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ data: { items: [], next_cursor: null, total_returned: 0 } }),
    );
    const { c } = make(post);
    c.search(); // fails
    expect(c.searchError()).not.toBeNull();
    c.search(); // succeeds
    expect(c.searchError()).toBeNull();
  });

  // STALE-ROUTE RESILIENCE (the real gap): a worker route that predates
  // /api/logs/search falls through to the SPA — the request 200s with HTML, so
  // res.data is undefined. Without a shape guard, `this.rows.set(res.data.items)`
  // throws (or sets rows() = undefined, which then crashes the template's
  // `rows().length`). A 200-with-HTML never hits the error branch, so all the
  // existing 4xx/5xx resilience is bypassed. Mirror site-features.component.ts:
  // guard the shape → honest retryable error, never a crash or fake-empty.
  it('a 200 with a non-array body (stale SPA-HTML route) sets a retryable error, never crashes', () => {
    const post = jasmine.createSpy('post').and.returnValue(of('<!doctype html><html>…</html>' as unknown));
    const { c } = make(post);
    expect(() => c.search()).not.toThrow();
    expect(Array.isArray(c.rows())).withContext('rows() must stay an array').toBe(true);
    expect(c.rows().length).toBe(0);
    expect(c.searchError()).withContext('honest error, not a fake-empty').not.toBeNull();
    expect(c.featureDisabled()).toBe(false);
    expect(c.searching()).toBe(false);
  });

  it('a 200 whose data lacks an items array (shapeless body) is treated as an error, not 0 results', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { next_cursor: null } } as unknown));
    const { c } = make(post);
    expect(() => c.search()).not.toThrow();
    expect(Array.isArray(c.rows())).toBe(true);
    expect(c.searchError()).not.toBeNull();
  });

  it('loadMore() with a non-array body keeps prior rows and toasts (no undefined spread crash)', () => {
    const post = jasmine.createSpy('post').and.returnValues(
      of({ data: { items: [{ id: 'l1' }], next_cursor: 'cur', total_returned: 1 } }),
      of('<!doctype html>' as unknown),
    );
    const { c, toastErr } = make(post);
    c.search();
    expect(c.rows().length).toBe(1);
    c.loadMore();
    expect(c.rows().length).withContext('prior rows preserved').toBe(1);
    expect(toastErr).toHaveBeenCalled();
    expect(c.searching()).toBe(false);
  });

  // ngOnInit auto-runs search() on every visit; the component owns its OWN error
  // UX (404 → silent flag-disabled banner; non-404 → inline searchError + its own
  // toast). So the read must be {silent:true} — otherwise ApiService's generic
  // "Can't reach the server / not found" toast double-fires over that on the
  // flag-off auto-load (the analytics redundant-network-toast sibling class).
  it('search() calls the API silently (component owns the error UX — no generic toast)', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { items: [], next_cursor: null, total_returned: 0 } }));
    const { c } = make(post);
    c.search();
    expect(post).toHaveBeenCalledWith('/logs/search', jasmine.any(Object), { silent: true });
  });

  // The filtered-empty state must not be a dead-end: when a query/level filter
  // narrows results to zero, offer a one-click "Clear filters" escape. When no
  // filter is active (empty is purely the time range), DON'T mislabel it as a
  // filter problem — hasActiveFilters drives that branch.
  it('hasActiveFilters tracks query/level filter state for the empty-state CTA', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { items: [], next_cursor: null, total_returned: 0 } }));
    const { c } = make(post);
    expect(c.hasActiveFilters()).toBe(false); // default range, no query/level
    c.queryInput = 'level:error';
    expect(c.hasActiveFilters()).toBe(true); // query narrows results
    c.queryInput = '   ';
    c.activeLevel.set('warn');
    expect(c.hasActiveFilters()).toBe(true); // level chip narrows results
  });

  it('clearSearch resets query + level so the filtered-empty CTA can broaden results', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { items: [], next_cursor: null, total_returned: 0 } }));
    const { c } = make(post);
    c.queryInput = 'level:error AND route:/api/*';
    c.activeLevel.set('error');
    c.clearSearch();
    expect(c.queryInput).toBe('');
    expect(c.activeLevel()).toBeNull();
    expect(c.hasActiveFilters()).toBe(false);
  });
});

describe('AdminLogsExplorerComponent (cost load)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeCost(get: jasmine.Spy): { c: AdminLogsExplorerComponent; toastErr: jasmine.Spy } {
    const toastErr = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminLogsExplorerComponent],
      providers: [
        { provide: ApiService, useValue: { post: () => of({ data: { items: [], next_cursor: null, total_returned: 0 } }), get } },
        { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
      ],
    });
    TestBed.overrideComponent(AdminLogsExplorerComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminLogsExplorerComponent).componentInstance, toastErr };
  }

  it('loadCosts() calls the API silently (component owns the error UX)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ data: { rows: [], grand_total_cost: 0 } }));
    const { c } = makeCost(get);
    c.loadCosts();
    expect(get).toHaveBeenCalledWith(jasmine.stringMatching('/logs/cost-by-route'), undefined, { silent: true });
  });

  it('a 404 cost load surfaces the flag-disabled banner without a toast', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 })));
    const { c, toastErr } = makeCost(get);
    c.loadCosts();
    expect(c.featureDisabled()).toBe(true);
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('a non-404 cost load failure toasts an accurate message (no silent failure now that the read is silent)', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = makeCost(get);
    c.loadCosts();
    expect(c.featureDisabled()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  // STALE-ROUTE RESILIENCE: a 200-with-HTML cost response (route predates the
  // endpoint) has no rows array. Without a guard, costRows() = undefined crashes
  // the template's `costRows().slice(0, 15)` and `grandTotal()` renders NaN.
  it('a 200 with a non-array cost body keeps costRows an empty array + toasts (no template crash)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of('<!doctype html>' as unknown));
    const { c, toastErr } = makeCost(get);
    expect(() => c.loadCosts()).not.toThrow();
    expect(Array.isArray(c.costRows())).withContext('costRows() must stay an array').toBe(true);
    expect(c.costRows().length).toBe(0);
    expect(c.grandTotal()).withContext('no NaN total from a shapeless body').toBe(0);
    expect(toastErr).toHaveBeenCalled();
    expect(c.costLoading()).toBe(false);
  });
});

describe('AdminLogsExplorerComponent — range pills hidden when flag-gated (real template)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render() {
    TestBed.configureTestingModule({
      imports: [AdminLogsExplorerComponent],
      providers: [
        { provide: ApiService, useValue: { post: () => of({ data: { items: [], next_cursor: null, total_returned: 0 } }), get: () => of({ data: { rows: [], grand_total_cost: 0 } }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminLogsExplorerComponent);
    fx.detectChanges();
    return fx;
  }

  // When log_explorer is off, the range pills filter a search that can't run —
  // dead controls over the gate notice. They must be hidden.
  it('hides the range pills when the feature is flag-gated off; shows them when enabled', () => {
    const fx = render();
    fx.componentInstance.featureDisabled.set(true);
    fx.detectChanges();
    expect((fx.nativeElement as HTMLElement).querySelectorAll('.range-pill').length)
      .withContext('no dead range pills over the gate notice').toBe(0);

    fx.componentInstance.featureDisabled.set(false);
    fx.detectChanges();
    expect((fx.nativeElement as HTMLElement).querySelectorAll('.range-pill').length)
      .withContext('range pills return when the feature is enabled').toBeGreaterThan(0);
  });
});
