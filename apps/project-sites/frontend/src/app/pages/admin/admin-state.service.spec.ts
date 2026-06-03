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
