import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminBillingComponent } from './billing.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { TelemetryService } from '../../../services/telemetry.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the Billing section cyan/black cohesion + a11y convergence pass (round 5):
 *  - numeric stats (wallet balance, credits remaining, plan entitlements) render
 *    through `<app-rolling-counter>` — never raw text nodes (brand mandate)
 *  - every section + the header carry the `appReveal` entrance host (8 total)
 *  - the WAI-ARIA tablist contract holds (role=tablist, exactly one selected tab,
 *    panel labelled by its tab)
 *  - the credit caps empty-state exposes role=status for AT announcement
 *
 * `ng test` (Karma) is not runnable in this isolated worktree harness; this spec
 * is also AOT-verified via `npx nx build`. It stubs ApiService so `ngOnInit`'s
 * `loadAll()` + `loadTabData()` resolve synchronously with empty data, and
 * provides a real `sites` signal on the AdminStateService stub.
 */
describe('AdminBillingComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminBillingComponent>;
  let confirmSpy: jasmine.Spy;
  let delSpy: jasmine.Spy;

  function build(confirmResult = true, failWallet = false): void {
    // Every GET the component fires resolves to an empty/zeroed envelope so
    // ngOnInit settles synchronously without touching the network.
    delSpy = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    const apiStub = {
      get: (p?: string) =>
        failWallet && typeof p === 'string' && p.includes('/wallet')
          ? throwError(() => ({ status: 500 }))
          : of({ data: {} }),
      post: () => of({ data: {} }),
      put: () => of({ data: {} }),
      delete: delSpy,
      getCostForecast: () =>
        of({
          data: {
            projected_usd: 0,
            current_period_usd: 0,
            rolling_daily_avg: 0,
            days_until_cap_hit: null,
            plan_cap_usd: 0,
            percent_of_cap: 0,
            daily: [],
            breakdown: [], // sparkline path readers do fv.breakdown.length — must be an array
          },
        }),
    };
    TestBed.configureTestingModule({
      imports: [AdminBillingComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AdminStateService, useValue: { sites: signal([]) } },
        {
          provide: ToastService,
          useValue: {
            info: () => 0,
            success: () => 0,
            warning: () => 0,
            error: () => 0,
            dismiss: () => undefined,
          },
        },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: confirmSpy } },
      ],
    });
    fixture = TestBed.createComponent(AdminBillingComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the credits-remaining stat through <app-rolling-counter> (numeric stat mandate)', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    // The AI Credits balance is NOT a raw text node — it is an <app-rolling-counter>.
    expect(el.querySelectorAll('app-rolling-counter').length).toBeGreaterThan(0);
  });

  it('renders the wallet balance through <app-rolling-counter>', () => {
    build();
    fixture.componentInstance.setTab('wallet');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const walletStat = el.querySelector('[data-testid="wallet-balance"]');
    expect(walletStat).toBeTruthy();
    expect(walletStat!.querySelector('app-rolling-counter')).toBeTruthy();
  });

  it('applies the appReveal entrance host on the header + every section shell', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    // header + 7 sections = 8 reveal hosts.
    expect(el.querySelectorAll('[appReveal]').length).toBe(8);
  });

  it('exposes the WAI-ARIA tablist contract with exactly one selected tab', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const tablist = el.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBe('Billing sections');
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(6);
    const selected = Array.from(tabs).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    // The active panel is rendered + labelled by its tab.
    expect(selected[0].getAttribute('aria-controls')).toBe('billing-tab-panel-subscription');
    const panel = el.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-labelledby')).toBe('billing-tab-subscription');
  });

  it('switches the active tab + renders its panel on setTab()', () => {
    build();
    const cmp = fixture.componentInstance;
    expect(cmp.activeTab()).toBe('subscription');
    cmp.setTab('wallet');
    fixture.detectChanges();
    expect(cmp.activeTab()).toBe('wallet');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#billing-tab-panel-wallet')).toBeTruthy();
  });

  it('marks the credit-caps empty-state with role=status for AT announcement', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const empty = el.querySelector('[data-testid="billing-caps-empty"]');
    expect(empty).toBeTruthy();
    expect(empty!.getAttribute('role')).toBe('status');
  });

  it('reflects the Stripe subscription status on the badge (trialing → its own styled state, not the slate fallback)', () => {
    build();
    // Stripe passes status through verbatim; a trial must read as active, not neutral.
    fixture.componentInstance.subStatus.set({ status: 'trialing' } as never);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="subscription-status"]');
    expect(badge).withContext('status badge present').toBeTruthy();
    expect(badge!.getAttribute('data-status')).withContext('trialing now has a per-status style hook').toBe('trialing');
    // and a dunning state is targetable too
    fixture.componentInstance.subStatus.set({ status: 'unpaid' } as never);
    fixture.detectChanges();
    expect(badge!.getAttribute('data-status')).toBe('unpaid');
  });

  it('the affiliate-payouts empty renders the cyan glyph (cohesion with the other billing empties)', () => {
    build();
    const cmp = fixture.componentInstance;
    cmp.affiliatePayouts.set([]);
    cmp.setTab('affiliates');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const empty = el.querySelector('#billing-tab-panel-affiliates [role="status"]');
    expect(empty).withContext('affiliate payouts empty-state present').toBeTruthy();
    expect(empty!.querySelector('.empty-glyph-sm'))
      .withContext('cyan glyph matches the sibling billing empties (caps/costs/alerts/projects)').toBeTruthy();
  });

  // ── Destructive action: removing a spend alert is confirmed ───────────────
  const ALERT = { id: 'al1', name: 'Low balance', threshold_credits: 1000, alert_kind: 'balance_low', notify_email: 'me@x.com', enabled: 1, last_triggered_at: null } as never;

  it('removeAlert deletes the alert after the operator confirms', async () => {
    build(); // confirm resolves true
    await fixture.componentInstance.removeAlert(ALERT);
    expect(confirmSpy).toHaveBeenCalled();
    expect(delSpy).toHaveBeenCalledWith('/billing/spend-alerts/al1');
  });

  it('removeAlert does NOT delete when the confirm is cancelled', async () => {
    build(false); // operator cancels
    delSpy.calls.reset(); // ignore any delete fired during ngOnInit load
    await fixture.componentInstance.removeAlert(ALERT);
    expect(confirmSpy).toHaveBeenCalled();
    expect(delSpy).not.toHaveBeenCalled();
  });

  it('an empty/absent subscription does not fabricate a {plan:"—"} — subStatus stays null + card shows "Free"', () => {
    // build()'s stub returns `{ data: {} }` for /billing/subscription (no real sub).
    build(); // ngOnInit → loadTabData
    const c = fixture.componentInstance;
    expect(c.subStatus())
      .withContext('an empty/null subscription must leave subStatus null, not {plan:"—"}')
      .toBeNull();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="subscription-plan"]')?.textContent?.trim())
      .withContext('a free user must see "Free", not an uninformative em-dash')
      .toBe('Free');
    expect(root.querySelector('[data-testid="subscription-period-end"]')?.textContent?.trim())
      .withContext('a free user has no billing cycle → "No renewal", not a bare em-dash')
      .toBe('No renewal');
  });

  it('a wallet-load failure shows "—" (null), never a fake $0.00 balance', () => {
    build(true, /* failWallet */ true);
    const c = fixture.componentInstance;
    expect(c.walletBalanceCents()).withContext('null, not 0 → renders "—"').toBeNull();
    expect(c.walletError()).toBeTrue();
  });

  it('a successful wallet load sets a real balance + clears the error', () => {
    build(); // empty {data:{}} → balance_cents ?? 0
    const c = fixture.componentInstance;
    expect(c.walletBalanceCents()).withContext('loaded (0 from empty envelope), not null').toBe(0);
    expect(c.walletError()).toBeFalse();
  });
});

/**
 * WCAG 4.1.2 — the per-site spend-cap number inputs (main cost list + caps modal)
 * had no accessible name, so a screen reader announced "spin button, no cap" with
 * no idea which site. Now each carries a dynamic aria-label naming its site.
 */
describe('AdminBillingComponent (per-site cap input accessible names)', () => {
  const apiStub = {
    get: () => of({ data: {} }), post: () => of({ data: {} }), put: () => of({ data: {} }), delete: () => of({ ok: true }),
    getCostForecast: () => of({ data: { projected_usd: 0, current_period_usd: 0, rolling_daily_avg: 0, days_until_cap_hit: null, plan_cap_usd: 0, percent_of_cap: 0, daily: [], breakdown: [] } }),
  };
  function render(sites: { id: string; slug: string; business_name: string | null }[] = []) {
    TestBed.configureTestingModule({
      imports: [AdminBillingComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AdminStateService, useValue: { sites: signal(sites) } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0, dismiss: () => undefined } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    const fx = TestBed.createComponent(AdminBillingComponent);
    fx.detectChanges();
    return fx;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('the cost-list cap input names its site', () => {
    const fx = render();
    fx.componentInstance.siteCosts.set([
      { site_id: 'a', slug: 'alpha', business_name: 'Alpha Co', ai_calls: 0, ai_credits: 0, estimated_cost_micro_usd: 0, bandwidth_bytes: 0 } as never,
    ]);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('input[aria-label="Monthly spend cap for Alpha Co"]')).withContext('cost-list cap input').toBeTruthy();
  });

  it('the caps-modal cap input names its site', () => {
    const fx = render([{ id: 'b', slug: 'beta', business_name: null }]);
    fx.componentInstance.capsModalOpen.set(true);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    const input = el.querySelector('[data-testid="billing-caps-modal-input-b"]') as HTMLElement | null;
    expect(input).withContext('modal cap input renders').toBeTruthy();
    expect(input!.getAttribute('aria-label')).toBe('Monthly spend cap for beta');
  });
});

/**
 * Stripe Connect onboarding is an UPSELL surface (shown on Free with "Requires
 * the Agency-tier add-on"). A failed onboard used to fall through to ApiService's
 * generic getErrorMessage → a 403 became "You don't have permission to do that."
 * — unhelpful + non-actionable. Now the POST is {silent} and the handler surfaces
 * the server's specific message (or a clear upgrade hint).
 */
describe('AdminBillingComponent (Stripe Connect onboard — useful error, not generic 403)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(postSpy: jasmine.Spy, toastErr: jasmine.Spy): AdminBillingComponent {
    TestBed.configureTestingModule({
      imports: [AdminBillingComponent],
      providers: [
        { provide: ApiService, useValue: {
          get: () => of({ data: {} }), post: postSpy, put: () => of({ data: {} }), delete: () => of({ ok: true }),
          getCostForecast: () => of({ data: { projected_usd: 0, current_period_usd: 0, rolling_daily_avg: 0, days_until_cap_hit: null, plan_cap_usd: 0, percent_of_cap: 0, daily: [], breakdown: [] } }),
        } },
        { provide: AdminStateService, useValue: { sites: signal([]) } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: toastErr, dismiss: () => undefined } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    return TestBed.createComponent(AdminBillingComponent).componentInstance;
  }

  it('posts {silent} + surfaces the server message on failure (not the generic 403 toast)', () => {
    const toastErr = jasmine.createSpy('error');
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ error: { error: { message: 'Requires the Agency-tier add-on.' } } })));
    const c = setup(post, toastErr);
    c.onboardStripeConnect();
    expect(post).toHaveBeenCalledWith('/agency/stripe-connect/onboard', {}, { silent: true });
    expect(toastErr).toHaveBeenCalledWith('Requires the Agency-tier add-on.');
    expect(c.onboardingConnect()).toBe(false);
  });

  it('falls back to an actionable upgrade hint when the server gives no message', () => {
    const toastErr = jasmine.createSpy('error');
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 403 })));
    const c = setup(post, toastErr);
    c.onboardStripeConnect();
    expect(toastErr.calls.mostRecent().args[0]).withContext('actionable, names the add-on').toContain('Agency');
  });
});

/**
 * Double-toast guard: upgrade() shows its own specific "Could not start checkout"
 * toast.error, so the /billing/checkout POST must pass {silent:true} — otherwise
 * a failure fires the generic ApiService toast on top of the specific one.
 */
describe('AdminBillingComponent (upgrade checkout is {silent})', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('upgrade() POSTs /billing/checkout with {silent:true}', () => {
    // Return NO url so the next-handler hits the safe toast.info branch — never
    // window.open / window.location (a location redirect reloads the Karma page).
    const post = jasmine.createSpy('post').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [AdminBillingComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post, put: () => of({}), delete: () => of({}) } },
        { provide: AdminStateService, useValue: { sites: signal([]) } },
        { provide: ToastService, useValue: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0 } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    const c = TestBed.createComponent(AdminBillingComponent).componentInstance;
    c.upgrade();
    expect(post).toHaveBeenCalledWith('/billing/checkout', { plan: 'pro' }, { silent: true });
  });
});
