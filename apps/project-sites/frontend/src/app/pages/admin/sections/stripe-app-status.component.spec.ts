import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, NEVER } from 'rxjs';
import { AdminStripeAppStatusComponent } from './stripe-app-status.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the Stripe App status load-error gating: a non-404 summary-load failure
 * sets a persistent loadError (so a failed fetch shows a retry, not a blank
 * panel). 404 = flag-disabled card (no error). Flag stubbed off so the
 * constructor doesn't auto-refresh; the /installs fetch returns [] harmlessly.
 */
function make(summaryGet: jasmine.Spy, installsGet?: jasmine.Spy): { c: AdminStripeAppStatusComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  const get = jasmine.createSpy('get').and.callFake((path: string) =>
    path.includes('/stripe-app/summary')
      ? summaryGet(path)
      : (installsGet ? installsGet(path) : of({ data: [] })),
  );
  TestBed.configureTestingModule({
    imports: [AdminStripeAppStatusComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
      { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
    ],
  });
  TestBed.overrideComponent(AdminStripeAppStatusComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminStripeAppStatusComponent).componentInstance, toastErr };
}

describe('AdminStripeAppStatusComponent (load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success loads the summary and leaves loadError null', () => {
    const { c } = make(jasmine.createSpy('sg').and.returnValue(of({ data: { total_installs: 3, active_installs: 2, uninstalled: 1, paused: 0, last_event_at: null } })));
    c.refresh();
    expect(c.loadError()).toBeNull();
    expect(c.summary()).not.toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent loadError (not a blank panel) + toasts', () => {
    const { c, toastErr } = make(jasmine.createSpy('sg').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refresh();
    expect(c.loadError()).toContain("Couldn't load");
    expect(c.notFound()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  it('an installs-feed failure sets installsError (not a fake "No installs yet")', () => {
    const okSummary = jasmine.createSpy('sg').and.returnValue(of({ data: { total_installs: 0, active_installs: 0, uninstalled: 0, paused: 0, last_event_at: null } }));
    const failInstalls = jasmine.createSpy('ig').and.returnValue(throwError(() => ({ status: 500 })));
    const { c } = make(okSummary, failInstalls);
    c.refresh();
    expect(c.installsError()).toContain("Couldn't load recent installs");
    expect(c.installs().length).toBe(0);
  });

  it('a 404 shows the flag-disabled card without a loadError', () => {
    const { c } = make(jasmine.createSpy('sg').and.returnValue(throwError(() => ({ status: 404 }))));
    c.refresh();
    expect(c.notFound()).toBe(true);
    expect(c.loadError()).toBeNull();
  });

  it('retry after an error clears the prior loadError', () => {
    const sg = jasmine.createSpy('sg').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ data: { total_installs: 0, active_installs: 0, uninstalled: 0, paused: 0, last_event_at: null } }),
    );
    const { c } = make(sg);
    c.refresh();
    expect(c.loadError()).not.toBeNull();
    c.refresh();
    expect(c.loadError()).toBeNull();
  });
});

describe('AdminStripeAppStatusComponent (flag-disabled card links to Feature Flags)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // Full-render (NOT the template-stripped make()) — the disabled card tells the
  // operator to enable a flag "in /admin/feature-flags"; that route MUST be a
  // clickable routerLink (SPA nav), not dead plain text.
  it('the disabled message links /admin/feature-flags via routerLink, not plain text', () => {
    TestBed.configureTestingModule({
      imports: [AdminStripeAppStatusComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    const f = TestBed.createComponent(AdminStripeAppStatusComponent);
    f.componentInstance.notFound.set(true);
    f.detectChanges();
    const link = (f.nativeElement as HTMLElement).querySelector('a[href="/admin/feature-flags"]');
    expect(link).withContext('feature-flags route must be a clickable link, not dead plain text').not.toBeNull();
    // Shared <app-flag-gate-notice> underlines via `.flag-gate__link` CSS (WCAG 1.4.1
    // link-in-text-block — not distinguishable by color alone), not the Tailwind class.
    expect(getComputedStyle(link as HTMLElement).textDecorationLine).withContext('link permanently underlined').toContain('underline');
  });
});

describe('AdminStripeAppStatusComponent (silent summary read — no double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('reads /stripe-app/summary silently (component owns the non-404 toast)', () => {
    const get = jasmine.createSpy('get').and.callFake((p: string) => p.includes('/stripe-app/summary') ? of({ data: { total_installs: 0, active_installs: 0, uninstalled: 0, paused: 0, last_event_at: null, by_source: {} } }) : of({ data: [] }));
    TestBed.configureTestingModule({
      imports: [AdminStripeAppStatusComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
      ],
    });
    TestBed.overrideComponent(AdminStripeAppStatusComponent, { set: { template: '<div></div>', imports: [] } });
    TestBed.createComponent(AdminStripeAppStatusComponent);
    expect(get).toHaveBeenCalledWith('/stripe-app/summary', undefined, { silent: true });
  });
});

/**
 * The header Refresh button matches the rest of /admin: aria-busy while
 * reloading + the "Refreshing…" label (not the initial-load "Loading…"), so a
 * screen reader hears the in-progress state and the copy is cockpit-consistent.
 */
describe('AdminStripeAppStatusComponent (Refresh button busy state — cohesion + a11y)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): import('@angular/core/testing').ComponentFixture<AdminStripeAppStatusComponent> {
    TestBed.configureTestingModule({
      imports: [AdminStripeAppStatusComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    return TestBed.createComponent(AdminStripeAppStatusComponent);
  }

  it('Refresh button binds aria-busy and reads "Refreshing…" while loading', () => {
    const f = render();
    f.componentInstance.notFound.set(true); // gated render → Refresh is the only header button
    f.componentInstance.loading.set(true);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('button.btn-ghost') as HTMLButtonElement;
    expect(btn).withContext('Refresh button renders in the header').not.toBeNull();
    expect(btn.getAttribute('aria-busy')).withContext('busy state announced to AT').toBe('true');
    expect(btn.textContent ?? '').withContext('reload label, not initial "Loading…"').toContain('Refreshing…');
    expect(btn.textContent ?? '').not.toContain('Loading…');
  });

  it('Refresh button reads "Refresh" and clears aria-busy when idle', () => {
    const f = render();
    f.componentInstance.notFound.set(true);
    f.componentInstance.loading.set(false);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('button.btn-ghost') as HTMLButtonElement;
    expect(btn.textContent ?? '').toContain('Refresh');
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });
});

/**
 * Full-render: while the flag is ON and the summary fetch is in flight, the
 * panel must show a cyan loading skeleton (not a blank panel) so the KPI grid
 * doesn't pop in with a layout shift.
 */
describe('AdminStripeAppStatusComponent (loading skeleton)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a cyan KPI skeleton while the summary loads (flag on, no data yet)', () => {
    TestBed.configureTestingModule({
      imports: [AdminStripeAppStatusComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => NEVER } }, // never resolves → loading stays true
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
      ],
    });
    const fx = TestBed.createComponent(AdminStripeAppStatusComponent);
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="stripe-app-skeleton"]')).withContext('skeleton shows during load').not.toBeNull();
    // The real KPI grid (driven by summary()) is NOT shown yet.
    expect(fx.componentInstance.summary()).toBeNull();
  });
});
