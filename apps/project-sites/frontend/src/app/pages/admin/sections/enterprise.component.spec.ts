import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
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

  it('captures the worker request_id from a non-404 failure → loadErrorRef (copyable support reference on the shared error card)', () => {
    const { c } = make(
      jasmine.createSpy('cg').and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_ent7' } } }))),
    );
    c.refresh();
    expect(c.loadErrorRef()).toBe('req_ent7');
  });

  it('a 404 leaves loadErrorRef empty (gate card, not the transient error card)', () => {
    const { c } = make(jasmine.createSpy('cg').and.returnValue(throwError(() => ({ status: 404, error: { error: { request_id: 'nope' } } }))));
    c.refresh();
    expect(c.notFound()).toBe(true);
    expect(c.loadErrorRef()).toBe('');
  });

  it('resets loadErrorRef at the start of every refresh (no stale reference)', () => {
    const cg = jasmine
      .createSpy('cg')
      .and.returnValues(throwError(() => ({ status: 500, error: { error: { request_id: 'req_z' } } })), of({ data: null }));
    const { c } = make(cg);
    c.refresh();
    expect(c.loadErrorRef()).toBe('req_z');
    c.refresh();
    expect(c.loadErrorRef()).toBe('');
  });
});

describe('AdminEnterpriseComponent (mutations are {silent} — no generic double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeMut(): { c: AdminEnterpriseComponent; put: jasmine.Spy; post: jasmine.Spy } {
    const put = jasmine.createSpy('put').and.returnValue(of({ data: {} }));
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { id: 'x', range_start: '', range_end: '', status: 'queued' } }));
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), put, post } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminEnterpriseComponent).componentInstance, put, post };
  }

  it('saveContract PUTs {silent:true} (its own error toast is the sole failure surface)', () => {
    const { c, put } = makeMut();
    c.notFound.set(false); // editable state (flag enabled, loaded) so saveContract proceeds
    c.loadError.set(null);
    c.saveContract();
    expect(put).toHaveBeenCalled();
    expect(put.calls.mostRecent().args[0]).toBe('/enterprise/contract');
    expect(put.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('enqueueExport POSTs {silent:true}', () => {
    const { c, post } = makeMut();
    c.rangeStart.set('2026-01-01');
    c.rangeEnd.set('2026-02-01');
    c.enqueueExport();
    expect(post).toHaveBeenCalled();
    expect(post.calls.mostRecent().args[0]).toBe('/enterprise/audit-exports');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });
});

/**
 * Double-submit re-entry guards (mirrors email.component's form-Enter guard).
 * saveContract + enqueueExport are async mutations: the button's [disabled] only
 * blocks a click AFTER the busy signal lands, so a fast double-trigger (or a
 * never-completing first request leaving the flag true) must NOT issue a second
 * PUT/POST. Guard the HANDLER, not just the button.
 */
describe('AdminEnterpriseComponent (mutation re-entry guards)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeMut(): { c: AdminEnterpriseComponent; put: jasmine.Spy; post: jasmine.Spy } {
    // Mutations never complete (no next/error) so the busy flag stays true after the first call.
    const put = jasmine.createSpy('put').and.returnValue(new Subject());
    const post = jasmine.createSpy('post').and.returnValue(new Subject());
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), put, post } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminEnterpriseComponent).componentInstance, put, post };
  }

  it('saveContract ignores a second call while a save is already in flight (one PUT only)', () => {
    const { c, put } = makeMut();
    c.notFound.set(false);
    c.loadError.set(null);
    c.saveContract();
    c.saveContract(); // double-fire while saving() is still true
    expect(put).toHaveBeenCalledTimes(1);
    expect(c.saving()).toBe(true);
  });

  it('enqueueExport ignores a second call while an enqueue is already in flight (one POST only)', () => {
    const { c, post } = makeMut();
    c.rangeStart.set('2026-01-01');
    c.rangeEnd.set('2026-02-01');
    c.enqueueExport();
    c.enqueueExport(); // double-fire while enqueueing() is still true
    expect(post).toHaveBeenCalledTimes(1);
    expect(c.enqueueing()).toBe(true);
  });
});

/**
 * SSO metadata URL validation: the IdP handshake FETCHES sso_metadata_url
 * server-side, so saving an SSO contract with an empty/malformed URL produces a
 * silently-broken SSO config. saveContract must validate (require a valid https
 * URL when SSO+SAML/OIDC; reject a malformed value otherwise) before the PUT —
 * mirroring the webhook/recipe URL guard. (server-fetched-url-validation class.)
 */
describe('AdminEnterpriseComponent (SSO metadata URL validation)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeMut(): { c: AdminEnterpriseComponent; put: jasmine.Spy } {
    const put = jasmine.createSpy('put').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), put, post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminEnterpriseComponent).componentInstance;
    c.notFound.set(false);
    c.loadError.set(null);
    return { c, put };
  }

  it('is valid (not invalid) when SSO is disabled — the URL is ignored', () => {
    const { c } = makeMut();
    c.ssoEnabled.set(false);
    c.ssoMetadataUrl.set(''); // empty, but SSO off → no constraint
    expect(c.ssoUrlInvalid()).toBe(false);
  });

  it('requires a valid https metadata URL for SAML/OIDC SSO', () => {
    const { c } = makeMut();
    c.ssoEnabled.set(true);
    c.ssoProvider.set('saml');
    c.ssoMetadataUrl.set(''); // missing
    expect(c.ssoUrlInvalid()).withContext('SAML SSO needs a metadata URL').toBe(true);
    c.ssoMetadataUrl.set('http://idp.example.com/meta'); // not https
    expect(c.ssoUrlInvalid()).withContext('must be https').toBe(true);
    c.ssoMetadataUrl.set('https://localhost/meta'); // no public dotted host
    expect(c.ssoUrlInvalid()).withContext('needs a public hostname').toBe(true);
    c.ssoMetadataUrl.set('https://idp.example.com/metadata'); // valid
    expect(c.ssoUrlInvalid()).withContext('a valid https URL clears it').toBe(false);
  });

  it('rejects private / link-local / metadata IP metadata URLs (the "public hostname" promise)', () => {
    const { c } = makeMut();
    c.ssoEnabled.set(true);
    c.ssoProvider.set('saml');
    for (const url of [
      'https://127.0.0.1/meta', 'https://10.0.0.1/meta', 'https://192.168.0.1/meta',
      'https://172.20.1.1/meta', 'https://169.254.169.254/meta', 'https://idp.internal/meta',
    ]) {
      c.ssoMetadataUrl.set(url);
      expect(c.ssoUrlInvalid()).withContext(url).toBe(true);
    }
    c.ssoMetadataUrl.set('https://idp.example.com/metadata');
    expect(c.ssoUrlInvalid()).withContext('public host clears it').toBe(false);
  });

  it('treats the metadata URL as optional for cloudflare-access, but validates a present value', () => {
    const { c } = makeMut();
    c.ssoEnabled.set(true);
    c.ssoProvider.set('cloudflare-access');
    c.ssoMetadataUrl.set(''); // optional → fine
    expect(c.ssoUrlInvalid()).toBe(false);
    c.ssoMetadataUrl.set('not-a-url'); // present but malformed → invalid
    expect(c.ssoUrlInvalid()).toBe(true);
  });

  it('saveContract does NOT PUT when the SSO metadata URL is invalid (no broken-SSO save)', () => {
    const { c, put } = makeMut();
    c.ssoEnabled.set(true);
    c.ssoProvider.set('oidc');
    c.ssoMetadataUrl.set(''); // invalid
    c.saveContract();
    expect(put).not.toHaveBeenCalled();
  });

  it('saveContract PUTs once the SSO metadata URL is valid', () => {
    const { c, put } = makeMut();
    c.ssoEnabled.set(true);
    c.ssoProvider.set('oidc');
    c.ssoMetadataUrl.set('https://idp.example.com/.well-known/openid-configuration');
    c.saveContract();
    expect(put).toHaveBeenCalled();
  });
});

describe('AdminEnterpriseComponent (SSO URL invalid → inline hint + Save disabled, real template)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a red metadata-URL hint and disables Save when SSO is on with no URL', () => {
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }), put: () => of({ data: {} }), post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    const f = TestBed.createComponent(AdminEnterpriseComponent);
    const c = f.componentInstance;
    c.notFound.set(false);
    c.loadError.set(null);
    c.ssoEnabled.set(true);
    c.ssoProvider.set('saml');
    c.ssoMetadataUrl.set('');
    f.detectChanges();
    const host = f.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="enterprise-sso-url-hint"]')).withContext('inline guidance shows').not.toBeNull();
    expect((host.querySelector('[data-testid="enterprise-save"]') as HTMLButtonElement).disabled)
      .withContext('Save is blocked until the SSO URL is valid').toBe(true);
  });
});

describe('AdminEnterpriseComponent (flag-disabled card links to Feature Flags)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // Full-render (NOT the template-stripped make()) so we can assert the markup:
  // the disabled card tells the operator to enable a flag "in /admin/feature-flags"
  // — that route MUST be a clickable routerLink (SPA nav), not dead plain text.
  it('the disabled message links /admin/feature-flags via routerLink, not plain text', () => {
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    const f = TestBed.createComponent(AdminEnterpriseComponent);
    f.componentInstance.notFound.set(true);
    f.detectChanges();
    const link = (f.nativeElement as HTMLElement).querySelector('a[href="/admin/feature-flags"]');
    expect(link).withContext('feature-flags route must be a clickable link, not dead plain text').not.toBeNull();
    // Shared <app-flag-gate-notice> underlines via `.flag-gate__link` CSS (WCAG 1.4.1
    // link-in-text-block — not distinguishable by color alone), not the Tailwind class.
    expect(getComputedStyle(link as HTMLElement).textDecorationLine).withContext('link permanently underlined').toContain('underline');
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

describe('AdminEnterpriseComponent (silent contract read — no double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('reads /enterprise/contract silently (component owns the non-404 toast)', () => {
    const get = jasmine.createSpy('get').and.callFake((p: string) => p.includes('/enterprise/contract') ? of({ data: null }) : of({ data: [] }));
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
      ],
    });
    TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
    TestBed.createComponent(AdminEnterpriseComponent);
    expect(get).toHaveBeenCalledWith('/enterprise/contract', undefined, { silent: true });
  });
});

/**
 * "Save contract" must NOT be a dead button when the plan is flag-disabled. The
 * button used to sit in the header unconditionally — but when enterprise_plan is
 * off (notFound) only the gate notice renders (no contract form), so clicking
 * Save POSTed to a gated/404 route. Now it's gated to the editor-rendered state
 * + saveContract() no-ops defensively.
 */
describe('AdminEnterpriseComponent (Save contract gated when plan disabled)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(): { c: AdminEnterpriseComponent; put: jasmine.Spy } {
    const put = jasmine.createSpy('put').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post: () => of({ data: {} }), put } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    TestBed.overrideComponent(AdminEnterpriseComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminEnterpriseComponent).componentInstance, put };
  }

  it('saveContract is a no-op when the plan is disabled (notFound) — no PUT to a gated route', () => {
    const { c, put } = setup();
    c.notFound.set(true);
    c.saveContract();
    expect(put).not.toHaveBeenCalled();
    expect(c.saving()).toBe(false);
  });

  it('saveContract is a no-op on a persistent contract load error', () => {
    const { c, put } = setup();
    c.loadError.set('Could not load the contract.');
    c.saveContract();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('AdminEnterpriseComponent (Save button hidden in the gated state — full render)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): import('@angular/core/testing').ComponentFixture<AdminEnterpriseComponent> {
    TestBed.configureTestingModule({
      imports: [AdminEnterpriseComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post: () => of({ data: {} }), put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    return TestBed.createComponent(AdminEnterpriseComponent);
  }

  it('does NOT render the Save contract button when the plan is disabled (notFound)', () => {
    const f = render();
    f.componentInstance.notFound.set(true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="enterprise-save"]'))
      .withContext('no dead Save button when there is no contract form to save').toBeNull();
  });

  it('renders the Save contract button when the contract editor is shown', () => {
    const f = render();
    f.componentInstance.notFound.set(false);
    f.componentInstance.loadError.set(null);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="enterprise-save"]'))
      .withContext('Save is available when the editor renders').not.toBeNull();
  });

  it('constrains the ACV (cents) number input to non-negative integers (min=0, step=1)', () => {
    const f = render();
    f.componentInstance.notFound.set(false);
    f.componentInstance.loadError.set(null);
    f.detectChanges();
    const numbers = Array.from(
      (f.nativeElement as HTMLElement).querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[];
    // The SLA % input carries max=100; the ACV (cents) input is the other one.
    const acv = numbers.find((n) => n.getAttribute('max') !== '100');
    expect(acv).withContext('ACV cents input rendered').toBeTruthy();
    expect(acv!.getAttribute('min')).withContext('no negative contract value').toBe('0');
    expect(acv!.getAttribute('step')).withContext('cents are whole numbers').toBe('1');
  });
});
