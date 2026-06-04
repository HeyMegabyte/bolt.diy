import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
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
    expect((link as HTMLElement)?.classList.contains('underline')).withContext('link must be permanently underlined (WCAG 1.4.1 link-in-text-block — not distinguishable by color alone)').toBe(true);
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
