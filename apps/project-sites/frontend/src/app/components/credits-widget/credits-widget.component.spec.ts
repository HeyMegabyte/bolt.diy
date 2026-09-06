import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { CreditsWidgetComponent } from './credits-widget.component';
import { ApiService } from '../../services/api.service';

/**
 * CLS: the credit-wallet card RESERVES its height while `GET /api/credits/balance` is
 * in flight (a skeleton), so it doesn't shove the Plan card below it down when it lands
 * — a top /admin/billing layout-shift contributor (measured CLS 0.12). A 404 (flag off)
 * must SETTLE to nothing, never a perpetual skeleton (the error path also leaves the
 * balance unseen, so a `settled` flag — not `loaded` — gates the skeleton).
 */
describe('CreditsWidgetComponent (loading skeleton reserves height — anti-CLS)', () => {
  const BAL = { org_id: 'o', balance: 111, monthly_allowance: 40, rollover_cap: 300 };
  afterEach(() => TestBed.resetTestingModule());

  /** balanceGet drives /credits/balance; history always resolves empty (not under test). */
  function withApi(balanceGet: () => unknown) {
    TestBed.resetTestingModule();
    const get = (path: string) =>
      path.includes('/credits/balance') ? balanceGet() : of({ org_id: 'o', rows: [], count: 0 });
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { get } }] });
    const fx = TestBed.createComponent(CreditsWidgetComponent);
    fx.detectChanges();
    return fx;
  }

  it('shows the skeleton (not the real card) while the balance is loading', () => {
    const fx = withApi(() => new Subject()); // never emits → not settled → loading
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="credits-skeleton"]')).withContext('skeleton reserves height').not.toBeNull();
    expect(el.querySelector('[data-testid="credits-widget"]')).withContext('real card not shown yet').toBeNull();
    expect(fx.componentInstance.loading()).toBeTrue();
  });

  it('swaps skeleton → real wallet card when the balance loads', () => {
    const fx = withApi(() => of(BAL));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="credits-skeleton"]')).withContext('skeleton gone').toBeNull();
    expect(el.querySelector('[data-testid="credits-widget"]')).withContext('real card shown').not.toBeNull();
    expect(fx.componentInstance.loading()).toBeFalse();
  });

  it('collapses to nothing on a 404 (flag off) — settles, never a perpetual skeleton', () => {
    const fx = withApi(() => throwError(() => ({ status: 404 })));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="credits-skeleton"]')).withContext('no perpetual skeleton when the flag is off').toBeNull();
    expect(el.querySelector('[data-testid="credits-widget"]')).toBeNull();
    expect(fx.componentInstance.loading()).withContext('settled after error').toBeFalse();
  });
});
