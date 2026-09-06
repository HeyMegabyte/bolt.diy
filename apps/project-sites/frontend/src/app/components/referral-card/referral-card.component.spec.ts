import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ReferralCardComponent } from './referral-card.component';
import { ApiService } from '../../services/api.service';

/**
 * CLS: the referral card RESERVES its height while `GET /api/referral/code` is in
 * flight (a height-matched skeleton), so it doesn't shove the dashboard groups below
 * it down when it lands — a top /admin dashboard layout-shift contributor (measured
 * CLS 0.23). Critically, a 404 (flag off) / empty code must SETTLE to nothing — never
 * a perpetual skeleton (the error path also leaves `data` null, so a `settled` flag,
 * not `data === null`, gates loading).
 */
describe('ReferralCardComponent (loading skeleton reserves height — anti-CLS)', () => {
  const CODE = { code: 'ABC123', referral_url: 'https://projectsites.dev/r/ABC123', clicks: 5, conversions: 2 };
  afterEach(() => TestBed.resetTestingModule());

  function withApi(get: () => unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { get } }] });
    const fx = TestBed.createComponent(ReferralCardComponent);
    fx.detectChanges();
    return fx;
  }

  it('shows the skeleton (not the real card) while the code is loading', () => {
    const fx = withApi(() => new Subject()); // never emits → not settled → loading
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="referral-skeleton"]')).withContext('skeleton reserves height').not.toBeNull();
    expect(el.querySelector('[data-testid="referral-widget"]')).withContext('real card not shown yet').toBeNull();
    expect(fx.componentInstance.loading()).toBeTrue();
  });

  it('swaps skeleton → real card when a referral code loads', () => {
    const fx = withApi(() => of(CODE));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="referral-skeleton"]')).withContext('skeleton gone').toBeNull();
    expect(el.querySelector('[data-testid="referral-widget"]')).withContext('real card shown').not.toBeNull();
    expect(fx.componentInstance.loading()).toBeFalse();
  });

  it('collapses to nothing on a 404 (flag off) — settles, never a perpetual skeleton', () => {
    const fx = withApi(() => throwError(() => ({ status: 404 })));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="referral-skeleton"]')).withContext('no perpetual skeleton when the flag is off').toBeNull();
    expect(el.querySelector('[data-testid="referral-widget"]')).toBeNull();
    expect(fx.componentInstance.loading()).withContext('settled after error').toBeFalse();
  });

  it('collapses to nothing when the code is empty (settled, not visible)', () => {
    const fx = withApi(() => of({ code: '', referral_url: '', clicks: 0, conversions: 0 }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="referral-skeleton"]')).toBeNull();
    expect(el.querySelector('[data-testid="referral-widget"]')).toBeNull();
  });
});
