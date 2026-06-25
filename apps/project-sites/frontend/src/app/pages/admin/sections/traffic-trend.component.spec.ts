import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TrafficTrendComponent } from './traffic-trend.component';
import { ApiService } from '../../../services/api.service';

const SERIES = {
  days: [
    { day: '2026-06-23', pageviews: 90, uniqueSessions: 28, conversions: 0 },
    { day: '2026-06-24', pageviews: 4, uniqueSessions: 4, conversions: 0 },
    { day: '2026-06-25', pageviews: 18, uniqueSessions: 10, conversions: 2 },
  ],
};

function setup(siteId: string, opts: { error?: boolean; empty?: boolean } = {}) {
  const body = opts.empty ? { days: [] } : SERIES;
  const get = jasmine
    .createSpy('get')
    .and.returnValue(opts.error ? throwError(() => new Error('x')) : of({ data: body }));
  TestBed.configureTestingModule({
    imports: [TrafficTrendComponent],
    providers: [{ provide: ApiService, useValue: { get } }],
  });
  const fixture = TestBed.createComponent(TrafficTrendComponent);
  fixture.componentRef.setInput('siteId', siteId);
  fixture.detectChanges();
  return { fixture, get };
}

describe('TrafficTrendComponent (AN5 follow-on — daily traffic trend)', () => {
  it('fetches the daily series for the site and renders one bar per day', () => {
    const { fixture, get } = setup('s1');
    expect(get).toHaveBeenCalledWith('/sites/s1/analytics/daily', { days: '30' }, { silent: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="tt-bar"]').length).toBe(3);
    expect(el.querySelector('[data-testid="tt-total"]')?.textContent).toContain('112'); // 90+4+18
  });

  it('scales bar heights to the max pageviews (tallest day = 100%)', () => {
    const c = setup('s1').fixture.componentInstance;
    expect(c.maxPv()).toBe(90);
    expect(c.barPct(90)).toBe(100);
    expect(c.barPct(0)).toBe(2); // floor so an empty day still shows a sliver
    expect(c.barPct(45)).toBe(50);
  });

  it('shows an empty state when the rollup has no days yet', () => {
    const el = setup('s1', { empty: true }).fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tt-empty"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="tt-bar"]').length).toBe(0);
  });

  it('stays quiet (empty, no throw) on an error', () => {
    const el = setup('s1', { error: true }).fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tt-bar"]')).toBeNull();
    expect(el.querySelector('[data-testid="tt-empty"]')).toBeTruthy();
  });
});
