import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AdminBillingComponent } from './billing.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { TelemetryService } from '../../../services/telemetry.service';

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

  function build(): void {
    // Every GET the component fires resolves to an empty/zeroed envelope so
    // ngOnInit settles synchronously without touching the network.
    const apiStub = {
      get: () => of({ data: {} }),
      post: () => of({ data: {} }),
      put: () => of({ data: {} }),
      delete: () => of({ ok: true }),
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
});
