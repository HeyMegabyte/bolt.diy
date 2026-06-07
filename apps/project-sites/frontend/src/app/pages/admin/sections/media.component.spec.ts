import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminMediaComponent } from './media.component';
import { ApiService } from '../../../services/api.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the Media section cyan/black cohesion + a11y convergence pass (round 4):
 *  - the asset-count stat renders through `<app-rolling-counter>` (brand mandate)
 *  - the shell carries the `appReveal` entrance host
 *  - the tablist / tabpanel ARIA contract + the sliding cyan indicator hold
 *  - the active tab text rides on the cyan indicator (ink flips to canvas color)
 *
 * `ng test` (Karma) is not runnable in this isolated worktree harness; this spec
 * is also AOT-verified via `npx nx build`. It mocks ApiService so `ngOnInit`'s
 * `refreshLibrary()` resolves synchronously with an empty library.
 */
describe('AdminMediaComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminMediaComponent>;

  function build(): void {
    const apiStub = {
      get: () => of({ data: [] }),
      post: () => of({ ok: true }),
      postFormData: () => of({ data: null }),
      delete: () => of({ ok: true }),
    };
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: apiStub },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        {
          provide: ToastService,
          useValue: {
            info: () => 0,
            success: () => 0,
            warning: () => 0,
            error: () => 0,
            dismiss: () => undefined,
          },
        },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    fixture = TestBed.createComponent(AdminMediaComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    // The tab tests persist activeTab to localStorage; clear it so the default-tab
    // assertion is order-independent (Karma runs in random order).
    try { localStorage.clear(); } catch { /* private mode */ }
    TestBed.resetTestingModule();
  });

  it('renders the asset count through <app-rolling-counter> (numeric stat mandate)', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const chip = el.querySelector('.count-chip');
    expect(chip).toBeTruthy();
    // The numeric stat is NOT a raw text node — it is an <app-rolling-counter>.
    expect(chip!.querySelector('app-rolling-counter')).toBeTruthy();
    expect(chip!.getAttribute('role')).toBe('status');
  });

  it('does NOT announce a premature "0 assets" while the library is still loading', () => {
    build();
    // Initial library load in-flight: loadingLibrary true + no assets yet.
    fixture.componentInstance.loadingLibrary.set(true);
    fixture.componentInstance.assets.set([]);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.count-chip')!;
    // No definitive count (rolling-counter) over a loading library...
    expect(chip.querySelector('app-rolling-counter')).withContext('no "0 assets" count while loading').toBeNull();
    // ...and role=status must NOT announce a false "0 assets in library".
    expect(chip.getAttribute('aria-label')).withContext('honest SR announcement while loading').not.toContain('0 assets');
  });

  it('does NOT announce a false "0 assets" when the library load errors (count is unknown)', () => {
    build();
    fixture.componentInstance.loadingLibrary.set(false);
    fixture.componentInstance.libraryError.set('Server error');
    fixture.componentInstance.assets.set([]);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.count-chip')!;
    expect(chip.querySelector('app-rolling-counter')).withContext('no "0 assets" count over the load error').toBeNull();
    expect(chip.getAttribute('aria-label')).withContext('honest SR announcement on error').not.toContain('0 assets');
    expect(chip.textContent ?? '').withContext('shows the unknown dash').toContain('—');
  });

  it('applies the appReveal entrance host on the section shell', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('section[appReveal]')).toBeTruthy();
  });

  it('exposes the WAI-ARIA tablist contract with a sliding cyan indicator', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const tablist = el.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBe('Media sub-sections');
    // The sliding cyan active-tab indicator is present + driven by index props.
    const indicator = tablist!.querySelector('.med-tab-indicator');
    expect(indicator).toBeTruthy();
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(5);
    const selected = Array.from(tabs).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    // Every tab points at its panel; the active panel is rendered + labelled.
    expect(selected[0].getAttribute('aria-controls')).toBe('med-panel-library');
    const panel = el.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-labelledby')).toBe('med-tab-library');
  });

  it('drives the indicator transform off the active tab index', () => {
    build();
    const cmp = fixture.componentInstance;
    expect(cmp.activeTabIndex()).toBe(0);
    cmp.setTab('video');
    fixture.detectChanges();
    // tabs = [library, stock, image, video, podcast] → video is index 3.
    expect(cmp.activeTabIndex()).toBe(3);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#med-panel-video')).toBeTruthy();
  });

  it('marks exactly the active tab .is-active (text flips to canvas ink on cyan)', () => {
    build();
    fixture.componentInstance.setTab('stock');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const active = el.querySelectorAll('[role="tab"].is-active');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('med-tab-stock');
  });
});

/**
 * Guards the media-library load-error gating: a failed `/media/assets` fetch used
 * to be fully silent (error: () => loadingLibrary.set(false)) → the empty grid fell
 * through to the "No media yet" empty state, risking a re-upload of assets that are
 * safe. Now refreshLibrary() sets a persistent libraryError + Retry card; the empty
 * state is suppressed while the error stands. overrideComponent strips the template
 * so lifecycle hooks don't auto-fire; refreshLibrary() is driven directly.
 */
describe('AdminMediaComponent (library load-error gating)', () => {
  function makeErroring(get: jasmine.Spy): AdminMediaComponent {
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
      ],
    });
    TestBed.overrideComponent(AdminMediaComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminMediaComponent).componentInstance;
  }

  afterEach(() => {
    // The tab tests persist activeTab to localStorage; clear it so the default-tab
    // assertion is order-independent (Karma runs in random order).
    try { localStorage.clear(); } catch { /* private mode */ }
    TestBed.resetTestingModule();
  });

  it('success populates assets and leaves libraryError null', () => {
    const c = makeErroring(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'a1', status: 'ready' }] })));
    c.refreshLibrary();
    expect(c.libraryError()).toBeNull();
    expect(c.assets().length).toBe(1);
    expect(c.loadingLibrary()).toBe(false);
  });

  it('a load error sets a persistent libraryError (not a fake "No media yet")', () => {
    const c = makeErroring(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refreshLibrary();
    expect(c.libraryError()).toContain('Could not load');
    expect(c.assets().length).toBe(0);
    expect(c.loadingLibrary()).toBe(false);
  });

  it('retry after an error clears the prior libraryError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = makeErroring(get);
    c.refreshLibrary();
    expect(c.libraryError()).not.toBeNull();
    c.refreshLibrary();
    expect(c.libraryError()).toBeNull();
  });
});

/**
 * Stock-search state machine: the empty area must distinguish (1) the initial
 * "haven't searched" prompt, (2) a genuine "no matches" result, and (3) a
 * FAILED search — which previously fell through to the misleading "No results
 * yet" state AND failed silently. Locks: searched-flag, error surfacing + toast
 * (no silent failure / fake-empty masquerade), and the rendered empty-state
 * branch for each case.
 */
describe('AdminMediaComponent (stock search states)', () => {
  function makeStock(post: jasmine.Spy): { c: AdminMediaComponent; toastErr: jasmine.Spy } {
    TestBed.resetTestingModule();
    const toastErr = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, postFormData: () => of({ data: null }), delete: () => of({ ok: true }) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: jasmine.createSpy('warning'), error: toastErr, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    TestBed.overrideComponent(AdminMediaComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminMediaComponent).componentInstance;
    return { c, toastErr };
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('starts un-searched (initial empty state, not "no matches")', () => {
    const { c } = makeStock(jasmine.createSpy('post').and.returnValue(of({ data: [] })));
    expect(c.stockSearched()).toBeFalse();
    expect(c.stockError()).toBeNull();
  });

  it('an empty query is a no-op — no request, stays un-searched', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: [] }));
    const { c } = makeStock(post);
    c.stockQuery = '   ';
    c.runStockSearch();
    expect(post).not.toHaveBeenCalled();
    expect(c.stockSearched()).toBeFalse();
  });

  it('a successful search marks searched + clears any error', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: [{ source: 'unsplash', thumb_url: 'x', kind: 'image' }] }));
    const { c } = makeStock(post);
    c.stockQuery = 'mountains';
    c.runStockSearch();
    expect(post).toHaveBeenCalled();
    expect(c.stockSearched()).toBeTrue();
    expect(c.stockError()).toBeNull();
    expect(c.stockResults().length).toBe(1);
    expect(c.stockLastQuery).toBe('mountains');
  });

  it('a FAILED search surfaces an error + toasts + does NOT masquerade as empty results', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = makeStock(post);
    c.stockQuery = 'mountains';
    c.runStockSearch();
    expect(c.stockError()).withContext('error is captured, not swallowed').not.toBeNull();
    expect(c.stockResults().length).toBe(0);
    expect(c.stockSearched()).toBeTrue();
    expect(c.stockLoading()).toBeFalse();
    expect(toastErr).withContext('a failed search must toast, never fail silently').toHaveBeenCalled();
  });

  function renderStock(post: jasmine.Spy): ComponentFixture<AdminMediaComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, postFormData: () => of({ data: null }), delete: () => of({ ok: true }) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    const fx = TestBed.createComponent(AdminMediaComponent);
    fx.componentInstance.setTab('stock');
    fx.detectChanges();
    return fx;
  }

  it('renders the INITIAL empty branch before any search', () => {
    const fx = renderStock(jasmine.createSpy('post').and.returnValue(of({ data: [] })));
    const el: HTMLElement = fx.nativeElement;
    expect(el.querySelector('[data-testid="stock-initial"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="stock-no-matches"]')).toBeNull();
    expect(el.querySelector('[data-testid="stock-error"]')).toBeNull();
  });

  it('renders the NO-MATCHES branch (with the query) after a zero-result search', () => {
    const fx = renderStock(jasmine.createSpy('post').and.returnValue(of({ data: [] })));
    fx.componentInstance.stockQuery = 'zxqwv';
    fx.componentInstance.runStockSearch();
    fx.detectChanges();
    const el: HTMLElement = fx.nativeElement;
    const noMatch = el.querySelector('[data-testid="stock-no-matches"]');
    expect(noMatch).toBeTruthy();
    expect(noMatch!.textContent).toContain('zxqwv');
    expect(el.querySelector('[data-testid="stock-initial"]')).toBeNull();
  });

  it('renders the ERROR branch (with a Retry) after a failed search', () => {
    const fx = renderStock(jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 }))));
    fx.componentInstance.stockQuery = 'mountains';
    fx.componentInstance.runStockSearch();
    fx.detectChanges();
    const el: HTMLElement = fx.nativeElement;
    const errEl = el.querySelector('[data-testid="stock-error"]');
    expect(errEl).toBeTruthy();
    expect(errEl!.querySelector('button')?.textContent).toContain('Retry');
    expect(el.querySelector('[data-testid="stock-no-matches"]')).toBeNull();
    // Cockpit cohesion: the error glyph is an amber-haloed SVG (med-empty--warn), not a bare emoji.
    expect(errEl!.classList.contains('med-empty--warn')).withContext('amber warn variant').toBeTrue();
    expect(errEl!.querySelector('.med-empty__glyph svg')).withContext('SVG glyph, not an emoji char').toBeTruthy();
  });
});

/**
 * Double-toast guard: deleteOne shows its own toast.error in the error callback,
 * and the bulk deleteSelected + upload aggregate per-item failures into one
 * summary toast — so each api call must pass {silent:true} or a failure fires
 * the generic ApiService toast on top (a flood on bulk/multi-file ops).
 */
describe('AdminMediaComponent (mutations are {silent} — no double-toast/flood)', () => {
  let del: jasmine.Spy;
  let postFormData: jasmine.Spy;

  let confirmSpy: jasmine.Spy;
  function build(confirmResult = true): AdminMediaComponent {
    del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    postFormData = jasmine.createSpy('postFormData').and.returnValue(of({ data: null }));
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ ok: true }), postFormData, delete: del } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: confirmSpy } },
      ],
    });
    return TestBed.createComponent(AdminMediaComponent).componentInstance;
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('deleteOne DELETEs {silent:true}', async () => {
    const c = build(true);
    await c.deleteOne({ id: 'a1', name: 'pic.png' } as never);
    expect(del).toHaveBeenCalledWith('/media/assets/a1', { silent: true });
  });

  it('deleteOne confirms with danger:true (irreversible asset delete → red modal)', async () => {
    const c = build(true);
    await c.deleteOne({ id: 'a1', name: 'pic.png' } as never);
    expect(confirmSpy).toHaveBeenCalled();
    expect((confirmSpy.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeTrue();
  });

  it('bulk deleteSelected DELETEs {silent:true} per asset (no toast flood)', async () => {
    const c = build(true);
    c.selectedIds.set(new Set(['a1', 'a2']));
    await c.deleteSelected();
    expect(del.calls.allArgs().every((a) => a[1] && (a[1] as { silent?: boolean }).silent === true)).toBeTrue();
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('selectAll selects every filtered asset; allFilteredSelected reflects it', () => {
    const c = build(true);
    c.assets.set([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] as never);
    expect(c.filteredAssets().length).toBe(3);
    expect(c.allFilteredSelected()).withContext('nothing selected yet').toBeFalse();
    c.selectAll();
    expect(c.selectedIds().size).toBe(3);
    expect([...c.selectedIds()].sort()).toEqual(['a1', 'a2', 'a3']);
    expect(c.allFilteredSelected()).withContext('all now selected → hide the affordance').toBeTrue();
  });

  it('allFilteredSelected is false on an empty library (no no-op select-all)', () => {
    const c = build(true);
    c.assets.set([] as never);
    expect(c.allFilteredSelected()).toBeFalse();
  });
});

describe('AdminMediaComponent (library-cap honesty)', () => {
  function render(n: number): { host: HTMLElement; fx: import('@angular/core/testing').ComponentFixture<AdminMediaComponent> } {
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ ok: true }), postFormData: () => of({ data: null }), delete: () => of({ ok: true }) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    const fx = TestBed.createComponent(AdminMediaComponent);
    fx.detectChanges();
    fx.componentInstance.loadingLibrary.set(false);
    fx.componentInstance.assets.set(Array.from({ length: n }, (_, i) => ({ id: 'a' + i, name: 'x', kind: 'image', source: 'upload' } as never)));
    fx.detectChanges();
    return { host: fx.nativeElement as HTMLElement, fx };
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('shows the "latest 60" note when the library hits the server cap', () => {
    const { host } = render(60);
    expect(host.querySelector('[data-testid="media-cap-note"]')?.textContent).withContext('user must know older assets exist').toContain('latest 60');
  });

  it('does NOT show the cap note below the cap', () => {
    const { host } = render(10);
    expect(host.querySelector('[data-testid="media-cap-note"]')).toBeNull();
  });
});

/**
 * The library empty state mislabelled a FILTERED-to-zero result as an empty
 * library ("No media yet" + Upload), with no escape — even when the user has
 * media that a kind/search filter just hid. Distinguish filter-active from a
 * genuinely empty library + offer a "Clear filters" escape.
 */
describe('AdminMediaComponent (filtered-empty escape)', () => {
  function build(): AdminMediaComponent {
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ ok: true }), postFormData: () => of({ data: null }), delete: () => of({ ok: true }) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    return TestBed.createComponent(AdminMediaComponent).componentInstance;
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('hasLibraryFilters tracks the kind + search filter state', () => {
    const c = build();
    expect(c.hasLibraryFilters()).toBeFalse();
    c.kindFilter.set('image');
    expect(c.hasLibraryFilters()).toBeTrue();
    c.kindFilter.set('all');
    c.searchTerm.set('logo');
    expect(c.hasLibraryFilters()).toBeTrue();
  });

  it('clearLibraryFilters resets kind + search so the library re-broadens', () => {
    const c = build();
    c.kindFilter.set('video');
    c.searchInput.set('promo');
    c.searchTerm.set('promo');
    c.clearLibraryFilters();
    expect(c.kindFilter()).toBe('all');
    expect(c.searchInput()).toBe('');
    expect(c.searchTerm()).toBe('');
    expect(c.hasLibraryFilters()).toBeFalse();
  });

  it('renders a "Clear filters" escape (not "No media yet") when a filter hides all assets', () => {
    const fx = (() => { build(); return TestBed.createComponent(AdminMediaComponent); })();
    fx.detectChanges();
    fx.componentInstance.loadingLibrary.set(false);
    // Has media, but a search term hides all of it → filtered-empty, NOT empty library.
    fx.componentInstance.assets.set([{ id: 'a1', name: 'sunset.png', kind: 'image', source: 'upload' } as never]);
    fx.componentInstance.searchTerm.set('zzz-no-match');
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="media-filtered-empty"]')).withContext('filter-active empty state').not.toBeNull();
    expect(host.querySelector('[data-testid="media-clear-filters"]')).withContext('Clear filters escape').not.toBeNull();
  });
});

/**
 * Empty-state glyph cohesion: the media empty states shipped a bare grey emoji/char
 * glyph (✦ / 🔍 / ⚠ at opacity 0.6) — off-brand vs the cockpit cyan-glyph-halo
 * standard (analytics / audit / traces). The glyph is now a monochrome SVG inside a
 * cyan halo disc (the load-error variant amber). Locks that the "No media yet" empty
 * renders an <svg> glyph (not a raw emoji text node) so the cyan treatment can't
 * silently regress to a grey character.
 */
describe('AdminMediaComponent (empty-state cyan glyph cohesion)', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ ok: true }), postFormData: () => of({ data: null }), delete: () => of({ ok: true }) } },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    const fx = TestBed.createComponent(AdminMediaComponent);
    fx.detectChanges();
    fx.componentInstance.loadingLibrary.set(false);
    fx.componentInstance.assets.set([]);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('renders the "No media yet" empty glyph as a cyan SVG (cockpit cohesion, not a grey emoji)', () => {
    const host = render();
    // The clean empty-library state ("No media yet") is the only .med-empty on screen.
    const noMedia = Array.from(host.querySelectorAll('.med-empty'))
      .find((e) => e.textContent?.includes('No media yet'));
    expect(noMedia).withContext('the empty-library state renders').toBeTruthy();
    const glyph = noMedia!.querySelector('.med-empty__glyph');
    expect(glyph).toBeTruthy();
    // Cockpit standard: a monochrome SVG in a cyan halo disc — NOT a bare emoji char node.
    expect(glyph!.querySelector('svg')).withContext('cyan-glyph SVG, not a grey emoji char').toBeTruthy();
  });
});

/**
 * Deep-linkable studio tabs — `?tab=video` opens that studio (bookmarkable/shareable),
 * URL wins over the localStorage-remembered tab on load, and clicking a tab reflects
 * in the URL (replaceUrl + merge). Mirrors site-detail + billing.
 */
describe('AdminMediaComponent (deep-linkable tabs)', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.removeItem('media.tab'); } catch { /* */ } });

  function mk(tabParam: string | null): { c: AdminMediaComponent; nav: jasmine.Spy } {
    try { localStorage.removeItem('media.tab'); } catch { /* */ } // default → 'library'
    const nav = jasmine.createSpy('navigate').and.resolveTo(true);
    const apiStub = { get: jasmine.createSpy('get').and.returnValue(of({ assets: [], data: [] })), post: jasmine.createSpy('post').and.returnValue(of({ ok: true })), delete: jasmine.createSpy('delete').and.returnValue(of({ ok: true })) };
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: Router, useValue: { navigate: nav } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (k: string) => (k === 'tab' ? tabParam : null) } } } },
        { provide: ApiService, useValue: apiStub },
        { provide: BoltEmbedService, useValue: {} },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    TestBed.overrideComponent(AdminMediaComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminMediaComponent).componentInstance;
    c.ngOnInit(); // reads ?tab= (URL wins)
    return { c, nav };
  }

  it('opens the studio named in ?tab= (deep-link, URL wins over localStorage)', () => {
    expect(mk('video').c.activeTab()).toBe('video');
  });

  it('ignores an unknown ?tab= value (keeps the default library tab)', () => {
    expect(mk('bogus').c.activeTab()).toBe('library');
  });

  it('setTab reflects the tab in the URL + localStorage (bookmarkable: replaceUrl + merge)', () => {
    const { c, nav } = mk(null);
    c.setTab('image');
    expect(c.activeTab()).toBe('image');
    let stored: string | null = null;
    try { stored = localStorage.getItem('media.tab'); } catch { /* */ }
    expect(stored).toBe('image');
    const opts = nav.calls.mostRecent().args[1] as { queryParams: unknown; replaceUrl: boolean; queryParamsHandling: string };
    expect(opts.queryParams).toEqual({ tab: 'image' });
    expect(opts.replaceUrl).toBeTrue();
    expect(opts.queryParamsHandling).toBe('merge');
  });
});
