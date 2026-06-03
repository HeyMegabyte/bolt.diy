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
