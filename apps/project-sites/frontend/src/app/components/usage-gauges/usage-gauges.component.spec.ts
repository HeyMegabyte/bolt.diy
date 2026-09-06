import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { UsageGaugesComponent } from './usage-gauges.component';
import { ApiService } from '../../services/api.service';

/**
 * CLS: the plan-usage gauges card RESERVES its height while `GET /api/usage` is in
 * flight (a skeleton), so it doesn't shove the Credit wallet + Plan card below it down
 * when it lands — the largest remaining /admin/billing layout-shift contributor (267px).
 * `data` becomes `[]` on empty/error (never null after a response), so `data === null`
 * cleanly gates the skeleton with no settled flag needed.
 */
describe('UsageGaugesComponent (loading skeleton reserves height — anti-CLS)', () => {
  const GAUGE = { metric: 'sites', label: 'Sites', used: 3, limit: 10, unit: '', pct: 30 };
  afterEach(() => TestBed.resetTestingModule());

  function withApi(get: () => unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { get } }] });
    const fx = TestBed.createComponent(UsageGaugesComponent);
    fx.detectChanges();
    return fx;
  }

  it('shows the skeleton (not the real card) while usage is loading', () => {
    const fx = withApi(() => new Subject()); // never emits → data null → loading
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="usage-gauges-skeleton"]')).withContext('skeleton reserves height').not.toBeNull();
    expect(el.querySelector('[data-testid="usage-gauges"]')).withContext('real card not shown yet').toBeNull();
    expect(fx.componentInstance.loading()).toBeTrue();
  });

  it('swaps skeleton → real gauges card when usage loads', () => {
    const fx = withApi(() => of({ data: [GAUGE], period: 'month' }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="usage-gauges-skeleton"]')).withContext('skeleton gone').toBeNull();
    expect(el.querySelector('[data-testid="usage-gauges"]')).withContext('real card shown').not.toBeNull();
    expect(fx.componentInstance.loading()).toBeFalse();
  });

  it('collapses to nothing (honest-empty) when usage loads empty', () => {
    const fx = withApi(() => of({ data: [], period: 'month' }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="usage-gauges-skeleton"]')).toBeNull();
    expect(el.querySelector('[data-testid="usage-gauges"]')).toBeNull();
    expect(fx.componentInstance.loading()).withContext('settled, not loading').toBeFalse();
  });
});
