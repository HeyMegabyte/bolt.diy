import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { AdminSiteDnaComponent } from './site-dna.component';
import { ApiService } from '../../../services/api.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the convergence-r11 cohesion pass for the Site DNA section:
 *   - taste-pulse distribution math (segPct / acceptRatio) stays correct
 *   - the screen-reader aria-label mirrors the visible counts
 *   - the flag-gate notice renders when the flag is off (no spurious fetch)
 */
describe('AdminSiteDnaComponent (taste pulse + a11y)', () => {
  let fixture: ComponentFixture<AdminSiteDnaComponent>;
  let component: AdminSiteDnaComponent;
  let isOn: jasmine.Spy;
  let apiGet: jasmine.Spy;

  function build(flagOn: boolean): void {
    isOn = jasmine.createSpy('isOn').and.returnValue(of(flagOn));
    apiGet = jasmine.createSpy('get').and.returnValue(of({ history: [], preferences: [] }));
    TestBed.configureTestingModule({
      imports: [AdminSiteDnaComponent, RouterModule.forRoot([])],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: jasmine.createSpy('post').and.returnValue(of({ id: 'x' })) } },
        { provide: FeatureFlagService, useValue: { isOn } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'site-dna-1' } } },
        },
      ],
    });
    fixture = TestBed.createComponent(AdminSiteDnaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the flag-gate notice and skips the data fetch when the flag is off', () => {
    build(false);
    expect(component.flagEnabled()).toBe(false);
    expect(apiGet).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-flag-gate"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-taste-pulse"]')).toBeNull();
  });

  it('the flag-gate Feature-Flags link is an inline, UNDERLINED, working RouterLink (cohesion with the sibling flag-gate cards)', () => {
    build(false);
    const link = fixture.nativeElement.querySelector(
      '[data-testid="dna-flag-gate"] a[routerLink="/admin/feature-flags"]',
    ) as HTMLAnchorElement;
    expect(link).withContext('flag-gate links to Feature Flags').toBeTruthy();
    // In-text affordance matches the standard (underline, not the old color-only
    // standalone CTA) + is a real SPA link (renders href).
    expect(link.className).toContain('underline');
    expect(link.getAttribute('href')).toBe('/admin/feature-flags');
  });

  // The icon-only Refresh button (↻) keeps its constant aria-label, but a screen
  // reader also needs the in-progress state — aria-busy — while history reloads.
  // Cohesion with the rest of /admin's Refresh affordances.
  it('the ↻ Refresh button announces aria-busy while the feedback history reloads', () => {
    build(true);
    const btn = fixture.nativeElement.querySelector('.dna-refresh-btn[aria-label="Refresh feedback history"]') as HTMLButtonElement;
    expect(btn).withContext('icon refresh button renders when the flag is on').toBeTruthy();
    component.loading.set(true);
    fixture.detectChanges();
    expect(btn.getAttribute('aria-busy')).withContext('busy state announced to AT during reload').toBe('true');
    component.loading.set(false);
    fixture.detectChanges();
    expect(btn.getAttribute('aria-busy')).withContext('busy clears when idle').toBe('false');
  });

  it('computes accept ratio as a whole-number percent of all signals', () => {
    build(true);
    component.history.set([
      row('accept'), row('accept'), row('accept'),
      row('reject'),
      row('edit'),
    ]);
    fixture.detectChanges();
    // 3 of 5 accepted → 60%
    expect(component.acceptRatio()).toBe(60);
  });

  it('returns 0% accept ratio + 0 segment width with no signals (no divide-by-zero)', () => {
    build(true);
    expect(component.acceptRatio()).toBe(0);
    expect(component.segPct(0)).toBe(0);
    expect(component.segPct(3)).toBe(0);
  });

  it('segment widths sum to 100% of the total signal volume', () => {
    build(true);
    component.history.set([row('accept'), row('accept'), row('reject'), row('edit')]);
    fixture.detectChanges();
    const sum =
      component.segPct(component.acceptCount()) +
      component.segPct(component.editCount()) +
      component.segPct(component.rejectCount());
    expect(Math.round(sum)).toBe(100);
  });

  it('the feedback table is a keyboard-scrollable region (WCAG 1.4.10 — long component ids scroll, never clip unreachably)', () => {
    build(true);
    component.history.set([row('accept')]);
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="dna-table-scroll"]') as HTMLElement;
    expect(region).withContext('feedback table wrap present').toBeTruthy();
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).withContext('keyboard-scrollable').toBe('0');
    expect(region.querySelector('table')).withContext('table inside the scroll region').toBeTruthy();
  });

  it('the pulse aria-label mirrors the visible accept/edit/reject counts', () => {
    build(true);
    component.history.set([row('accept'), row('reject'), row('edit'), row('edit')]);
    fixture.detectChanges();
    const label = component.pulseAriaLabel();
    expect(label).toContain('1 accepted');
    expect(label).toContain('2 edited');
    expect(label).toContain('1 rejected');
    expect(label).toContain('out of 4 signals');
  });

  it('a non-404 load failure sets loadError (not a fake "No feedback yet")', () => {
    build(true);
    apiGet.and.returnValue(throwError(() => ({ status: 500 })));
    component.load();
    expect(component.loadError()).toBeTruthy();
    expect(component.flagEnabled()).toBe(true); // not 404 → the feature stays enabled
  });

  // A definitive "0 signals · 0 accepted · …" must NOT show over the error
  // message when the load failed with no data — the count is unknown, not 0
  // (same stat-over-error fix as marketplace).
  it('hides the header stats on a load error with no data; shows them when data exists', () => {
    build(true);
    component.loadError.set('Server error');
    component.history.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-stats"]'))
      .withContext('no "0 signals" over the error').toBeNull();

    component.history.set([row('accept')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-stats"]'))
      .withContext('stats return once there is data').not.toBeNull();
  });

  it('a 404 load failure flips the flag-gate off without a loadError', () => {
    build(true);
    apiGet.and.returnValue(throwError(() => ({ status: 404 })));
    component.load();
    expect(component.flagEnabled()).toBe(false);
    expect(component.loadError()).toBeNull();
  });

  // load() owns its error UX: 404 → silent flag-gate, non-404 → inline loadError
  // banner with Retry. So both forkJoin reads must be {silent:true} — else the
  // generic ApiService toast double-fires over the banner (and wrongly toasts
  // 'not found' on the intended-silent 404 flag-off).
  it('reads both DNA endpoints {silent:true} so the component owns the error UX', () => {
    build(true); // flagOn → load() runs via detectChanges
    expect(apiGet).toHaveBeenCalled();
    const allSilent = apiGet.calls.all().every((c) => {
      const opts = c.args[2] as { silent?: boolean } | undefined;
      return opts?.silent === true;
    });
    expect(allSilent).withContext('both history + prefs GETs are {silent}').toBeTrue();
  });

  it('does NOT flash a definitive 0-counter over the loading skeleton — header stats shimmer until the first fetch resolves (premature-stat-during-load guard)', () => {
    // forkJoin emits only when BOTH inner GETs complete; pending Subjects keep
    // load() in flight → loading()=true, history()=[] (the bug window).
    const history$ = new Subject<{ history: unknown[] }>();
    const prefs$ = new Subject<{ preferences: unknown[] }>();
    isOn = jasmine.createSpy('isOn').and.returnValue(of(true));
    apiGet = jasmine
      .createSpy('get')
      .and.callFake((url: string) => (url.includes('/history') ? history$ : prefs$));
    TestBed.configureTestingModule({
      imports: [AdminSiteDnaComponent, RouterModule.forRoot([])],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: jasmine.createSpy('post').and.returnValue(of({ id: 'x' })) } },
        { provide: FeatureFlagService, useValue: { isOn } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'site-dna-1' } } } },
      ],
    });
    fixture = TestBed.createComponent(AdminSiteDnaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → flag on → load() fires, forkJoin pending

    // ── Bug window: loading with nothing yet ──
    expect(component.loading()).withContext('first fetch still in flight').toBeTrue();
    const host = fixture.nativeElement as HTMLElement;
    const stats = host.querySelector('[data-testid="dna-stats"]');
    expect(stats).withContext('stats row + labels stay mounted (no layout shift)').toBeTruthy();
    // The numbers must be shimmer skeletons, NOT live rolling-counters showing "0".
    expect(host.querySelectorAll('[data-testid="dna-stats"] .dna-stat-skel').length)
      .withContext('every stat value is a skeleton during initial load')
      .toBeGreaterThan(0);
    expect(host.querySelectorAll('[data-testid="dna-stats"] app-rolling-counter').length)
      .withContext('no definitive 0-counter renders during initial load')
      .toBe(0);

    // ── Resolve the load with one accept signal ──
    history$.next({ history: [row('accept')] });
    history$.complete();
    prefs$.next({ preferences: [] });
    prefs$.complete();
    fixture.detectChanges();

    expect(component.loading()).toBeFalse();
    expect(host.querySelectorAll('[data-testid="dna-stats"] .dna-stat-skel').length)
      .withContext('skeletons gone once data resolves')
      .toBe(0);
    expect(host.querySelectorAll('[data-testid="dna-stats"] app-rolling-counter').length)
      .withContext('real rolling counters render after load')
      .toBeGreaterThan(0);
  });

  function row(action: 'accept' | 'reject' | 'edit') {
    return {
      id: `r-${Math.random()}`,
      component_id: 'hero',
      component_class: 'hero',
      action,
      context: null,
      created_at: new Date().toISOString(),
    };
  }
});
