import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminPseoComponent } from './pseo.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Convergence r18 — cyan/black cohesion + a11y guard for the pSEO Matrix section.
 *
 * Locks four contracts:
 *  1. Site-reactive load — on a deep-link the selected site resolves AFTER
 *     mount, so the constructor effect fires loadStats + loadPages the instant
 *     selectedSite() resolves (and re-fires on site switch).
 *  2. The stats strip renders <app-rolling-counter> for every numeric stat
 *     (cinematic stat mandate) and the matrix table renders.
 *  3. The section root carries `appReveal` (every section animates in) and the
 *     status filter pills are keyboard-reachable tabs.
 *  4. No hardcoded cyan hex/rgba in the component style surface — accent flows
 *     through the --ps-accent token (cohesion mandate).
 */
describe('AdminPseoComponent (cohesion + a11y, convergence r18)', () => {
  let fixture: ComponentFixture<AdminPseoComponent>;
  let component: AdminPseoComponent;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let get: jasmine.Spy;

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    get = jasmine.createSpy('get').and.callFake((url: string) => {
      if (url.includes('/pages')) {
        return of({ pages: [], total: 0, page: 1, limit: 50 });
      }
      // stats endpoint /pseo/:siteId
      return of({ stats: { total: 12, draft: 4, approved: 5, published: 2, rejected: 1, thinContent: 3 } });
    });
    TestBed.configureTestingModule({
      imports: [AdminPseoComponent],
      providers: [
        {
          provide: ApiService,
          useValue: { get, post: jasmine.createSpy('post').and.returnValue(of({})) },
        },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminPseoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the section shell with the appReveal entrance + data-testid', () => {
    build({ id: 'site-1' });
    const root = fixture.nativeElement.querySelector('[data-testid="pseo-section"]') as HTMLElement;
    expect(root).toBeTruthy();
    // appReveal directive is applied to the section root (every section animates in)
    expect(
      root.hasAttribute('appReveal') ||
        root.hasAttribute('ng-reflect-app-reveal') ||
        root.matches('[appReveal]'),
    ).toBeTrue();
  });

  it('fires loadStats + loadPages when the site resolves after mount (deep-link)', () => {
    build(null);
    expect(get).not.toHaveBeenCalled();
    selectedSite.set({ id: 'site-late' });
    fixture.detectChanges();
    const statsCall = get.calls
      .allArgs()
      .some((a) => String(a[0]).includes('/pseo/site-late') && !String(a[0]).includes('/pages'));
    const pagesCall = get.calls.allArgs().some((a) => String(a[0]).includes('/pages'));
    expect(statsCall).toBeTrue();
    expect(pagesCall).toBeTrue();
  });

  it('renders <app-rolling-counter> for every numeric stat (cinematic mandate)', async () => {
    build({ id: 'site-1' });
    await fixture.whenStable();
    fixture.detectChanges();
    const counters = fixture.nativeElement.querySelectorAll('app-rolling-counter');
    expect(counters.length).toBeGreaterThanOrEqual(4);
  });

  // The empty-state glyph must be the cockpit cyan-halo disc (matches
  // <app-mini-empty>), not a bare dim-grey icon.
  it('renders the empty-state glyph in a cyan-halo disc (cockpit cohesion)', async () => {
    build({ id: 'site-1' }); // pages endpoint returns [] → empty state renders
    await fixture.whenStable();
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('[data-testid="pseo-empty"]') as HTMLElement;
    expect(empty).withContext('empty state present (0 pages)').toBeTruthy();
    const glyph = empty.querySelector('.ps-empty-glyph') as HTMLElement;
    expect(glyph).withContext('glyph wrapped in the halo disc').toBeTruthy();
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.querySelector('svg')).withContext('monochrome SVG inside the disc').toBeTruthy();
  });

  it('exposes status filter pills as keyboard-reachable tabs', () => {
    build({ id: 'site-1' });
    const pills = fixture.nativeElement.querySelectorAll('.ps-pill[role="tab"]');
    expect(pills.length).toBe(component.statusFilters.length);
    pills.forEach((p: HTMLElement) => {
      expect(p.tagName.toLowerCase()).toBe('button');
      expect(p.hasAttribute('aria-selected')).toBeTrue();
    });
  });

  it('routes cyan through --ps-accent — no bare cyan literals (token cohesion)', () => {
    // Cohesion contract: accent must flow through var(--ps-accent, …). The ONLY
    // permitted #00E5FF occurrences are inside a `var(--ps-accent, #00E5FF)` fallback;
    // standalone rgba(0,229,255,…) literals and bare hex outside a var() fallback are drift.
    const styles = (AdminPseoComponent as unknown as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles ?? [];
    const src = styles.join('\n');
    expect(src).not.toMatch(/rgba\(\s*0\s*,\s*229\s*,\s*255/i);
    // Strip every `var(--ps-accent, #00E5FF)` fallback, then assert no cyan hex remains.
    const withoutFallbacks = src.replace(/var\(--ps-[a-z-]+,\s*#[0-9a-fA-F]{3,8}\s*\)/gi, 'var()');
    expect(withoutFallbacks).not.toMatch(/#00e5ff/i);
    // Every cyan reference must go through the token.
    expect(src).toMatch(/var\(--ps-accent/);
  });

  it('surfaces a consistent "Could not load" error (matches sibling voice) when pages fail', async () => {
    build({ id: 'site-1' });
    get.and.callFake((url: string) =>
      url.includes('/pages') ? throwError(() => ({ status: 500 })) : of({ stats: {} }),
    );
    await component.loadPages();
    const msg = (component.error() ?? '').toLowerCase();
    expect(msg).withContext('an error was surfaced').not.toBe('');
    expect(msg).toContain('could not load');
    expect(msg).not.toContain('failed to load');
  });
});

/**
 * Double-toast guard: generate/approve/publish/reject use firstValueFrom(api.post)
 * + a catch that shows their OWN toast.error, so each post must pass {silent:true}
 * or a failure fires the generic ApiService toast on top of the specific one.
 */
describe('AdminPseoComponent (mutations are {silent} — no double-toast)', () => {
  let post: jasmine.Spy;
  let get: jasmine.Spy;
  function make(): AdminPseoComponent {
    post = jasmine.createSpy('post').and.returnValue(of({}));
    get = jasmine.createSpy('get').and.returnValue(of({ pages: [], total: 0, stats: { total: 0, approved: 0, published: 0, thinContent: 0 } }));
    TestBed.configureTestingModule({
      imports: [AdminPseoComponent],
      providers: [
        { provide: ApiService, useValue: { get, post } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0, info: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    return TestBed.createComponent(AdminPseoComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('generate() POSTs {silent:true}', async () => {
    const c = make();
    await c.generate();
    expect(post.calls.mostRecent().args[0]).toBe('/pseo/s1/generate');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('resultAnnouncement(): announces the loaded page count + active status for screen readers', () => {
    const c = make();
    c.pages.set([{ id: 'p1' }, { id: 'p2' }] as never);
    c.statusFilter.set('all');
    expect(c.resultAnnouncement()).toBe('Showing 2 pages');
    c.statusFilter.set('draft');
    expect(c.resultAnnouncement()).toBe('2 pages · draft');
    c.pages.set([{ id: 'p1' }] as never);
    expect(c.resultAnnouncement()).withContext('singular noun for one page').toBe('1 page · draft');
  });

  it('approvePage / publishPage / rejectPage all POST {silent:true}', async () => {
    const c = make();
    await c.approvePage({ id: 'p1', route_slug: 'r' } as never);
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
    await c.publishPage({ id: 'p1', route_slug: 'r' } as never);
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
    await c.rejectPage({ id: 'p1', route_slug: 'r' } as never);
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('approvePage + rejectPage refresh the stats header (no stale "approved" count)', async () => {
    const c = make();
    get.calls.reset();
    await c.approvePage({ id: 'p1', route_slug: 'r' } as never);
    expect(get).toHaveBeenCalledWith('/pseo/s1'); // loadStats fired → counter stays accurate
    get.calls.reset();
    await c.rejectPage({ id: 'p2', route_slug: 'r2' } as never);
    expect(get).toHaveBeenCalledWith('/pseo/s1');
  });

  it('showAllPages resets a status filter back to "all" and reloads (empty-state first action)', () => {
    const c = make();
    c.statusFilter.set('rejected');
    c.showAllPages();
    expect(c.statusFilter()).toBe('all');
    // loadPages re-fetches the matrix page (a /pseo/s1/pages… GET fires)
    expect(get.calls.allArgs().some((a) => String(a[0]).includes('/pseo/s1/pages'))).toBeTrue();
  });
});
