import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminEnterpriseComponent } from './enterprise.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the Enterprise contract load-error gating: a non-404 load failure sets
 * a persistent loadError (the contract editor is hidden so the operator can't
 * save a default-valued form over a contract that merely failed to load), a 404
 * shows the flag-disabled card (not an error), and success/retry clear it. The
 * flag observable is stubbed off so the constructor doesn't auto-refresh; the
 * supplementary /sla + /audit-exports fetches return [] harmlessly.
 */
function make(contractGet: jasmine.Spy): { c: AdminEnterpriseComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  const get = jasmine.createSpy('get').and.callFake((path: string) =>
    path.includes('/enterprise/contract') ? contractGet(path) : of({ data: [] }),
  );
  TestBed.configureTestingModule({
    imports: [AdminEnterpriseComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({ data: {} }) } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
      { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
    ],
  });
  TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminEnterpriseComponent).componentInstance, toastErr };
}

describe('AdminEnterpriseComponent (contract load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success loads the contract and leaves loadError null', () => {
    const { c } = make(jasmine.createSpy('cg').and.returnValue(of({ data: null })));
    c.refresh();
    expect(c.loadError()).toBeNull();
    expect(c.notFound()).toBe(false);
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent loadError (gates the editor) + toasts', () => {
    const { c, toastErr } = make(jasmine.createSpy('cg').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refresh();
    expect(c.loadError()).toContain("Couldn't load");
    expect(c.notFound()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  it('a 404 shows the flag-disabled card without a loadError', () => {
    const { c } = make(jasmine.createSpy('cg').and.returnValue(throwError(() => ({ status: 404 }))));
    c.refresh();
    expect(c.notFound()).toBe(true);
    expect(c.loadError()).toBeNull();
  });

  it('retry after an error clears the prior loadError', () => {
    const cg = jasmine.createSpy('cg').and.returnValues(throwError(() => ({ status: 500 })), of({ data: null }));
    const { c } = make(cg);
    c.refresh();
    expect(c.loadError()).not.toBeNull();
    c.refresh();
    expect(c.loadError()).toBeNull();
  });
});

describe('AdminEnterpriseComponent (SLA headroom gauge)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function gaugeComponent(): AdminEnterpriseComponent {
    return make(jasmine.createSpy('cg').and.returnValue(of({ data: null }))).c;
  }

  it('rollingUptime is null until an SLA snapshot loads', () => {
    const c = gaugeComponent();
    expect(c.rollingUptime()).toBeNull();
    expect(c.gaugeFillPct()).toBe(0);
    expect(c.gaugeAriaText()).toContain('No uptime data');
    expect(c.slaHeadroom()).toBe(0);
  });

  it('positive headroom keeps the marker left of the fill (within SLA)', () => {
    const c = gaugeComponent();
    c.slaPct.set(99.9);
    c.sla.set({ contract_sla_pct: 99.9, rolling_uptime_pct: 99.98, breached: false, snapshots: [] });
    expect(c.slaHeadroom()).toBeCloseTo(0.08, 2);
    expect(c.slaBreached()).toBe(false);
    expect(c.gaugeFillPct()).toBeGreaterThan(c.gaugeMarkerPct());
    expect(c.gaugeAriaText()).toContain('meeting');
  });

  it('a breach pushes the fill below the SLA marker + flags breached', () => {
    const c = gaugeComponent();
    c.slaPct.set(99.9);
    c.sla.set({ contract_sla_pct: 99.9, rolling_uptime_pct: 99.4, breached: true, snapshots: [] });
    expect(c.slaHeadroom()).toBeLessThan(0);
    expect(c.slaBreached()).toBe(true);
    expect(c.gaugeFillPct()).toBeLessThan(c.gaugeMarkerPct());
    expect(c.gaugeAriaText()).toContain('below');
  });

  it('gauge floor zooms into the high-uptime band and clamps to [90, 99.9]', () => {
    const c = gaugeComponent();
    c.slaPct.set(99.99);
    c.sla.set({ contract_sla_pct: 99.99, rolling_uptime_pct: 99.99, breached: false, snapshots: [] });
    expect(c.slaFloor()).toBeLessThanOrEqual(99.9);
    expect(c.slaFloor()).toBeGreaterThanOrEqual(90);
    expect(c.gaugeFillPct()).toBeGreaterThanOrEqual(0);
    expect(c.gaugeFillPct()).toBeLessThanOrEqual(100);
    expect(c.gaugeMarkerPct()).toBeGreaterThanOrEqual(0);
    expect(c.gaugeMarkerPct()).toBeLessThanOrEqual(100);
  });
});
