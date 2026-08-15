import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
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

/**
 * Honest unknown-availability badge. `/api/domains/search-enrich` passes RDAP
 * `status:'unknown'` through to the picker (e.g. `.app`, whose RDAP currently
 * fails). The row template previously branched only on 'available'/'taken', so an
 * unknown row rendered with NO dot + NO status badge (ambiguous — reads as an
 * unlabelled recommendable domain). It must show an explicit "couldn't check".
 */
describe('DomainPickerComponent — honest unknown-availability badge', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a "couldn\'t check" badge for a status:"unknown" (RDAP-failed) row, never mislabelled available/taken', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DomainPickerComponent],
      providers: [
        {
          provide: AdminStateService,
          useValue: { selectedSite: signal({ id: 's1', business_name: 'Acme Co', slug: 'acme' }), sites: signal([]) },
        },
        {
          provide: ApiService,
          useValue: {
            get: () => of({ data: [] }),
            post: () => of({ data: {} }),
            getHostnames: () => of({ data: [] }),
            addHostname: () => of({ data: {} }),
            setPrimaryHostname: () => of({ data: {} }),
            unsubscribeHostname: () => of({ data: {} }),
            searchDomainsEnriched: () => of({ results: [] }),
          },
        },
        {
          provide: BillingService,
          useValue: {
            walletState: () => ({ has_wallet: false, balance_cents: 0 }),
            start: () => undefined,
            stop: () => undefined,
            refreshWallet: () => undefined,
          },
        },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: ToastService, useValue: { info: () => 0, error: () => 0, success: () => 0, warning: () => 0, dismiss: () => undefined } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    });
    const fixture = TestBed.createComponent(DomainPickerComponent);
    const c = fixture.componentInstance;
    c.open.set(true);
    c.query.set('testbiz');
    fixture.detectChanges(); // let the open/query effects (hostnames, suggestions) settle first

    // Now inject a single unknown-status live row + clear AI suggestions so the
    // assertions see ONLY this row's badge.
    c.suggestions.set([]);
    c.liveResults.set([
      { domain: 'testbiz.app', tld: 'app', available: false, status: 'unknown', price_usd_yr: 14, can_register_inline: false, fallback_url: null } as never,
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="domain-status-unknown"]');
    expect(badge).withContext('unknown-status row must render the honest "couldn\'t check" badge').not.toBeNull();
    expect(badge?.textContent ?? '').toContain('couldn');
    // The unknown row itself must not also carry an available/taken badge (mutually
    // exclusive @else-if branches) — assert against the live section's single row.
    const liveSection = Array.from(el.querySelectorAll('.dp-section')).find((s) =>
      s.querySelector('.dp-section-label')?.textContent?.includes('Live availability'),
    );
    expect(liveSection?.querySelector('.dp-status--ok')).withContext('unknown row not "available"').toBeNull();
    expect(liveSection?.querySelector('.dp-status--no')).withContext('unknown row not "taken"').toBeNull();
  });
});
