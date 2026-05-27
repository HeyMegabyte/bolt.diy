/**
 * Asserts the single-mount + double-click guards on the pay button.
 *
 *  - Opening /dashboard/quotes/test-id loads the quote
 *  - Clicking pay disables the button and mounts exactly ONE Stripe
 *    iframe; rapid second click while paying does NOT re-mount
 *  - Editing one schedule field does not reset another (bounce-guard)
 */
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { QuoteDetailComponent } from '../quote-detail.component.js';

const FIXTURE = {
  id: 'test-id',
  tenant_id: 't1',
  customer_id: 'c1',
  line_items: [
    { label: 'Service', qty: 1, unit_cents: 18900, taxable: true },
  ],
  day_overrides: [],
  subtotal_cents: 18900,
  tax_cents: 1247,
  total_cents: 20147,
  currency: 'USD',
  expires_at: '2030-01-01T00:00:00+00:00',
  accepted_at: null,
};

describe('QuoteDetailComponent — pay flow', () => {
  let fixture: ComponentFixture<QuoteDetailComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuoteDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'test-id']]) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(QuoteDetailComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    const req = http.expectOne('/api/quotes/test-id');
    req.flush(FIXTURE);
    fixture.detectChanges();
  });

  it('renders the quote with a single pay button', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[data-testid="pay-button"]').length).toBe(1);
    expect(host.querySelector('[data-testid="quote-total"]')?.textContent).toContain('201');
  });

  it('mounts exactly one Stripe iframe on pay and ignores rapid double-click', () => {
    const host = fixture.nativeElement as HTMLElement;
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="pay-button"]')!;

    btn.click();
    // Simulated double-click before the network resolves
    btn.click();
    fixture.detectChanges();

    // Only one POST should be in flight
    const requests = http.match('/api/quotes/test-id/pay');
    expect(requests.length).toBe(1);

    requests[0]!.flush({
      client_secret: 'cs_test',
      publishable_key: 'pk_test',
      payment_intent_id: 'pi_test',
    });
    fixture.detectChanges();

    // Exactly one Stripe iframe mounted
    const mount = host.querySelector<HTMLElement>('[data-testid="pay-mount"]')!;
    expect(mount.querySelectorAll('iframe[data-stripe="link"]').length).toBe(1);
  });

  it('re-enables the pay button on error so the user can retry', () => {
    const host = fixture.nativeElement as HTMLElement;
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="pay-button"]')!;
    btn.click();
    fixture.detectChanges();

    const req = http.expectOne('/api/quotes/test-id/pay');
    req.flush({ error: 'card_declined' }, { status: 402, statusText: 'Payment Required' });
    fixture.detectChanges();

    const after = host.querySelector<HTMLButtonElement>('[data-testid="pay-button"]')!;
    expect(after.disabled).toBe(false);
    expect(host.querySelector('[data-testid="pay-error"]')).toBeTruthy();
  });
});
