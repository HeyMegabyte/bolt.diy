import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminSiteFeaturesComponent } from './site-features.component';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Coverage for /admin/site-features — Layer 2 of the two-layer feature-flag
 * control plane (the owner-facing, site-scoped, plan-aware "Features" surface).
 * It was a 385-line user-requested feature with ZERO test coverage; this spec
 * locks its contract: load states, entitlement-gated toggle (never a broken
 * toggle on a locked feature), optimistic flip + revert-on-error, undo,
 * search filter, plan-aware counts, and disclosure-mode persistence.
 */
describe('AdminSiteFeaturesComponent (owner Features layer)', () => {
  let fixture: ComponentFixture<AdminSiteFeaturesComponent>;
  let component: AdminSiteFeaturesComponent;
  let httpMock: HttpTestingController;
  let toastError: jasmine.Spy;
  let toastSuccess: jasmine.Spy;

  const SITE_ID = 'site-feat-1';
  const GET_URL = `/api/site-features?site_id=${SITE_ID}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function feat(over: Record<string, unknown> = {}): any {
    return {
      key: 'online_booking',
      name: 'Online Booking',
      description: 'Let visitors book appointments.',
      requiredPlan: 'pro',
      isAddon: false,
      category: 'Growth',
      entitled: 'available',
      enabled: false,
      preview: false,
      ...over,
    };
  }

  /** Create the component; optionally auto-flush the ngOnInit GET. */
  async function build(
    payload: { features: unknown[]; plan?: string } | null = { features: [], plan: 'free' },
    status = 200,
  ): Promise<void> {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: 'tkn_sf_test', identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.removeItem('ff.mode.features');
    } catch { /* private mode */ }
    toastError = jasmine.createSpy('error');
    toastSuccess = jasmine.createSpy('success');
    TestBed.configureTestingModule({
      imports: [AdminSiteFeaturesComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: { error: toastError, success: toastSuccess } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: SITE_ID, business_name: 'Acme Co' }) } },
      ],
    });
    fixture = TestBed.createComponent(AdminSiteFeaturesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // ngOnInit → reload() → GET pending
    if (payload === null) return; // caller drives the request
    const req = httpMock.expectOne(GET_URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tkn_sf_test'); // ApiService bearer (not raw HttpClient)
    if (status >= 400) req.flush('err', { status, statusText: 'Error' });
    else req.flush(payload);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    try { localStorage.removeItem('ps_session'); localStorage.removeItem('ff.mode.features'); } catch { /* */ }
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('shows a loading skeleton until the catalog resolves', async () => {
    await build(null); // do not flush yet
    expect(component.loading()).toBeTrue();
    expect(fixture.nativeElement.querySelector('app-skeleton')).not.toBeNull();
    httpMock.expectOne(GET_URL).flush({ features: [], plan: 'free' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.loading()).toBeFalse();
  });

  it('renders the shared error card (not skeleton) when the catalog fails', async () => {
    await build({ features: [] }, 500);
    expect(component.error()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-error-card')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-skeleton')).toBeNull();
  });

  it('renders the empty state when there are no features', async () => {
    await build({ features: [], plan: 'free' });
    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
  });

  it('renders a card per feature with plan-aware enabled/available counts', async () => {
    await build({
      plan: 'pro',
      features: [
        feat({ key: 'a', enabled: true, entitled: 'available' }),
        feat({ key: 'b', enabled: false, entitled: 'available' }),
        feat({ key: 'c', entitled: 'upgrade-required', requiredPlan: 'business' }),
      ],
    });
    expect(fixture.nativeElement.querySelectorAll('.sf-card').length).toBe(3);
    expect(component.enabledCount()).toBe(1);
    expect(component.availableCount()).toBe(2);
    expect(component.plan()).toBe('pro');
  });

  it('an entitled feature toggles ON: POSTs site-scoped, flips optimistically, shows undo', async () => {
    await build({ plan: 'pro', features: [feat({ key: 'online_booking', enabled: false, entitled: 'available' })] });
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="sf-toggle"]');
    expect(toggle).not.toBeNull();
    toggle.click();
    const req = httpMock.expectOne('/api/site-features/online_booking');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(jasmine.objectContaining({ site_id: SITE_ID, enabled: true }));
    req.flush({ ok: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.features()[0].enabled).toBeTrue();
    expect(toastSuccess).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="sf-undo"]')).not.toBeNull();
  });

  it('expert mode shows a per-feature session timeline of the owner\'s changes', async () => {
    await build({ plan: 'pro', features: [feat({ key: 'online_booking', enabled: false, entitled: 'available' })] });
    component.setMode('expert');
    fixture.detectChanges();
    // No timeline before any change this session.
    expect(fixture.nativeElement.querySelector('[data-testid="sf-timeline"]')).toBeNull();

    // Toggle ON → the session change log records it + the timeline renders.
    fixture.nativeElement.querySelector('[data-testid="sf-toggle"]').click();
    httpMock.expectOne('/api/site-features/online_booking').flush({ ok: true });
    await fixture.whenStable();
    fixture.detectChanges();

    const tl = fixture.nativeElement.querySelector('[data-testid="sf-timeline"]');
    expect(tl).withContext('timeline appears after a change').not.toBeNull();
    expect(tl.textContent).toContain('Enabled');
  });

  it('NEVER toggles a locked feature — no POST fires (entitlement guard)', async () => {
    await build({ plan: 'free', features: [feat({ key: 'locked', entitled: 'upgrade-required', requiredPlan: 'business' })] });
    // No toggle button is even rendered for a locked card…
    expect(fixture.nativeElement.querySelector('[data-testid="sf-toggle"]')).toBeNull();
    // …and calling toggle() directly is a guarded no-op (server is never hit).
    await component.toggle(component.features()[0]);
    httpMock.expectNone('/api/site-features/locked');
    // The locked card shows an upgrade CTA instead.
    expect(fixture.nativeElement.querySelector('[data-testid="sf-locked-cta"]')).not.toBeNull();
  });

  it('reverts the optimistic flip + toasts when the toggle POST fails (403 plan-gate)', async () => {
    await build({ plan: 'pro', features: [feat({ key: 'online_booking', enabled: false, entitled: 'available' })] });
    fixture.nativeElement.querySelector('[data-testid="sf-toggle"]').click();
    httpMock.expectOne('/api/site-features/online_booking').flush('forbidden', { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.features()[0].enabled).toBeFalse(); // reverted
    expect(toastError).toHaveBeenCalled();
  });

  it('search filters the cards + announces the result count to SR', async () => {
    await build({
      plan: 'pro',
      features: [
        feat({ key: 'online_booking', name: 'Online Booking', entitled: 'available' }),
        feat({ key: 'live_chat', name: 'Live Chat', description: 'Chat with visitors.', entitled: 'available' }),
      ],
    });
    component.search.set('booking');
    fixture.detectChanges();
    expect(component.filtered().length).toBe(1);
    expect(component.filterAnnouncement()).toBe('Showing 1 feature');
    component.search.set('');
    expect(component.filterAnnouncement()).toBe('Showing 2 features');
  });

  // Visible "N of M" count chip — sighted parity with the sr-only announcer +
  // cohesion with the sibling System-Admin feature-flags toolbar. isFiltering
  // gates it so the chip only shows once a search is active.
  it('isFiltering(): false with a blank search, true once a query is typed', async () => {
    await build({
      plan: 'pro',
      features: [
        feat({ key: 'online_booking', name: 'Online Booking', entitled: 'available' }),
        feat({ key: 'live_chat', name: 'Live Chat', entitled: 'available' }),
      ],
    });
    expect(component.isFiltering()).withContext('default view → no count chip').toBeFalse();
    component.search.set('chat');
    expect(component.isFiltering()).withContext('active search → count chip').toBeTrue();
    expect(component.filtered().length).withContext('chip would read 1 of 2').toBe(1);
    component.search.set('   ');
    expect(component.isFiltering()).withContext('whitespace-only → not filtering').toBeFalse();
  });

  it('persists the disclosure mode to localStorage', async () => {
    await build({ features: [] });
    component.setMode('expert');
    expect(component.mode()).toBe('expert');
    expect(localStorage.getItem('ff.mode.features')).toBe('expert');
  });

  it('whyFor / entitlementLabel / badgesFor reflect the entitlement + enabled state', async () => {
    await build({ features: [] });
    const on = feat({ enabled: true, entitled: 'available' });
    const off = feat({ enabled: false, entitled: 'available' });
    const addon = feat({ entitled: 'addon-required' });
    expect(component.whyFor(on)).toMatch(/live on your site/i);
    expect(component.whyFor(off)).toMatch(/flip the switch/i);
    expect(component.whyFor(addon)).toMatch(/add this feature/i);
    expect(component.entitlementLabel(addon)).toMatch(/add-on/i);
    expect(component.badgesFor(on).some((b) => b.label === 'Enabled')).toBeTrue();
    expect(component.badgesFor(on).some((b) => b.label === 'Included')).toBeTrue();
  });
});
