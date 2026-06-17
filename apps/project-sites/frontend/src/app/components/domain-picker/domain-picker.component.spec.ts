import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { DomainPickerComponent } from './domain-picker.component';
import { AdminStateService } from '../../pages/admin/admin-state.service';
import { ApiService } from '../../services/api.service';
import { BillingService } from '../../services/billing.service';
import { TelemetryService } from '../../services/telemetry.service';
import { ToastService } from '../../services/toast.service';

/**
 * Domain-picker labelling contract (2026-06-17):
 *  - the purchase CTA always reads "Buy" (plain, or `Buy · $N/yr` variants) —
 *    never "Register" / "Start wallet" as the lead word;
 *  - the brand-fallback recommendations carry NO "Brand-fit idea — type it to
 *    check availability" reason; the on-row "Recommended" pill conveys that
 *    instead.
 */
describe('DomainPickerComponent (Buy CTA + recommendation labelling)', () => {
  function make(wallet: { has_wallet: boolean; balance_cents: number }): DomainPickerComponent {
    TestBed.resetTestingModule(); // allow multiple make() calls within one spec
    TestBed.configureTestingModule({
      imports: [DomainPickerComponent],
      providers: [
        {
          provide: AdminStateService,
          useValue: { selectedSite: signal({ id: 's1', business_name: 'Acme Co', slug: 'acme' }), sites: signal([]) },
        },
        { provide: ApiService, useValue: { get: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) } },
        { provide: BillingService, useValue: { walletState: () => wallet } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, error: () => 0, success: () => 0, warning: () => 0, dismiss: () => undefined } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    });
    return TestBed.createComponent(DomainPickerComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('labels the purchase button "Buy" when there is no price', () => {
    expect(make({ has_wallet: false, balance_cents: 0 }).registerCtaLabel({ price_usd_yr: undefined } as never)).toBe('Buy');
  });

  it('every priced purchase CTA leads with "Buy" (active / insufficient / no-wallet)', () => {
    expect(make({ has_wallet: true, balance_cents: 9_999_900 }).registerCtaLabel({ price_usd_yr: 12 } as never)).toBe('Buy · $12/yr');
    expect(make({ has_wallet: true, balance_cents: 1 }).registerCtaLabel({ price_usd_yr: 12 } as never).startsWith('Buy ·')).toBeTrue();
    expect(make({ has_wallet: false, balance_cents: 0 }).registerCtaLabel({ price_usd_yr: 12 } as never).startsWith('Buy ·')).toBeTrue();
  });

  it('brand-fallback recommendations carry no "Brand-fit idea / type it" reason', () => {
    const c = make({ has_wallet: false, balance_cents: 0 });
    const fb = (c as unknown as { brandFallbackSuggestions(): { domain: string; reason?: string }[] }).brandFallbackSuggestions();
    expect(fb.length).toBeGreaterThan(0);
    expect(fb.every((s) => !s.reason)).toBeTrue();
    expect(fb.some((s) => (s.reason ?? '').includes('Brand-fit idea'))).toBeFalse();
  });
});
