import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { Dialog } from '@angular/cdk/dialog';
import { AdminStateService } from './admin-state.service';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { TelemetryService } from '../../services/telemetry.service';

/**
 * Core contract for AdminStateService — the single state container every admin
 * section shares (provided at AdminComponent level). Locks the high-traffic
 * `selectedSite` derivation (no-id → first site; id → match; stale id → first;
 * empty → null) and the loadData() success/error fan-in (forkJoin populates the
 * signals + clears loading; a failure clears loading + toasts, never hangs).
 */
const site = (id: string): never => ({ id, slug: id, business_name: id, status: 'published' }) as never;

function setup(opts: { sites?: never[]; meFails?: boolean; loadFails?: boolean } = {}): {
  svc: AdminStateService; toastErr: jasmine.Spy;
} {
  const ok = <T,>(data: T) => of({ data });
  const api = {
    listSites: () => (opts.loadFails ? throwError(() => ({ status: 500 })) : ok(opts.sites ?? [])),
    getDomainSummary: () => ok({ total: 0, active: 0, pending: 0, failed: 0 }),
    getSubscription: () => ok(null),
    getMe: () => (opts.meFails ? throwError(() => ({ status: 500 })) : ok({ org_id: 'org-1', is_super_admin: true })),
    getAnalytics: () => ok(null),
  };
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    providers: [
      AdminStateService,
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { isLoggedIn: () => true } },
      { provide: ToastService, useValue: { error: toastErr, success: () => 0, toasts: () => [] } },
      { provide: TelemetryService, useValue: { track: () => undefined } },
      { provide: Router, useValue: { navigate: () => undefined, url: '/admin' } },
      { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (u: string) => u } },
      { provide: Dialog, useValue: { open: () => ({ closed: of(undefined) }) } },
    ],
  });
  return { svc: TestBed.inject(AdminStateService), toastErr };
}

describe('AdminStateService (selectedSite + loadData)', () => {
  afterEach(() => {
    // Stop any live-refresh timer a loadData success may have started.
    try { (TestBed.inject(AdminStateService) as unknown as { stopLiveRefresh(): void }).stopLiveRefresh(); } catch { /* */ }
    TestBed.resetTestingModule();
  });

  it('selectedSite is null when there are no sites', () => {
    const { svc } = setup();
    svc.sites.set([]);
    expect(svc.selectedSite()).toBeNull();
  });

  it('selectedSite defaults to the first site when no id is selected', () => {
    const { svc } = setup();
    svc.sites.set([site('a'), site('b')]);
    svc.selectedSiteId.set(null);
    expect(svc.selectedSite()?.id).toBe('a');
  });

  it('selectedSite resolves the selected id', () => {
    const { svc } = setup();
    svc.sites.set([site('a'), site('b')]);
    svc.selectedSiteId.set('b');
    expect(svc.selectedSite()?.id).toBe('b');
  });

  it('selectedSite falls back to the first site when the selected id is stale', () => {
    const { svc } = setup();
    svc.sites.set([site('a'), site('b')]);
    svc.selectedSiteId.set('ghost');
    expect(svc.selectedSite()?.id).toBe('a');
  });

  it('loadData() populates sites/org/super-admin and clears loading', () => {
    const { svc } = setup({ sites: [site('a'), site('b')] });
    svc.loadData();
    expect(svc.sites().length).toBe(2);
    expect(svc.orgId()).toBe('org-1');
    expect(svc.isSuperAdmin()).toBe(true);
    expect(svc.loading()).toBe(false);
  });

  it('loadData() tolerates a /me failure (org defaults, dashboard still loads)', () => {
    const { svc } = setup({ sites: [site('a')], meFails: true });
    svc.loadData();
    expect(svc.sites().length).toBe(1); // dashboard loaded despite /me hiccup
    expect(svc.orgId()).toBe('');
    expect(svc.loading()).toBe(false);
  });

  it('loadData() failure clears loading + toasts (never hangs on the spinner)', () => {
    const { svc, toastErr } = setup({ loadFails: true });
    svc.loadData();
    expect(svc.loading()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  it('setAnalyticsPeriod updates the period signal', () => {
    const { svc } = setup({ sites: [site('a')] });
    svc.setAnalyticsPeriod('30');
    expect(svc.analyticsPeriod()).toBe('30');
  });
});

/**
 * Locks the documented perf invariant: the 30s live-refresh poll PAUSES while
 * the tab is hidden (so a backgrounded admin never burns the API quota) and
 * RESUMES when the tab returns. A regression here (dropping the visibilitychange
 * guard) would silently poll hidden tabs forever — exactly the class of silent
 * perf regression a test must catch.
 */
describe('AdminStateService — visibility-aware live-refresh (hidden tabs do not poll)', () => {
  let hidden = false;
  let origHidden: PropertyDescriptor | undefined;

  function buildWithSpy(): { svc: AdminStateService; listSites: jasmine.Spy } {
    const listSites = jasmine.createSpy('listSites').and.returnValue(of({ data: [site('s1')] }));
    const api = {
      listSites,
      getDomainSummary: () => of({ data: { total: 0, active: 0, pending: 0, failed: 0 } }),
      getSubscription: () => of({ data: null }),
      getMe: () => of({ data: { org_id: 'o', is_super_admin: false } }),
      getAnalytics: () => of({ data: null }),
    };
    TestBed.configureTestingModule({
      providers: [
        AdminStateService,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, toasts: () => [] } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: Router, useValue: { navigate: () => undefined, url: '/admin' } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (u: string) => u } },
        { provide: Dialog, useValue: { open: () => ({ closed: of(undefined) }) } },
      ],
    });
    return { svc: TestBed.inject(AdminStateService), listSites };
  }

  beforeEach(() => {
    hidden = false;
    origHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    try { (TestBed.inject(AdminStateService) as unknown as { stopLiveRefresh(): void }).stopLiveRefresh(); } catch { /* */ }
    if (origHidden) Object.defineProperty(document, 'hidden', origHidden);
    else Reflect.deleteProperty(document, 'hidden');
    TestBed.resetTestingModule();
  });

  it('does NOT poll while hidden, and resumes polling after the tab returns', () => {
    const { svc, listSites } = buildWithSpy();
    svc.loadData(); // success → starts the 30s live-refresh + visibility listener
    const base = listSites.calls.count(); // 1 (loadData's own fetch)

    // Tab hidden → the visibility handler must stop the timer.
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    jasmine.clock().tick(31_000);
    expect(listSites.calls.count()).withContext('no poll fired while the tab was hidden').toBe(base);

    // Tab visible again → resumes; the 30s interval fires another sites fetch.
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    jasmine.clock().tick(31_000);
    expect(listSites.calls.count()).withContext('polling resumes after the tab returns').toBeGreaterThan(base);
  });
});

/**
 * copyUrl() copies the site's LIVE url (primary hostname → slug.projectsites.dev)
 * to the clipboard. A clipboard rejection (insecure context / denied permission)
 * must surface a friendly error toast — never a silent unhandled rejection (which
 * would also trip the console-error gate).
 */
describe('AdminStateService — copyUrl (clipboard + graceful failure)', () => {
  let writeText: jasmine.Spy;
  let success: jasmine.Spy;
  let error: jasmine.Spy;
  let origClipboard: PropertyDescriptor | undefined;

  function build(): AdminStateService {
    success = jasmine.createSpy('success');
    error = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      providers: [
        AdminStateService,
        { provide: ApiService, useValue: { listSites: () => of({ data: [] }), getDomainSummary: () => of({ data: {} }), getSubscription: () => of({ data: null }), getMe: () => of({ data: {} }), getAnalytics: () => of({ data: null }) } },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
        { provide: ToastService, useValue: { success, error, toasts: () => [] } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: Router, useValue: { navigate: () => undefined, url: '/admin' } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (u: string) => u } },
        { provide: Dialog, useValue: { open: () => ({ closed: of(undefined) }) } },
      ],
    });
    return TestBed.inject(AdminStateService);
  }

  beforeEach(() => {
    origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeText = jasmine.createSpy('writeText');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  afterEach(() => {
    if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
    TestBed.resetTestingModule();
  });

  it('copies the live URL and toasts success', async () => {
    writeText.and.returnValue(Promise.resolve());
    const svc = build();
    svc.copyUrl({ id: 's', slug: 'vito', business_name: 'Vito', status: 'published' } as never);
    await Promise.resolve(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://vito.projectsites.dev');
    expect(success).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a clipboard rejection surfaces an error toast — no silent unhandled rejection', async () => {
    writeText.and.returnValue(Promise.reject(new Error('denied')));
    const svc = build();
    svc.copyUrl({ id: 's', slug: 'vito', business_name: 'Vito', status: 'published' } as never);
    await Promise.resolve(); await Promise.resolve();
    expect(error).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
});
