import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

describe('AdminTrustCenterComponent (flag-disabled card links to Feature Flags)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // Full-render (NOT the template-stripped make()) — consistency with the sibling
  // flag-gated sections (enterprise/stripe-app): the disabled card points at
  // /admin/feature-flags as a clickable routerLink (SPA nav), not dead text or a
  // vague "ask an admin" (the viewer is already inside /admin).
  it('the disabled message links /admin/feature-flags via routerLink, not plain text', () => {
    TestBed.configureTestingModule({
      imports: [AdminTrustCenterComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    const f = TestBed.createComponent(AdminTrustCenterComponent);
    f.componentInstance.notFound.set(true);
    f.detectChanges();
    const link = (f.nativeElement as HTMLElement).querySelector('a[href="/admin/feature-flags"]');
    expect(link).withContext('feature-flags route must be a clickable link, not dead plain text').not.toBeNull();
    expect((link as HTMLElement)?.classList.contains('underline')).withContext('link must be permanently underlined (WCAG 1.4.1 link-in-text-block — not distinguishable by color alone)').toBe(true);
  });
});

describe('AdminTrustCenterComponent (list remove buttons: contextual name + destructive affordance)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the item it removes (not a generic "Remove") + carries the --danger modifier', () => {
    TestBed.configureTestingModule({
      imports: [AdminTrustCenterComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
      ],
    });
    const f = TestBed.createComponent(AdminTrustCenterComponent);
    f.componentInstance.notFound.set(false); // render the editor (not the flag-disabled card)
    f.componentInstance.aiModels.set([{ vendor: 'OpenAI', model: 'gpt-4o', purpose: 'copy' }] as never);
    f.componentInstance.provenance.set([{ area: 'homepage hero', origin: 'ai-generated', reviewed_by: '' }] as never);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    // a SR arrowing a list of model rows needs to know WHICH row's × they're on.
    const modelRemove = el.querySelector('button[aria-label*="gpt-4o"]');
    expect(modelRemove).withContext('model remove button names the model').not.toBeNull();
    expect(modelRemove!.classList.contains('btn-ghost-sm--danger'))
      .withContext('destructive × must visibly differ from the neutral "+ Add" ghost button').toBeTrue();
    const provRemove = el.querySelector('button[aria-label*="homepage hero"]');
    expect(provRemove).withContext('provenance remove button names the area').not.toBeNull();
    // the "+ Add model" ghost button shares .btn-ghost-sm but must NOT be flagged destructive.
    const addBtn = Array.from(el.querySelectorAll('button')).find((b) => /Add model/i.test(b.textContent ?? ''));
    expect(addBtn?.classList.contains('btn-ghost-sm--danger')).withContext('add button stays neutral').toBeFalsy();
  });
});

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

  it('captures the worker request_id from a non-404 failure → loadErrorRef (copyable support reference on the shared error card)', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_tc42' } } })));
    const { c } = make(get);
    c.refresh();
    expect(c.loadErrorRef()).toBe('req_tc42');
  });

  it('a 404 leaves loadErrorRef empty (flag-gate card, not the transient error card)', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404, error: { error: { request_id: 'nope' } } })));
    const { c } = make(get);
    c.refresh();
    expect(c.notFound()).toBe(true);
    expect(c.loadErrorRef()).toBe('');
  });

  it('resets loadErrorRef at the start of every refresh (no stale reference)', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500, error: { error: { request_id: 'req_z' } } })),
      of({ data: { data_residency: 'global', audit_log_policy: 'on-request', ai_outage_behavior: 'graceful-degradation', custom_disclosures: null, ai_models: [], content_provenance: [], published: false } }),
    );
    const { c } = make(get);
    c.refresh();
    expect(c.loadErrorRef()).toBe('req_z');
    c.refresh();
    expect(c.loadErrorRef()).toBe('');
  });
});

describe('AdminTrustCenterComponent (silent profile read — no double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('reads /trust/profile silently (component owns the non-404 toast)', () => {
    const get = jasmine.createSpy('get').and.callFake((p: string) => p.includes('/trust/profile') ? of({ data: null }) : of({ data: [] }));
    TestBed.configureTestingModule({
      imports: [AdminTrustCenterComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
      ],
    });
    TestBed.overrideComponent(AdminTrustCenterComponent, { set: { template: '<div></div>', imports: [] } });
    TestBed.createComponent(AdminTrustCenterComponent);
    expect(get).toHaveBeenCalledWith('/trust/profile', undefined, { silent: true });
  });
});

/**
 * Save/Publish must NOT be dead buttons when trust_center is flag-disabled.
 * They sat in the header unconditionally — but when notFound (flag off) only the
 * gate notice renders (no profile editor), so a click PUT /trust/profile (404).
 * Now they're gated to the editor-rendered state + the handlers no-op defensively.
 */
describe('AdminTrustCenterComponent (Save/Publish gated when disabled)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(): { c: AdminTrustCenterComponent; put: jasmine.Spy } {
    const put = jasmine.createSpy('put').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [AdminTrustCenterComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post: () => of({ data: {} }), put } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    TestBed.overrideComponent(AdminTrustCenterComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminTrustCenterComponent).componentInstance, put };
  }

  it('save() no-ops when the feature is disabled (notFound) — no PUT to a gated route', () => {
    const { c, put } = setup();
    c.notFound.set(true);
    c.save();
    expect(put).not.toHaveBeenCalled();
    expect(c.saving()).toBe(false);
  });

  it('publish() no-ops when notFound, and save() no-ops on a persistent load error', () => {
    const { c, put } = setup();
    c.notFound.set(true);
    c.publish();
    expect(put).not.toHaveBeenCalled();
    c.notFound.set(false);
    c.loadError.set('boom');
    c.save();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('AdminTrustCenterComponent (Save/Publish hidden in the gated render)', () => {
  afterEach(() => TestBed.resetTestingModule());
  function render(): import('@angular/core/testing').ComponentFixture<AdminTrustCenterComponent> {
    TestBed.configureTestingModule({
      imports: [AdminTrustCenterComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post: () => of({ data: {} }), put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    return TestBed.createComponent(AdminTrustCenterComponent);
  }

  it('does NOT render Save/Publish when disabled (notFound) — only Refresh/Admin', () => {
    const f = render();
    f.componentInstance.notFound.set(true);
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).withContext('no dead Save').not.toContain('Save');
    expect(text).withContext('no dead Publish').not.toContain('Publish');
  });

  it('renders Save when the editor is shown', () => {
    const f = render();
    f.componentInstance.notFound.set(false);
    f.componentInstance.loadError.set(null);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent ?? '').toContain('Save');
  });
});
