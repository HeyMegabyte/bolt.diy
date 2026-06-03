import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminTrustCenterComponent } from './trust-center.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the Trust Center load-error gating: a non-404 load failure sets a
 * persistent loadError (so the editor is hidden and the operator can't publish a
 * default-valued form over a profile that merely failed to load), a 404 shows the
 * flag-disabled empty card (not an error), and success clears the error. The
 * flag observable is stubbed off so the constructor doesn't auto-refresh.
 */
function make(get: jasmine.Spy): { c: AdminTrustCenterComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [AdminTrustCenterComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({ data: {} }) } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
      { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
    ],
  });
  TestBed.overrideComponent(AdminTrustCenterComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminTrustCenterComponent).componentInstance, toastErr };
}

describe('AdminTrustCenterComponent (load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success loads the profile and leaves loadError null', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ data: { data_residency: 'global', audit_log_policy: 'on-request', ai_outage_behavior: 'graceful-degradation', custom_disclosures: null, ai_models: [], content_provenance: [], published: false } }));
    const { c } = make(get);
    c.refresh();
    expect(c.loadError()).toBeNull();
    expect(c.notFound()).toBe(false);
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent loadError (gates the editor) + toasts', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = make(get);
    c.refresh();
    expect(c.loadError()).toContain("Couldn't load");
    expect(c.notFound()).toBe(false); // not a masquerade as "disabled"
    expect(toastErr).toHaveBeenCalled();
  });

  it('a 404 shows the flag-disabled empty card without a loadError', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 })));
    const { c } = make(get);
    c.refresh();
    expect(c.notFound()).toBe(true);
    expect(c.loadError()).toBeNull();
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ data: { data_residency: 'global', audit_log_policy: 'on-request', ai_outage_behavior: 'graceful-degradation', custom_disclosures: null, ai_models: [], content_provenance: [], published: false } }),
    );
    const { c } = make(get);
    c.refresh();
    expect(c.loadError()).not.toBeNull();
    c.refresh();
    expect(c.loadError()).toBeNull();
  });
});
